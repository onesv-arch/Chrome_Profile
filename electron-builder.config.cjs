const fs = require('fs');
const path = require('path');

const updateConfig = loadUpdateConfig();

module.exports = {
  appId: 'com.codex.chromeprofilecloner',
  productName: 'Chrome Profile Cloner',
  asar: true,
  files: [
    'main.js',
    'preload.js',
    'app-update-config.json',
    'src/**/*',
    'package.json',
  ],
  directories: {
    output: 'release',
  },
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    artifactName: '${productName}-Setup-${version}.${ext}',
    publish: buildPublishConfig(updateConfig),
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Chrome Profile Cloner',
  },
  publish: buildPublishConfig(updateConfig),
};

function loadUpdateConfig() {
  const configPath = path.join(__dirname, 'app-update-config.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (isValidGithubConfig(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function isValidGithubConfig(value) {
  const owner = typeof value?.owner === 'string' ? value.owner.trim() : '';
  const repo = typeof value?.repo === 'string' ? value.repo.trim() : '';
  return owner && repo && !owner.startsWith('YOUR_GITHUB_') && !repo.startsWith('YOUR_GITHUB_');
}

function buildPublishConfig(config) {
  if (!config) {
    return undefined;
  }

  return [
    {
      provider: 'github',
      owner: config.owner.trim(),
      repo: config.repo.trim(),
      private: Boolean(config.private),
      vPrefixedTagName: config.vPrefixedTagName !== false,
      releaseType: config.releaseType || 'release',
      channel: config.channel || 'latest',
      publishAutoUpdate: true,
    },
  ];
}
