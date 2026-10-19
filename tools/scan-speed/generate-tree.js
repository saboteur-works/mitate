#!/usr/bin/env node
'use strict';
// Generates a deterministic tree of empty files for the scan measurement (Task 34).
// Plain Node, no dependencies.
//
// Shape: TOP_DIRS x MID_DIRS x LEAF_DIRS = 2000 leaf directories at depth 3 below the root
// (root/dNN/dNN/dNN). File i (0-based) goes in leaf directory floor(i / filesPerDir), where
// filesPerDir = ceil(count / 2000). Every file is 0 bytes. File i is named
// "f<index>.<ext>" where ext is chosen by i % 100 from MIX below.
//
// Usage as a module: generateTree(rootDir, count) -> { generated, supported, unsupported, filesPerDir, byExtension }
// Usage as a CLI:    node tools/scan-speed/generate-tree.js <absolute-dir> [count]

const fs = require('node:fs');
const path = require('node:path');

const TOP_DIRS = 20;
const MID_DIRS = 10;
const LEAF_DIRS = 10;
const LEAF_TOTAL = TOP_DIRS * MID_DIRS * LEAF_DIRS;

// [extension, number of slots out of 100, listed in the supported-type registry]
const MIX = [
  ['jpg', 70, true],
  ['png', 10, true],
  ['cr2', 5, true],
  ['mp4', 5, true],
  ['mp3', 4, true],
  ['pdf', 2, true],
  ['xyz', 2, false],
  ['tmp', 1, false],
  ['log', 1, false],
];

const SLOTS = [];
for (const [ext, n, supported] of MIX) for (let k = 0; k < n; k++) SLOTS.push([ext, supported]);

function pad(n) {
  return String(n).padStart(2, '0');
}

function leafPath(root, leafIndex) {
  const top = Math.floor(leafIndex / (MID_DIRS * LEAF_DIRS));
  const mid = Math.floor(leafIndex / LEAF_DIRS) % MID_DIRS;
  const leaf = leafIndex % LEAF_DIRS;
  return path.join(root, `d${pad(top)}`, `d${pad(mid)}`, `d${pad(leaf)}`);
}

function generateTree(root, count) {
  const filesPerDir = Math.ceil(count / LEAF_TOTAL);
  const byExtension = {};
  let supported = 0;
  let madeLeaf = -1;
  let leafDir = null;
  for (let i = 0; i < count; i++) {
    const leafIndex = Math.floor(i / filesPerDir);
    if (leafIndex !== madeLeaf) {
      leafDir = leafPath(root, leafIndex);
      fs.mkdirSync(leafDir, { recursive: true });
      madeLeaf = leafIndex;
    }
    const [ext, isSupported] = SLOTS[i % 100];
    fs.closeSync(fs.openSync(path.join(leafDir, `f${i}.${ext}`), 'wx'));
    byExtension[ext] = (byExtension[ext] || 0) + 1;
    if (isSupported) supported++;
  }
  return { generated: count, supported, unsupported: count - supported, filesPerDir, byExtension };
}

function describeShape() {
  return {
    depthBelowRoot: 3,
    directoriesPerLevel: [TOP_DIRS, MID_DIRS, LEAF_DIRS],
    leafDirectories: LEAF_TOTAL,
    mix: MIX.map(([ext, n, supported]) => ({ ext, percent: n, supported })),
  };
}

module.exports = { generateTree, describeShape, LEAF_TOTAL };

if (require.main === module) {
  const target = process.argv[2];
  const count = Number(process.argv[3] || 200000);
  if (!target || !path.isAbsolute(target) || !Number.isInteger(count) || count < 1) {
    console.error('usage: node generate-tree.js <absolute-dir> [count]');
    process.exit(2);
  }
  console.log(JSON.stringify(generateTree(target, count)));
}
