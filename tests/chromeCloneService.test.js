const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createDirectoryKey,
  rewriteUnpackedExtensionPaths,
  countBookmarks,
  isSubPath,
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

test('isSubPath matches child and same path', () => {
  assert.equal(isSubPath('C:\\root', 'C:\\root'), true);
  assert.equal(isSubPath('C:\\root', 'C:\\root\\child'), true);
  assert.equal(isSubPath('C:\\root', 'C:\\other'), false);
});
