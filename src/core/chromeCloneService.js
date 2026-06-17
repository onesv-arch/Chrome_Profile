const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const ROOT_EXCLUDES = new Set([
  'cache',
  'code cache',
  'gpucache',
  'grshadercache',
  'dawncache',
  'service worker',
  'optimizationguidepredictionmodels',
  'blob_storage',
  'crashpad',
]);

const FILE_EXCLUDES = new Set([
  'lockfile',
  'cookies-journal',
  'history-journal',
  'visited links',
  'visited links-journal',
  'web data-journal',
  'login data-journal',
  'quota manager-journal',
  'current tabs',
  'current session',
  'last tabs',
  'last session',
]);

function getDefaultChromeUserDataDir() {
  return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeName(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listChromeProfiles(userDataDir = getDefaultChromeUserDataDir()) {
  const localStatePath = path.join(userDataDir, 'Local State');
  const localState = await readJson(localStatePath, {});
  const infoCache = localState.profile?.info_cache ?? {};
  const lastUsed = localState.profile?.last_used ?? null;
  const entries = Object.entries(infoCache);
  const profiles = [];

  if (entries.length === 0) {
    const discoveredDirectories = await discoverProfileDirectories(userDataDir);
    for (const directory of discoveredDirectories) {
      entries.push([directory, { name: directory }]);
    }
  }

  for (const [directory, info] of entries) {
    const profileDir = path.join(userDataDir, directory);
    if (!(await exists(profileDir))) {
      continue;
    }

    const preferences = await readJson(path.join(profileDir, 'Preferences'), {});
    const bookmarks = await readJson(path.join(profileDir, 'Bookmarks'), {});
    const bookmarkCount = countBookmarks(bookmarks?.roots ?? {});
    const extensionCount = await countInstalledExtensions(profileDir, preferences);
    const unpackedExtensionCount = await countUnpackedExtensions(profileDir, preferences);

    profiles.push({
      id: directory,
      directory,
      name: info.name || directory,
      shortcutName: info.shortcut_name || info.name || directory,
      gaiaName: info.gaia_name || '',
      userName: info.user_name || '',
      isUsingDefaultName: Boolean(info.is_using_default_name),
      isEphemeral: Boolean(info.is_ephemeral),
      lastUsed: directory === lastUsed,
      stats: {
        extensionCount,
        unpackedExtensionCount,
        bookmarkCount,
        bookmarkBarVisible: typeof preferences?.bookmark_bar?.show_on_all_tabs === 'boolean'
          ? preferences.bookmark_bar.show_on_all_tabs
          : null,
      },
    });
  }

  profiles.sort((left, right) => {
    if (left.lastUsed && !right.lastUsed) {
      return -1;
    }
    if (!left.lastUsed && right.lastUsed) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });

  return {
    userDataDir,
    localStatePath,
    profiles,
  };
}

function countBookmarks(roots) {
  const stack = Object.values(roots ?? {});
  let total = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') {
      continue;
    }
    if (current.type === 'url') {
      total += 1;
    }
    if (Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }

  return total;
}

async function countInstalledExtensions(profileDir, preferences) {
  const settings = preferences?.extensions?.settings ?? {};
  const settingsIds = new Set();
  for (const [extensionId, config] of Object.entries(settings)) {
    if (!isChromeExtensionId(extensionId)) {
      continue;
    }
    if (await isLikelyUnpackedExtensionConfig(profileDir, config)) {
      continue;
    }
    settingsIds.add(extensionId);
  }

  const directoryIds = new Set(await discoverInstalledExtensionIds(profileDir));
  return new Set([...settingsIds, ...directoryIds]).size;
}

async function countUnpackedExtensions(sourceProfileDir, preferences) {
  const settings = preferences?.extensions?.settings ?? {};
  let count = 0;

  for (const config of Object.values(settings)) {
    if (await isLikelyUnpackedExtensionConfig(sourceProfileDir, config)) {
      count += 1;
    }
  }

  return count;
}

function createDirectoryKey(localState, preferredLabel, existingDirectories = []) {
  const infoCache = localState.profile?.info_cache ?? {};
  const existingKeys = new Set([...Object.keys(infoCache), ...existingDirectories]);
  const existingNames = new Set(
    Object.values(infoCache)
      .map((entry) => String(entry?.name || '').toLowerCase())
      .filter(Boolean),
  );

  const baseLabel = normalizeName(preferredLabel) || 'Cloned Profile';
  let nameCandidate = baseLabel;
  let nameIndex = 2;

  while (existingNames.has(nameCandidate.toLowerCase())) {
    nameCandidate = `${baseLabel} ${nameIndex}`;
    nameIndex += 1;
  }

  const reservedDirectories = new Set(existingKeys);
  let directoryIndex = 1;
  let directoryCandidate = `Profile ${directoryIndex}`;

  while (reservedDirectories.has(directoryCandidate)) {
    directoryIndex += 1;
    directoryCandidate = `Profile ${directoryIndex}`;
  }

  return {
    name: nameCandidate,
    directory: directoryCandidate,
  };
}

async function cloneChromeProfiles({
  userDataDir = getDefaultChromeUserDataDir(),
  selectedProfileIds = [],
  suffix = 'Clone',
  includeDevModeExtensions = true,
  managedExtensionRoot,
  skipProcessCheck = false,
}) {
  if (!Array.isArray(selectedProfileIds) || selectedProfileIds.length === 0) {
    throw new Error('No Chrome profile selected.');
  }

  const localStatePath = path.join(userDataDir, 'Local State');
  const localState = await readJson(localStatePath, null);
  if (!localState) {
    throw new Error('Local State not found. Check the Chrome user data path.');
  }

  if (!skipProcessCheck) {
    const runningChrome = await detectRunningChrome();
    if (runningChrome.length > 0) {
      throw new Error('Chrome is still running. Close every Chrome window before cloning.');
    }
  }

  const infoCache = localState.profile?.info_cache ?? {};
  const existingDirectories = await discoverProfileDirectories(userDataDir);
  const createdArtifacts = [];
  const results = [];

  try {
    for (const sourceId of selectedProfileIds) {
      const sourceInfo = infoCache[sourceId] ?? { name: sourceId };
      const sourceDir = path.join(userDataDir, sourceId);
      if (!(await exists(sourceDir))) {
        throw new Error(`Source profile folder not found: ${sourceId}`);
      }

      const labelSeed = suffix ? `${sourceInfo.name || sourceId} ${suffix}` : `${sourceInfo.name || sourceId}`;
      const target = createDirectoryKey(localState, labelSeed, existingDirectories);
      const targetDir = path.join(userDataDir, target.directory);
      const managedTargetDir = managedExtensionRoot
        ? path.join(managedExtensionRoot, target.directory)
        : null;

      existingDirectories.push(target.directory);

      await copyProfileDirectory(sourceDir, targetDir);
      createdArtifacts.push({ kind: 'profile', targetPath: targetDir });

      const cloneResult = await patchClonedProfile({
        sourceId,
        sourceDir,
        target,
        targetDir,
        managedExtensionRoot,
        includeDevModeExtensions,
      });

      if (managedTargetDir) {
        createdArtifacts.push({ kind: 'managed-extensions', targetPath: managedTargetDir });
      }

      localState.profile = localState.profile || {};
      localState.profile.info_cache = localState.profile.info_cache || {};
      localState.profile.info_cache[target.directory] = {
        ...sourceInfo,
        name: target.name,
        shortcut_name: target.name,
        active_time: new Date().toISOString(),
        is_using_default_name: false,
      };

      results.push({
        sourceId,
        sourceName: sourceInfo.name || sourceId,
        targetId: target.directory,
        targetName: target.name,
        stats: cloneResult.stats,
        warnings: cloneResult.warnings,
      });
    }

    await writeJson(localStatePath, localState);

    return {
      ok: true,
      userDataDir,
      clones: results,
      summary: buildCloneSummary(results),
    };
  } catch (error) {
    await rollbackArtifacts(createdArtifacts);
    throw new Error(`Clone aborted. ${error.message}`);
  }
}

async function deleteChromeProfiles({
  userDataDir = getDefaultChromeUserDataDir(),
  selectedProfileIds = [],
  managedExtensionRoot,
  skipProcessCheck = false,
}) {
  if (!Array.isArray(selectedProfileIds) || selectedProfileIds.length === 0) {
    throw new Error('No Chrome profile selected for deletion.');
  }

  const localStatePath = path.join(userDataDir, 'Local State');
  const localState = await readJson(localStatePath, null);
  if (!localState) {
    throw new Error('Local State not found. Check the Chrome user data path.');
  }

  if (!skipProcessCheck) {
    const runningChrome = await detectRunningChrome();
    if (runningChrome.length > 0) {
      throw new Error('Chrome is still running. Close every Chrome window before deleting profiles.');
    }
  }

  const infoCache = localState.profile?.info_cache ?? {};
  const deleted = [];

  for (const profileId of selectedProfileIds) {
    if (profileId === 'Default') {
      throw new Error('Deleting the Default Chrome profile is blocked.');
    }

    const profileDir = path.join(userDataDir, profileId);
    if (!(await exists(profileDir))) {
      throw new Error(`Profile folder not found: ${profileId}`);
    }

    await fs.rm(profileDir, { recursive: true, force: true });
    if (managedExtensionRoot) {
      await fs.rm(path.join(managedExtensionRoot, profileId), { recursive: true, force: true });
    }

    const sourceInfo = infoCache[profileId] ?? {};
    delete infoCache[profileId];
    deleted.push({
      profileId,
      profileName: sourceInfo.name || profileId,
    });
  }

  localState.profile = localState.profile || {};
  localState.profile.info_cache = infoCache;
  if (selectedProfileIds.includes(localState.profile.last_used)) {
    localState.profile.last_used = 'Default';
  }

  await writeJson(localStatePath, localState);

  return {
    ok: true,
    deleted,
  };
}

function buildCloneSummary(results) {
  return results.reduce(
    (summary, item) => {
      summary.profileCount += 1;
      summary.extensionCount += item.stats.extensionCount;
      summary.bookmarkCount += item.stats.bookmarkCount;
      summary.unpackedCopied += item.stats.unpackedCopied;
      summary.warningCount += item.warnings.length;
      return summary;
    },
    {
      profileCount: 0,
      extensionCount: 0,
      bookmarkCount: 0,
      unpackedCopied: 0,
      warningCount: 0,
    },
  );
}

async function rollbackArtifacts(createdArtifacts) {
  for (const artifact of [...createdArtifacts].reverse()) {
    await fs.rm(artifact.targetPath, { recursive: true, force: true });
  }
}

async function copyProfileDirectory(sourceDir, targetDir) {
  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (item) => {
      const name = path.basename(item).toLowerCase();
      if (ROOT_EXCLUDES.has(name)) {
        return false;
      }
      if (FILE_EXCLUDES.has(name)) {
        return false;
      }
      return true;
    },
  });
}

async function patchClonedProfile({
  sourceId,
  sourceDir,
  target,
  targetDir,
  managedExtensionRoot,
  includeDevModeExtensions,
}) {
  const preferencesPath = path.join(targetDir, 'Preferences');
  const securePreferencesPath = path.join(targetDir, 'Secure Preferences');
  const bookmarksPath = path.join(targetDir, 'Bookmarks');
  const preferences = await readJson(preferencesPath, {});
  const securePreferences = await readJson(securePreferencesPath, {});
  const bookmarks = await readJson(bookmarksPath, {});

  preferences.profile = preferences.profile || {};
  preferences.profile.name = target.name;

  const unpackedResult = includeDevModeExtensions
    ? await rewriteUnpackedExtensionPaths({
        sourceId,
        sourceProfileDir: sourceDir,
        targetDirectory: target.directory,
        preferences,
        managedExtensionRoot,
      })
    : { copied: [], warnings: [] };

  await writeJson(preferencesPath, preferences);
  if (Object.keys(securePreferences).length > 0) {
    await writeJson(securePreferencesPath, securePreferences);
  }

  await cleanupTransientFiles(targetDir);

  return {
    stats: {
      extensionCount: await countInstalledExtensions(targetDir, preferences),
      unpackedCopied: unpackedResult.copied.length,
      bookmarkCount: countBookmarks(bookmarks?.roots ?? {}),
    },
    warnings: unpackedResult.warnings,
  };
}

async function rewriteUnpackedExtensionPaths({
  sourceId,
  sourceProfileDir,
  targetDirectory,
  preferences,
  managedExtensionRoot,
}) {
  const settings = preferences?.extensions?.settings;
  if (!settings || !managedExtensionRoot) {
    return { copied: [], warnings: [] };
  }

  const copied = [];
  const warnings = [];

  for (const [extensionId, config] of Object.entries(settings)) {
    const currentPath = config?.path;
    if (!currentPath || typeof currentPath !== 'string') {
      continue;
    }

    if (!path.isAbsolute(currentPath)) {
      continue;
    }

    if (sourceProfileDir && isSubPath(sourceProfileDir, currentPath)) {
      continue;
    }

    const manifestPath = path.join(currentPath, 'manifest.json');
    const pathExists = await exists(currentPath);
    const manifestExists = pathExists ? await exists(manifestPath) : false;

    if (!pathExists || !manifestExists) {
      warnings.push({
        extensionId,
        sourceProfile: sourceId,
        type: 'missing-unpacked-source',
        message: `Skipped unpacked extension ${extensionId} because its source folder is unavailable.`,
      });
      continue;
    }

    const extensionName = normalizeName(path.basename(currentPath)) || extensionId;
    const destinationRoot = path.join(managedExtensionRoot, targetDirectory, extensionName);
    await fs.mkdir(path.dirname(destinationRoot), { recursive: true });
    await fs.rm(destinationRoot, { recursive: true, force: true });
    await fs.cp(currentPath, destinationRoot, { recursive: true });

    config.path = destinationRoot;
    copied.push({
      extensionId,
      from: currentPath,
      to: destinationRoot,
      sourceProfile: sourceId,
    });
  }

  return {
    copied,
    warnings,
  };
}

async function isLikelyUnpackedExtensionConfig(sourceProfileDir, config) {
  const currentPath = config?.path;
  if (!currentPath || typeof currentPath !== 'string' || !path.isAbsolute(currentPath)) {
    return false;
  }
  if (sourceProfileDir && isSubPath(sourceProfileDir, currentPath)) {
    return false;
  }
  return exists(path.join(currentPath, 'manifest.json'));
}

async function discoverInstalledExtensionIds(profileDir) {
  const extensionsDir = path.join(profileDir, 'Extensions');
  try {
    const entries = await fs.readdir(extensionsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter(isChromeExtensionId);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function isChromeExtensionId(value) {
  return /^[a-p]{32}$/.test(String(value));
}

async function cleanupTransientFiles(profileDir) {
  const transientNames = [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnCache',
    'GrShaderCache',
    'OptimizationGuidePredictionModels',
    'blob_storage',
    'Crashpad',
  ];

  await Promise.all(
    transientNames.map((name) =>
      fs.rm(path.join(profileDir, name), { recursive: true, force: true }),
    ),
  );
}

async function detectRunningChrome() {
  if (process.platform !== 'win32') {
    return [];
  }

  try {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH']);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseCsvProcessName)
      .filter((name) => name && name.toLowerCase() === 'chrome.exe');
  } catch {
    return [];
  }
}

function parseCsvProcessName(line) {
  const match = line.match(/^"([^"]+)"/);
  return match?.[1] ?? '';
}

function isSubPath(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function discoverProfileDirectories(userDataDir) {
  const entries = await fs.readdir(userDataDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === 'Default' || /^Profile \d+$/.test(name));
}

module.exports = {
  ROOT_EXCLUDES,
  FILE_EXCLUDES,
  getDefaultChromeUserDataDir,
  listChromeProfiles,
  cloneChromeProfiles,
  deleteChromeProfiles,
  createDirectoryKey,
  rewriteUnpackedExtensionPaths,
  countInstalledExtensions,
  countBookmarks,
  readJson,
  writeJson,
  exists,
  detectRunningChrome,
  isSubPath,
};
