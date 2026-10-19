'use strict';

/*
 * Test seam for the storage module's `config.fs`: records every
 * write-then-rename of a store file. `events` is an ordered list of
 * { op: 'write'|'rename', from?, to?, file? } entries; `renames` counts the
 * renames onto the store file (one per persisted write).
 */
const fs = require('node:fs');
const path = require('node:path');

function createCountingFs() {
  const events = [];
  return {
    events,
    get renames() {
      return events.filter((e) => e.op === 'rename').length;
    },
    reset() {
      events.length = 0;
    },
    impl: {
      writeFileSync(file, data, ...rest) {
        fs.writeFileSync(file, data, ...rest);
        events.push({ op: 'write', file, existsAfter: fs.existsSync(file) });
      },
      renameSync(from, to) {
        events.push({
          op: 'rename',
          from,
          to,
          sameDir: path.dirname(from) === path.dirname(to),
          tempExistedBeforeRename: fs.existsSync(from),
        });
        fs.renameSync(from, to);
      },
    },
  };
}

module.exports = { createCountingFs };
