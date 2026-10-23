'use strict';

/*
 * Type view controller (Feature 4, FR-1, FR-7, FR-9, FR-10, FR-11).
 *
 * Feeds the four type lists (Images, Audio, Video, Documents) from the collection view the
 * window already holds, next to the tree. Every place that shows, updates or clears the tree
 * calls the matching function here:
 *   TypeViews.show(view)    a collection load: new data, selection cleared
 *   TypeViews.update(view)  rescan, add-folder, remove-folder: new data, selection kept only if
 *                           its node id is still in the rebuilt list (ListView.render decides)
 *   TypeViews.clear()       no collection: data dropped, list emptied
 * `view` is { folders, files } as returned by the collections view. All data enters the cache
 * through TypeListCache.setData, the one update path, which drops every built list.
 *
 * A kind's list is built lazily, on the first open of its tab after a data change, and cached
 * until the next show/update/clear. The first open shows the loading state, yields so it can
 * paint, then sorts (a sort of 250,000 files took 678-743 ms in the measurement in the spec,
 * OQ-6; no worker). A token is bumped by every data change and view change: a build that
 * finds a newer token after the yield is dropped, so a response for a previous collection or
 * view never reaches the screen. Switching view (view-changed from view-tabs.js) clears the
 * selection of both the tree and the list and never scans or writes the store.
 */
(function () {
  const listEl = document.querySelector('[data-testid="list-view"]');
  const cache = TypeListCache.createTypeListCache();
  let hasData = false;
  let ready = new Set();
  let active = 'tree';
  let token = 0;

  // Resolves after the loading state had a chance to paint. The timer is the fallback for a
  // window that produces no frames (minimised, occluded).
  function paintYield() {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(fallback);
        resolve();
      };
      const fallback = setTimeout(resolve, 100);
      requestAnimationFrame(() => setTimeout(done, 0));
    });
  }

  async function showList(kind, options) {
    const mine = ++token;
    const emptyText = TabsModel.emptyText(kind);
    if (!hasData) {
      ListView.render(listEl, [], '', { reset: true });
      return;
    }
    if (ready.has(kind)) {
      ListView.render(listEl, cache.get(kind), emptyText, options);
      return;
    }
    ListView.setLoading(true, listEl);
    await paintYield();
    if (mine !== token) return;
    try {
      const rows = cache.get(kind);
      ready.add(kind);
      ListView.render(listEl, rows, emptyText, options);
    } catch (err) {
      ListView.render(listEl, [], `Could not build the list: ${err && err.message ? err.message : err}`, { reset: true });
    }
  }

  function setData(view) {
    cache.setData(view.folders, view.files);
    hasData = true;
    ready = new Set();
    token++;
  }

  function show(view) {
    setData(view);
    ListView.clearSelection();
    if (active !== 'tree') showList(active, { reset: true });
  }

  function update(view) {
    const scrollTop = listEl.scrollTop;
    setData(view);
    if (active !== 'tree') showList(active, { scrollTop });
  }

  function clear() {
    cache.clear();
    hasData = false;
    ready = new Set();
    token++;
    ListView.clearSelection();
    ListView.render(listEl, [], '', { reset: true });
  }

  document.addEventListener('view-changed', (event) => {
    active = event.detail.view;
    token++;
    ListView.clearSelection();
    window.TreeView.clearSelection();
    if (active !== 'tree') showList(active, { reset: true });
  });

  window.TypeViews = { show, update, clear };
})();
