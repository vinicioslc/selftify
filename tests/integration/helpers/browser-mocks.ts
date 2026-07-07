/**
 * Creates a browser-compatible script that sets up:
 * 1. window.electronApi mock with virtual filesystem
 * 2. localStorage with pre-configured LOCAL origin
 *
 * This is a plain string since it runs via page.addInitScript().
 */

export type MockFileData = Array<{
  path: string;
  bytes: number[];
}>;

export function createMockInitScript(
  libraryPath: string,
  files: MockFileData,
): string {
  return `
(function() {
  var LIBRARY_PATH = ${JSON.stringify(libraryPath)};
  var FILES = new Map();   // path → Uint8Array
  var DIRS  = new Set();   // path → exists (directory)
  var WRITTEN = new Map(); // written files during scan

  // Normalize path separators
  function norm(p) {
    return p.replace(/\\\\/g, '/').replace(/\\/+$/, '');
  }

  // Register initial file bytes
  var fileData = ${JSON.stringify(files)};
  for (var i = 0; i < fileData.length; i++) {
    FILES.set(norm(fileData[i].path), new Uint8Array(fileData[i].bytes));
  }

  // Build directory tree from file paths
  function addPathToDirs(p) {
    var parts = p.replace(/\\\\/g, '/').split('/');
    var current = '';
    for (var j = 0; j < parts.length - 1; j++) {  // exclude the file name itself
      current = current ? current + '/' + parts[j] : parts[j];
      DIRS.add('/' + current);
    }
  }

  // Register all known directories
  for (var i = 0; i < fileData.length; i++) {
    addPathToDirs(fileData[i].path);
  }
  DIRS.add(LIBRARY_PATH);             // root
  DIRS.add(LIBRARY_PATH + '/.selftify');  // internal dir

  /**
   * Returns directory children — known files + subdirs.
   */
  function readDirEntries(dirPath) {
    var n = norm(dirPath);
    var result = [];
    var prefix = n === '/' ? '' : n;
    var seen = new Set();

    // Files at this path (initial data)
    FILES.forEach(function(_, fp) {
      var parent = fp.substring(0, fp.lastIndexOf('/'));
      if (parent === n) {
        var name = fp.substring(fp.lastIndexOf('/') + 1);
        if (!seen.has(name)) {
          seen.add(name);
          result.push({ name: name, path: fp, isDirectory: false, isFile: true });
        }
      }
    });

    // Written files at this path
    WRITTEN.forEach(function(_, fp) {
      var parent = fp.substring(0, fp.lastIndexOf('/'));
      if (parent === n) {
        var name = fp.substring(fp.lastIndexOf('/') + 1);
        if (!seen.has(name)) {
          seen.add(name);
          result.push({ name: name, path: fp, isDirectory: false, isFile: true });
        }
      }
    });

    // Subdirectories
    DIRS.forEach(function(dp) {
      var parent = dp.substring(0, dp.lastIndexOf('/'));
      if (parent === n || (parent === '' && n === '/')) {
        if (dp !== n) {
          var name = dp.substring(dp.lastIndexOf('/') + 1);
          if (!seen.has(name)) {
            seen.add(name);
            result.push({ name: name, path: dp, isDirectory: true, isFile: false });
          }
        }
      }
    });

    return result;
  }

  var electronApi = {
    fs: {
      readFile: async function(path) {
        var n = norm(path);
        if (FILES.has(n)) return FILES.get(n);
        if (WRITTEN.has(n)) return WRITTEN.get(n);
        return null;
      },
      readDirectory: async function(path) {
        return readDirEntries(path);
      },
      fileExists: async function(path) {
        var n = norm(path);
        if (FILES.has(n) || WRITTEN.has(n) || DIRS.has(n)) return true;
        return false;
      },
      getFileStats: async function(path) {
        var n = norm(path);
        if (FILES.has(n) || WRITTEN.has(n) || DIRS.has(n)) {
          return { size: 4096, modifiedAt: Date.now() };
        }
        return null;
      },
      writeFile: async function(path, data) {
        var n = norm(path);
        var arr = data instanceof Uint8Array ? data : new Uint8Array(data);
        WRITTEN.set(n, arr);

        // Ensure parent directory exists
        var parent = n.substring(0, n.lastIndexOf('/'));
        if (parent) DIRS.add(parent);
        return true;
      },
      createDirectory: async function(path) {
        DIRS.add(norm(path));
        return true;
      },
      renameFile: async function(oldPath, newPath) {
        var nOld = norm(oldPath);
        var nNew = norm(newPath);
        var data = FILES.get(nOld) || WRITTEN.get(nOld);
        if (data) {
          WRITTEN.set(nNew, data);
          FILES.delete(nOld);
          WRITTEN.delete(nOld);
        }
        var parent = nNew.substring(0, nNew.lastIndexOf('/'));
        if (parent) DIRS.add(parent);
        return true;
      },
      deleteFile: async function(path) {
        var n = norm(path);
        FILES.delete(n);
        WRITTEN.delete(n);
        return true;
      },
    },
    dialog: {
      openFolderPicker: async function() { return LIBRARY_PATH; },
      openFilePicker: async function() { return null; },
    },
    settings: {
      get: async function(key) { return null; },
      set: function(key, value) {},
    },
    yt: {
      checkVersion: async function() { return { found: false, version: null }; },
    },
    windowControls: {
      minimize: function() {},
      maximize: function() {},
      close: function() {},
      isMaximized: async function() { return false; },
      onMaximizeChange: function() { return function(){}; },
    },
    local: {},           // <-- empty = scanner falls back to music-metadata.parseBuffer
    lyrics: {},
    download: {},
    imageCache: {},
    imageFetch: function() { return { status: 404, headers: {}, body: [] }; },
    artworkSearch: function() { return []; },
    wikiSearch: function() { return null; },
    onCookiesInvalid: function() { return function(){}; },
    onDownloadProgress: function() { return function(){}; },
  };

  window.electronApi = electronApi;

  // Pre-set localStorage with a LOCAL origin
  var originId = (crypto.randomUUID && crypto.randomUUID()) || 'test-origin-id';
  var origin = {
    id: originId,
    name: 'Test Library',
    type: 'local',
    folderPath: LIBRARY_PATH,
    downloadFolder: LIBRARY_PATH,
    enableOnlineSearch: false,
    musicBrainzToken: null,
    organizeOnScan: false,
    organizeDryRun: false,
  };
  var authData = {
    state: {
      origins: [origin],
      currentOrigin: origin,
    },
    version: 0,
  };

  try {
    localStorage.setItem('ytmusic-auth', JSON.stringify(authData));
  } catch (e) {
    console.warn('[mock] failed to set localStorage:', e);
  }
})();
`;
}
