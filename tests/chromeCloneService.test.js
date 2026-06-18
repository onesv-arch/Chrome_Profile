const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createDirectoryKey,
  rewriteUnpackedExtensionPaths,
  countInstalledExtensions,
  countBookmarks,
  isSubPath,
  deleteChromeProfiles,
  collectRunningSelectedProfileIds,
  extractChromeFlagValue,
} = require('../src/core/chromeCloneService');

test('createDirectoryKey generates unique name and directory', () => {
  const localState = {
    profile: {
      info_cache: {
        'Profile 1': { name: 'Work Clone' },
      },
    },
  };

  const result = createDirectoryKey(localState, 'Work Clone', ['Profile 2']);

  assert.equal(result.name, 'Work Clone 2');
  assert.equal(result.directory, 'Profile 3');
});

test('rewriteUnpackedExtensionPaths copies unpacked extensions and rewrites path', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-cloner-test-'));
  const sourceExtension = path.join(tempRoot, 'my-unpacked-extension');
  const managedRoot = path.join(tempRoot, 'managed');
  await fs.mkdir(sourceExtension, { recursive: true });
  await fs.writeFile(path.join(sourceExtension, 'manifest.json'), '{"name":"Demo"}', 'utf8');

  const preferences = {
    extensions: {
      settings: {
        abcdef: {
          path: sourceExtension,
        },
      },
    },
  };

  const result = await rewriteUnpackedExtensionPaths({
    sourceId: 'Profile 1',
    sourceProfileDir: path.join(tempRoot, 'Profile 1'),
    targetDirectory: 'Profile 999',
    preferences,
    managedExtensionRoot: managedRoot,
  });

  assert.equal(result.copied.length, 1);
  assert.equal(result.warnings.length, 0);
  assert.notEqual(preferences.extensions.settings.abcdef.path, sourceExtension);
  const manifestCopied = path.join(preferences.extensions.settings.abcdef.path, 'manifest.json');
  const copiedManifest = await fs.readFile(manifestCopied, 'utf8');
  assert.match(copiedManifest, /Demo/);
});

test('rewriteUnpackedExtensionPaths reports missing unpacked source folder', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-cloner-test-'));
  const missingSource = path.join(tempRoot, 'missing-extension');

  const preferences = {
    extensions: {
      settings: {
        abcdef: {
          path: missingSource,
        },
      },
    },
  };

  const result = await rewriteUnpackedExtensionPaths({
    sourceId: 'Profile 1',
    sourceProfileDir: path.join(tempRoot, 'Profile 1'),
    targetDirectory: 'Profile 999',
    preferences,
    managedExtensionRoot: path.join(tempRoot, 'managed'),
  });

  assert.equal(result.copied.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /Skipped unpacked extension/);
});

test('countBookmarks sums nested bookmark items', () => {
  const total = countBookmarks({
    bookmark_bar: {
      children: [
        { type: 'url' },
        {
          children: [{ type: 'url' }, { type: 'folder', children: [{ type: 'url' }] }],
        },
      ],
    },
  });

  assert.equal(total, 3);
});

test('countInstalledExtensions counts extension ids from disk and ignores unpacked paths', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-cloner-test-'));
  const profileDir = path.join(tempRoot, 'Profile 1');
  const extensionsDir = path.join(profileDir, 'Extensions');
  const unpackedDir = path.join(tempRoot, 'my-unpacked-extension');

  await fs.mkdir(path.join(extensionsDir, 'abcdefghijklmnopabcdefghijklmnop', '1.0.0'), { recursive: true });
  await fs.mkdir(unpackedDir, { recursive: true });
  await fs.writeFile(path.join(unpackedDir, 'manifest.json'), '{"name":"Demo"}', 'utf8');

  const preferences = {
    extensions: {
      settings: {
        abcdefghijklmnopabcdefghijklmnop: {},
        ponmlkjihgfedcbaponmlkjihgfedcba: {
          path: unpackedDir,
        },
      },
    },
  };

  const count = await countInstalledExtensions(profileDir, preferences);
  assert.equal(count, 1);
});

test('deleteChromeProfiles removes profile folders and updates Local State', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-cloner-test-'));
  const userDataDir = path.join(tempRoot, 'User Data');
  const managedRoot = path.join(tempRoot, 'managed');
  const profileDir = path.join(userDataDir, 'Profile 3');

  await fs.mkdir(profileDir, { recursive: true });
  await fs.mkdir(path.join(managedRoot, 'Profile 3'), { recursive: true });
  await fs.writeFile(
    path.join(userDataDir, 'Local State'),
    JSON.stringify({
      profile: {
        last_used: 'Profile 3',
        info_cache: {
          'Profile 3': { name: 'To Delete' },
        },
      },
    }),
    'utf8',
  );

  const result = await deleteChromeProfiles({
    userDataDir,
    selectedProfileIds: ['Profile 3'],
    managedExtensionRoot: managedRoot,
    skipProcessCheck: true,
  });

  assert.equal(result.deleted.length, 1);
  assert.equal(await fs.stat(profileDir).then(() => true).catch(() => false), false);
  const localState = JSON.parse(await fs.readFile(path.join(userDataDir, 'Local State'), 'utf8'));
  assert.equal(localState.profile.last_used, 'Default');
  assert.equal(localState.profile.info_cache['Profile 3'], undefined);
});

test('isSubPath matches child and same path', () => {
  assert.equal(isSubPath('C:\\root', 'C:\\root'), true);
  assert.equal(isSubPath('C:\\root', 'C:\\root\\child'), true);
  assert.equal(isSubPath('C:\\root', 'C:\\other'), false);
});

test('extractChromeFlagValue reads quoted and unquoted Chrome flags', () => {
  const commandLine = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --profile-directory="Profile 5" --user-data-dir=C:\\Users\\Admin\\AppData\\Local\\Google\\Chrome\\User Data';

  assert.equal(extractChromeFlagValue(commandLine, 'profile-directory'), 'Profile 5');
  assert.equal(
    extractChromeFlagValue(commandLine, 'user-data-dir'),
    'C:\\Users\\Admin\\AppData\\Local\\Google\\Chrome\\User Data',
  );
  assert.equal(extractChromeFlagValue(commandLine, 'missing-flag'), null);
});

test('collectRunningSelectedProfileIds returns only selected open profiles once', () => {
  const result = collectRunningSelectedProfileIds(
    [
      { pid: 100, profileId: 'Profile 1' },
      { pid: 101, profileId: 'Profile 1' },
      { pid: 102, profileId: 'Profile 7' },
    ],
    ['Default', 'Profile 1', 'Profile 5'],
  );

  assert.deepEqual(result, ['Profile 1']);
});
