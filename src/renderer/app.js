const state = {
  profiles: [],
  filterText: '',
  busy: false,
  cloneInProgress: false,
  updater: {
    configured: false,
    checking: false,
    updateAvailable: false,
    downloading: false,
    downloaded: false,
    currentVersion: null,
    latestVersion: null,
    progressPercent: null,
    message: 'Loading update system...',
    releaseNotes: null,
    sourceLabel: null,
    sourceUrl: null,
  },
};

const appStatus = document.getElementById('appStatus');
const updateStatusPill = document.getElementById('updateStatusPill');
const appVersion = document.getElementById('appVersion');
const userDataDirInput = document.getElementById('userDataDir');
const browseDirButton = document.getElementById('browseDir');
const refreshProfilesButton = document.getElementById('refreshProfiles');
const cloneSuffixInput = document.getElementById('cloneSuffix');
const includeDevModeCheckbox = document.getElementById('includeDevMode');
const profileSearchInput = document.getElementById('profileSearch');
const profileList = document.getElementById('profileList');
const selectAllButton = document.getElementById('selectAll');
const clearSelectionButton = document.getElementById('clearSelection');
const deleteSelectedButton = document.getElementById('deleteSelected');
const selectedCount = document.getElementById('selectedCount');
const selectedBookmarks = document.getElementById('selectedBookmarks');
const selectedExtensions = document.getElementById('selectedExtensions');
const selectedUnpacked = document.getElementById('selectedUnpacked');
const startCloneButton = document.getElementById('startClone');
const resultBox = document.getElementById('resultBox');
const updateMessage = document.getElementById('updateMessage');
const updateMeta = document.getElementById('updateMeta');
const updateProgress = document.getElementById('updateProgress');
const updateProgressBar = document.getElementById('updateProgressBar');
const checkUpdatesButton = document.getElementById('checkUpdates');
const downloadUpdateButton = document.getElementById('downloadUpdate');
const installUpdateButton = document.getElementById('installUpdate');
const openFeedButton = document.getElementById('openFeed');
const releaseNotesBox = document.getElementById('releaseNotes');

async function init() {
  const [defaultPath, meta, updaterStatus] = await Promise.all([
    window.chromeCloner.getDefaultPath(),
    window.chromeCloner.getAppMeta(),
    window.chromeCloner.getUpdateStatus(),
  ]);

  userDataDirInput.value = defaultPath;
  appVersion.textContent = `v${meta.version}`;
  state.updater = { ...state.updater, ...updaterStatus };
  renderUpdater();

  window.chromeCloner.onUpdateStatus((payload) => {
    state.updater = { ...state.updater, ...payload };
    renderUpdater();
  });

  window.chromeCloner.onBusyState((payload) => {
    state.cloneInProgress = Boolean(payload.cloneInProgress);
    renderUpdater();
  });

  await refreshProfiles();
}

async function refreshProfiles(options = {}) {
  setBusy(options.keepBusy ?? false);
  if (!options.silent) {
    setResult('Loading profiles...');
  }

  try {
    const result = await window.chromeCloner.listProfiles(userDataDirInput.value.trim());
    state.profiles = result.profiles.map((profile) => ({
      ...profile,
      selected: state.profiles.find((item) => item.id === profile.id)?.selected ?? false,
    }));
    renderProfiles();

    if (!options.silent) {
      setResult(`Loaded ${state.profiles.length} profile(s) from:\n${result.userDataDir}`);
    }
  } catch (error) {
    state.profiles = [];
    renderProfiles();
    setResult(error.message || String(error));
  } finally {
    if (!options.keepBusy) {
      setBusy(false);
    }
  }
}

function renderProfiles() {
  const visibleProfiles = getVisibleProfiles();
  if (visibleProfiles.length === 0) {
    const message = state.filterText
      ? 'No profiles matched the current search.'
      : 'No Chrome profiles were found in this folder.';
    profileList.innerHTML = `<div class="empty-state">${message}</div>`;
    updateSelectionSummary();
    return;
  }

  profileList.innerHTML = visibleProfiles
    .map(
      (profile) => `
        <label class="profile-row ${profile.selected ? 'selected' : ''}">
          <div class="profile-main">
            <input
              class="profile-checkbox"
              type="checkbox"
              data-profile-id="${escapeHtml(profile.id)}"
              ${profile.selected ? 'checked' : ''}
            />
            <div class="profile-copy">
              <div class="profile-title-row">
                <div class="profile-name">${escapeHtml(profile.name)}</div>
                ${profile.lastUsed ? '<span class="tag accent">Last used</span>' : ''}
                ${profile.stats.unpackedExtensionCount > 0 ? '<span class="tag">Dev mode</span>' : ''}
              </div>
              <div class="profile-subtitle">
                ${escapeHtml(profile.directory)}
                ${profile.userName ? ` - ${escapeHtml(profile.userName)}` : ''}
              </div>
            </div>
          </div>

          <div class="profile-metrics">
            <div class="mini-metric">
              <span class="mini-label">Bookmarks</span>
              <strong>${profile.stats.bookmarkCount}</strong>
            </div>
            <div class="mini-metric">
              <span class="mini-label">Extensions</span>
              <strong>${profile.stats.extensionCount}</strong>
            </div>
            <div class="mini-metric">
              <span class="mini-label">Unpacked</span>
              <strong>${profile.stats.unpackedExtensionCount}</strong>
            </div>
          </div>
        </label>
      `,
    )
    .join('');

  profileList.querySelectorAll('.profile-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const profileId = event.target.dataset.profileId;
      const profile = state.profiles.find((item) => item.id === profileId);
      if (profile) {
        profile.selected = event.target.checked;
      }
      renderProfiles();
    });
  });

  updateSelectionSummary();
}

function getVisibleProfiles() {
  const query = state.filterText.trim().toLowerCase();
  if (!query) {
    return state.profiles;
  }

  return state.profiles.filter((profile) => {
    const haystack = [
      profile.name,
      profile.directory,
      profile.userName,
      profile.gaiaName,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

function updateSelectionSummary() {
  const selected = state.profiles.filter((profile) => profile.selected);
  selectedCount.textContent = String(selected.length);
  selectedBookmarks.textContent = String(sumBy(selected, (item) => item.stats.bookmarkCount));
  selectedExtensions.textContent = String(sumBy(selected, (item) => item.stats.extensionCount));
  selectedUnpacked.textContent = String(sumBy(selected, (item) => item.stats.unpackedExtensionCount));
}

function getSelectedProfileIds() {
  return state.profiles.filter((profile) => profile.selected).map((profile) => profile.id);
}

async function handleClone() {
  const selectedProfileIds = getSelectedProfileIds();
  if (selectedProfileIds.length === 0) {
    setResult('Select at least one source profile first.');
    return;
  }

  setBusy(true);
  setResult('Cloning profiles...');

  try {
    const result = await window.chromeCloner.cloneProfiles({
      userDataDir: userDataDirInput.value.trim(),
      selectedProfileIds,
      suffix: cloneSuffixInput.value.trim(),
      includeDevModeExtensions: includeDevModeCheckbox.checked,
    });

    await refreshProfiles({ silent: true, keepBusy: true });
    setResult(formatCloneResult(result));
  } catch (error) {
    setResult(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function handleDeleteSelected() {
  const selectedProfiles = state.profiles.filter((profile) => profile.selected);
  if (selectedProfiles.length === 0) {
    setResult('Select at least one profile to delete.');
    return;
  }

  if (selectedProfiles.some((profile) => profile.id === 'Default')) {
    setResult('Default Chrome profile cannot be deleted from this app.');
    return;
  }

  const summary = selectedProfiles.map((profile) => `- ${profile.name} (${profile.directory})`).join('\n');
  const confirmed = window.confirm(
    `Delete ${selectedProfiles.length} profile(s)?\n\n${summary}\n\nThis removes the Chrome profile folders permanently.`,
  );

  if (!confirmed) {
    return;
  }

  setBusy(true);
  setResult('Deleting profiles...');

  try {
    const result = await window.chromeCloner.deleteProfiles({
      userDataDir: userDataDirInput.value.trim(),
      selectedProfileIds: selectedProfiles.map((profile) => profile.id),
    });

    await refreshProfiles({ silent: true, keepBusy: true });
    setResult(formatDeleteResult(result));
  } catch (error) {
    setResult(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function formatCloneResult(result) {
  const lines = [
    'Clone completed.',
    '',
    `Profiles cloned: ${result.summary.profileCount}`,
    `Bookmarks carried over: ${result.summary.bookmarkCount}`,
    `Extensions referenced: ${result.summary.extensionCount}`,
    `Unpacked extensions copied: ${result.summary.unpackedCopied}`,
  ];

  if (result.summary.warningCount > 0) {
    lines.push(`Warnings: ${result.summary.warningCount}`);
  }

  lines.push('');

  for (const clone of result.clones) {
    lines.push(`- ${clone.sourceName} -> ${clone.targetName} (${clone.targetId})`);
    lines.push(
      `  bookmarks=${clone.stats.bookmarkCount}, extensions=${clone.stats.extensionCount}, unpackedCopied=${clone.stats.unpackedCopied}`,
    );

    for (const warning of clone.warnings) {
      lines.push(`  warning: ${warning.message}`);
    }
  }

  return lines.join('\n');
}

function formatDeleteResult(result) {
  const lines = ['Delete completed.', ''];
  for (const item of result.deleted) {
    lines.push(`- ${item.profileName} (${item.profileId})`);
  }
  return lines.join('\n');
}

function setBusy(isBusy) {
  state.busy = isBusy;
  appStatus.textContent = isBusy ? 'Working' : 'Ready';
  appStatus.classList.toggle('busy', isBusy);
  startCloneButton.disabled = isBusy;
  refreshProfilesButton.disabled = isBusy;
  browseDirButton.disabled = isBusy;
  selectAllButton.disabled = isBusy;
  clearSelectionButton.disabled = isBusy;
  deleteSelectedButton.disabled = isBusy;
  renderUpdater();
}

function setResult(text) {
  resultBox.textContent = text;
}

function renderUpdater() {
  const updater = state.updater;
  updateMessage.textContent = updater.message || 'Update system is idle.';
  releaseNotesBox.textContent = updater.releaseNotes || 'No release notes.';

  const latestPart = updater.latestVersion ? `Latest: v${updater.latestVersion}` : 'Latest: -';
  const currentPart = updater.currentVersion ? `Current: v${updater.currentVersion}` : '';
  const sourcePart = updater.sourceLabel ? `Source: ${updater.sourceLabel}` : 'Source not configured';
  updateMeta.textContent = [currentPart, latestPart, sourcePart].filter(Boolean).join(' | ');

  const progressVisible = typeof updater.progressPercent === 'number' && updater.downloading;
  updateProgress.classList.toggle('hidden', !progressVisible && !updater.downloaded);
  updateProgressBar.style.width = `${updater.downloaded ? 100 : updater.progressPercent || 0}%`;

  updateStatusPill.className = 'status-pill neutral';
  if (!updater.configured) {
    updateStatusPill.textContent = 'No feed';
  } else if (updater.downloaded) {
    updateStatusPill.textContent = 'Ready to install';
    updateStatusPill.classList.add('success');
  } else if (updater.downloading) {
    updateStatusPill.textContent = 'Downloading';
    updateStatusPill.classList.add('warning');
  } else if (updater.updateAvailable) {
    updateStatusPill.textContent = 'Update found';
    updateStatusPill.classList.add('accent');
  } else if (updater.checking) {
    updateStatusPill.textContent = 'Checking';
    updateStatusPill.classList.add('warning');
  } else {
    updateStatusPill.textContent = 'Up to date';
    updateStatusPill.classList.add('success');
  }

  const updatesLocked = state.busy || state.cloneInProgress;
  checkUpdatesButton.disabled = !updater.configured || updatesLocked || updater.checking || updater.downloading;
  downloadUpdateButton.disabled =
    !updater.configured || updatesLocked || !updater.updateAvailable || updater.downloaded || updater.downloading;
  installUpdateButton.disabled = !updater.configured || updatesLocked || !updater.downloaded;
  openFeedButton.disabled = !updater.sourceUrl;
}

function sumBy(items, getValue) {
  return items.reduce((total, item) => total + Number(getValue(item) || 0), 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

browseDirButton.addEventListener('click', async () => {
  const selectedPath = await window.chromeCloner.pickDirectory();
  if (selectedPath) {
    userDataDirInput.value = selectedPath;
    await refreshProfiles();
  }
});

refreshProfilesButton.addEventListener('click', () => refreshProfiles());

profileSearchInput.addEventListener('input', (event) => {
  state.filterText = event.target.value;
  renderProfiles();
});

selectAllButton.addEventListener('click', () => {
  const visibleProfiles = getVisibleProfiles();
  const shouldSelect = visibleProfiles.some((profile) => !profile.selected);
  const visibleIds = new Set(visibleProfiles.map((profile) => profile.id));

  state.profiles.forEach((profile) => {
    if (visibleIds.has(profile.id)) {
      profile.selected = shouldSelect;
    }
  });

  renderProfiles();
});

clearSelectionButton.addEventListener('click', () => {
  state.profiles.forEach((profile) => {
    profile.selected = false;
  });
  renderProfiles();
});

startCloneButton.addEventListener('click', handleClone);
deleteSelectedButton.addEventListener('click', handleDeleteSelected);

checkUpdatesButton.addEventListener('click', async () => {
  try {
    await window.chromeCloner.checkForUpdates();
  } catch (error) {
    setResult(error.message || String(error));
  }
});

downloadUpdateButton.addEventListener('click', async () => {
  try {
    await window.chromeCloner.downloadUpdate();
  } catch (error) {
    setResult(error.message || String(error));
  }
});

installUpdateButton.addEventListener('click', async () => {
  try {
    await window.chromeCloner.installUpdate();
  } catch (error) {
    setResult(error.message || String(error));
  }
});

openFeedButton.addEventListener('click', async () => {
  try {
    await window.chromeCloner.openUpdateFeed();
  } catch (error) {
    setResult(error.message || String(error));
  }
});

init();
