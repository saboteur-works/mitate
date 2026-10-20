'use strict';

/*
 * Holds a real scan inside the main process, so the collection's in-flight guard stays taken
 * while a test calls other channels. gateChannel (e2e-app.js) cannot do this: it stops a call
 * before the handler runs, so the service has not taken the guard yet.
 *
 * Discovery runs in a worker thread (src/main/discovery/run-scan.js), which listens to the
 * worker's 'message', 'error' and 'exit' events. holdNextScan wraps Worker.prototype.on, picks
 * the first worker that gets a listener after it was armed, and delivers all of that worker's
 * events, in their original order, only after release(). Workers created later, for example
 * another collection's scan, are not held. No production code carries a test hook.
 */

// Serialised into the main process by app.evaluate: self-contained.
function installHold() {
  const { Worker } = process.getBuiltinModule('node:worker_threads');
  if (!Worker.prototype.__moHeldOriginalOn) {
    Worker.prototype.__moHeldOriginalOn = Worker.prototype.on;
    Worker.prototype.on = function heldOn(event, listener) {
      const current = globalThis.__moScanHold;
      if (current.armed && ['message', 'error', 'exit'].includes(event)) {
        current.armed = false;
        current.target = this;
      }
      if (current.target !== this || current.released || !['message', 'error', 'exit'].includes(event)) {
        return Worker.prototype.__moHeldOriginalOn.call(this, event, listener);
      }
      return Worker.prototype.__moHeldOriginalOn.call(this, event, (...args) => {
        if (current.released) listener(...args);
        else current.queue.push(() => listener(...args));
      });
    };
  }
}

async function holdNextScan(app) {
  await app.evaluate(installHold);
  // Re-arm when the patch was installed by an earlier call.
  await app.evaluate(() => {
    globalThis.__moScanHold = { armed: true, target: null, released: false, queue: [] };
  });
  return {
    // True once a scan worker has been captured (the scan is running and held).
    started: () => app.evaluate(() => globalThis.__moScanHold.target !== null),
    release: () =>
      app.evaluate(() => {
        const state = globalThis.__moScanHold;
        state.released = true;
        for (const run of state.queue.splice(0)) run();
      }),
  };
}

module.exports = { holdNextScan };
