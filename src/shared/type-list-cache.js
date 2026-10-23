'use strict';

// Per-load type list cache (Feature 4, FR-9, FR-10).
//
// Holds the data of one collection load (folder and file records) and the
// sorted list of each kind, built lazily on the first request for that kind and
// kept until the data is replaced. Kinds nobody opens are never built. All
// data enters through setData, the one update path (a rescan, add-folder,
// remove-folder or collection change calls it again, which drops every list).
// No DOM, no Node-only imports.
//
// Loading:
//   Node/Vitest (CommonJS):  const TypeListCache = require('../shared/type-list-cache.js');
//   renderer (script tag):   <script src="../shared/type-list-cache.js"></script>
//                            after type-list.js, then use the global `TypeListCache`.
//
// Exports: createTypeListCache(build?) -> { setData(folders, files), get(kind),
// clear() }. `build(folders, files, kind)` defaults to TypeList.buildTypeList;
// the argument exists so a test can count calls. get returns the build result
// unmodified, and the same array until the data is replaced; after clear (or
// before any setData) it returns [].
//
// The body is wrapped so a classic <script> load leaks only `TypeListCache`.
(function () {
  function defaultBuild(folders, files, kind) {
    const typeList =
      typeof module !== 'undefined' && module.exports ? require('./type-list.js') : globalThis.TypeList;
    return typeList.buildTypeList(folders, files, kind);
  }

  function createTypeListCache(build) {
    const buildList = typeof build === 'function' ? build : defaultBuild;
    let folders = null;
    let files = null;
    let lists = new Map();

    return {
      setData(newFolders, newFiles) {
        folders = newFolders;
        files = newFiles;
        lists = new Map();
      },
      get(kind) {
        if (folders === null) return [];
        if (!lists.has(kind)) lists.set(kind, buildList(folders, files, kind));
        return lists.get(kind);
      },
      clear() {
        folders = null;
        files = null;
        lists = new Map();
      },
    };
  }

  const TypeListCache = { createTypeListCache };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TypeListCache;
  } else {
    globalThis.TypeListCache = TypeListCache;
  }
})();
