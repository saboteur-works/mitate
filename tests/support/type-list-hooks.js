'use strict';

/*
 * Test-only probes for the type lists, installed from outside the app. Nothing in src/ knows
 * about them: installTypeListHooks wraps the renderer's global TypeList.buildTypeList (the
 * cache looks it up on every build, see src/shared/type-list-cache.js) through page.evaluate,
 * the way tests/support/scan-hold.js patches Worker.prototype.on in the main process. The patch
 * lives in one page and is gone when the page reloads or the app closes.
 *
 * What the wrapper does on every build:
 *   - counts the build per kind (buildCounts);
 *   - records what the DOM showed when the sort started (buildLog): whether the `list-loading`
 *     element was present and how many `list-row` elements were present, so a test can assert
 *     that the loading state was on screen before the rows were built;
 *   - busy-waits setSortDelay(ms) milliseconds before sorting, which widens the window in which
 *     the loading state is the only thing shown. The wait blocks the page, so a test must not
 *     rely on polling the page during it; it reads buildLog afterwards instead.
 */

async function installTypeListHooks(window) {
  await window.evaluate(() => {
    if (window.__moTypeHooks) return;
    const state = (window.__moTypeHooks = { counts: {}, log: [], delayMs: 0 });
    const original = TypeList.buildTypeList;
    TypeList.buildTypeList = function (folders, files, kind) {
      state.counts[kind] = (state.counts[kind] || 0) + 1;
      state.log.push({
        kind,
        loadingShown: document.querySelector('[data-testid="list-loading"]') !== null,
        rowsShown: document.querySelectorAll('[data-testid="list-row"]').length,
      });
      const end = performance.now() + state.delayMs;
      while (performance.now() < end) { /* hold the sort */ }
      return original.call(this, folders, files, kind);
    };
  });
}

// Number of builds per kind since the hooks were installed: { image: 1, ... }.
const buildCounts = (window) => window.evaluate(() => ({ ...window.__moTypeHooks.counts }));

// What the DOM showed when each build started, in build order.
const buildLog = (window) => window.evaluate(() => window.__moTypeHooks.log.map((e) => ({ ...e })));

// Makes every following sort take at least `ms` milliseconds (0 turns it off).
const setSortDelay = (window, ms) =>
  window.evaluate((value) => { window.__moTypeHooks.delayMs = value; }, ms);

module.exports = { installTypeListHooks, buildCounts, buildLog, setSortDelay };
