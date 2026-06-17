const fs = require('fs/promises');
const path = require('path');
const { app, shell } = require('electron');
const { NsisUpdater } = require('electron-updater');

function createUpdateService(window) {
  let updater = null;
  let status = {
    configured: false,
    checking: false,
    updateAvailable: false,
    downloading: false,
    downloaded: false,
    currentVersion: app.getVersion(),
    latestVersion: null,
    progressPercent: null,
    message: 'Auto-update is not configured.',
    releaseNotes: null,
    sourceLabel: null,
    sourceUrl: null,
  };

  function emitStatus(patch) {
    status = { ...status, ...patch };
    if (!window.isDestroyed()) {
      window.webContents.send('updater:status', status);
    }
  }

  async function init() {
    const config = await loadUpdateConfig();
    if (!config) {
      emitStatus({
        configured: false,
        message: 'Fill app-update-config.json with GitHub owner and repo to enable updates.',
      });
      return;
    }

    updater = new NsisUpdater({
      provider: 'github',
      owner: config.owner,
      repo: config.repo,
      private: config.private,
      vPrefixedTagName: config.vPrefixedTagName,
      releaseType: config.releaseType,
      channel: config.channel,
      host: config.host,
    });

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;

    wireUpdaterEvents(updater, emitStatus);

    emitStatus({
      configured: true,
      message: 'GitHub Releases update channel configured.',
      sourceLabel: `${config.owner}/${config.repo}`,
      sourceUrl: buildGithubReleasesUrl(config),
    });
  }

  async function checkForUpdates() {
    if (!updater) {
      throw new Error('Auto-update is not configured yet.');
    }

    emitStatus({
      checking: true,
      message: 'Checking GitHub Releases for updates...',
      progressPercent: null,
    });

    await updater.checkForUpdates();
  }

  async function downloadUpdate() {
    if (!updater) {
      throw new Error('Auto-update is not configured yet.');
    }

    emitStatus({
      downloading: true,
      message: 'Downloading update from GitHub Releases...',
      progressPercent: 0,
    });

    await updater.downloadUpdate();
  }

  function installUpdateNow() {
    if (!updater) {
      throw new Error('Auto-update is not configured yet.');
    }

    updater.quitAndInstall(false, true);
  }

  function getStatus() {
    return status;
  }

  async function openReleaseFeed() {
    if (!status.sourceUrl) {
      throw new Error('No GitHub release URL is configured.');
    }
    await shell.openExternal(status.sourceUrl);
  }

  return {
    init,
    checkForUpdates,
    downloadUpdate,
    installUpdateNow,
    getStatus,
    openReleaseFeed,
  };
}

async function loadUpdateConfig() {
  const candidates = [
    path.join(app.getPath('userData'), 'app-update-config.json'),
    path.join(app.getAppPath(), 'app-update-config.json'),
    path.join(process.cwd(), 'app-update-config.json'),
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      if (isValidGithubConfig(parsed)) {
        return {
          provider: 'github',
          owner: parsed.owner.trim(),
          repo: parsed.repo.trim(),
          private: Boolean(parsed.private),
          vPrefixedTagName: parsed.vPrefixedTagName !== false,
          releaseType: parsed.releaseType || 'release',
          channel: parsed.channel || 'latest',
          host: parsed.host || 'github.com',
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return null;
}

function isValidGithubConfig(value) {
  const owner = typeof value?.owner === 'string' ? value.owner.trim() : '';
  const repo = typeof value?.repo === 'string' ? value.repo.trim() : '';
  return (
    value &&
    (value.provider === undefined || value.provider === 'github') &&
    owner &&
    repo &&
    !owner.startsWith('YOUR_GITHUB_') &&
    !repo.startsWith('YOUR_GITHUB_')
  );
}

function buildGithubReleasesUrl(config) {
  const host = config.host || 'github.com';
  return `https://${host}/${config.owner}/${config.repo}/releases`;
}

function wireUpdaterEvents(updater, emitStatus) {
  updater.on('error', (error) => {
    emitStatus({
      checking: false,
      downloading: false,
      message: `Update error: ${error.message}`,
    });
  });

  updater.on('checking-for-update', () => {
    emitStatus({
      checking: true,
      message: 'Checking GitHub Releases for updates...',
    });
  });

  updater.on('update-available', (info) => {
    emitStatus({
      checking: false,
      updateAvailable: true,
      downloaded: false,
      latestVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      message: `Update ${info.version} is available on GitHub Releases.`,
    });
  });

  updater.on('update-not-available', () => {
    emitStatus({
      checking: false,
      updateAvailable: false,
      downloaded: false,
      latestVersion: null,
      releaseNotes: null,
      progressPercent: null,
      message: 'You are on the latest published GitHub release.',
    });
  });

  updater.on('download-progress', (progress) => {
    emitStatus({
      downloading: true,
      progressPercent: Math.round(progress.percent ?? 0),
      message: `Downloading update... ${Math.round(progress.percent ?? 0)}%`,
    });
  });

  updater.on('update-downloaded', (info) => {
    emitStatus({
      downloading: false,
      downloaded: true,
      updateAvailable: true,
      latestVersion: info.version,
      progressPercent: 100,
      message: `Update ${info.version} is ready to install.`,
    });
  });
}

function normalizeReleaseNotes(releaseNotes) {
  if (Array.isArray(releaseNotes)) {
    return releaseNotes.map((item) => item.note || '').filter(Boolean).join('\n\n');
  }
  if (typeof releaseNotes === 'string') {
    return releaseNotes;
  }
  return null;
}

module.exports = {
  createUpdateService,
  loadUpdateConfig,
  normalizeReleaseNotes,
  isValidGithubConfig,
  buildGithubReleasesUrl,
};
