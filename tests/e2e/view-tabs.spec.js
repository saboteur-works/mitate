'use strict';

/*
 * View tabs e2e (Feature 4, Task 8; FR-1, FR-11). The collection is written to <userDataDir>/store.json
 * before launch with the real service + scanner. The spec checks the page layout (Rescan section above
 * the tab row, no "Tree" section heading), the WAI-ARIA tabs roles and keys, and which panel content is
 * shown for each tab. The data of the lists is checked in type-views-wiring.spec.js.
 */

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, selectOnlyCollection } = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const TABS = [
  ['tree', 'Tree'],
  ['image', 'Images'],
  ['audio', 'Audio'],
  ['video', 'Video'],
  ['document', 'Documents'],
];

test('view tabs: layout, roles, panels, and keyboard model', async () => {
  const userDataDir = newUserDataDir('view-tabs-e2e');
  const fixture = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Tabs', [fixture.root]);

    session = await launchApp(userDataDir);
    const { window } = session;
    const tab = (id) => window.getByTestId(`view-tab-${id}`);
    const treeView = window.getByTestId('tree-view');
    const listView = window.getByTestId('list-view');
    const area = window.getByTestId('view-area');

    // Layout: no section headed "Tree"; Rescan and its status are in rescan-section, before the tab row.
    await expect(window.getByRole('heading', { name: 'Tree', exact: true })).toHaveCount(0);
    const rescanSection = window.getByTestId('rescan-section');
    await expect(rescanSection.getByTestId('rescan')).toHaveCount(1);
    await expect(rescanSection.getByTestId('rescan-status')).toHaveCount(1);
    const order = await window.evaluate(() => {
      const section = document.querySelector('[data-testid="rescan-section"]');
      const tabs = document.querySelector('[data-testid="view-tabs"]');
      return section.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();

    // Roles: tablist with five tabs, labelled; the view area is a tabpanel.
    await expect(window.getByRole('tablist')).toHaveCount(1);
    await expect(window.getByRole('tab')).toHaveCount(5);
    for (const [id, label] of TABS) await expect(tab(id)).toHaveText(label);
    await expect(area).toHaveAttribute('role', 'tabpanel');

    // No collection yet: the tabs are disabled and nothing is shown.
    for (const [id] of TABS) await expect(tab(id)).toBeDisabled();
    await expect(window.getByTestId('tree-row')).toHaveCount(0);
    await expect(window.getByTestId('list-row')).toHaveCount(0);

    await selectOnlyCollection(window);
    for (const [id] of TABS) await expect(tab(id)).toBeEnabled();

    // Exactly one tab is selected, Tree first; only it is a Tab stop; the panel is labelled by it.
    const selectedCount = () => window.locator('[role="tab"][aria-selected="true"]').count();
    expect(await selectedCount()).toBe(1);
    await expect(tab('tree')).toHaveAttribute('aria-selected', 'true');
    await expect(area).toHaveAttribute('aria-labelledby', 'view-tab-tree');
    await expect(treeView).toBeVisible();
    await expect(listView).toBeHidden();

    // Clicking a tab selects it and shows only its panel content; Rescan stays visible and enabled.
    for (const [id] of TABS) {
      await tab(id).click();
      await expect(tab(id)).toHaveAttribute('aria-selected', 'true');
      expect(await selectedCount()).toBe(1);
      await expect(area).toHaveAttribute('aria-labelledby', `view-tab-${id}`);
      if (id === 'tree') {
        await expect(treeView).toBeVisible();
        await expect(listView).toBeHidden();
      } else {
        await expect(listView).toBeVisible();
        await expect(treeView).toBeHidden();
      }
      for (const [other] of TABS) {
        await expect(tab(other)).toHaveAttribute('tabindex', other === id ? '0' : '-1');
      }
      await expect(rescanSection.getByTestId('rescan')).toBeVisible();
      await expect(rescanSection.getByTestId('rescan')).toBeEnabled();
      await expect(rescanSection.getByTestId('rescan-status')).toBeAttached();
    }

    // Keyboard: arrows move focus (no activation) and wrap, Home and End jump, Enter and Space activate.
    await tab('tree').click();
    await tab('tree').focus();
    await window.keyboard.press('ArrowRight');
    await expect(tab('image')).toBeFocused();
    await expect(tab('tree')).toHaveAttribute('aria-selected', 'true');
    await window.keyboard.press('ArrowLeft');
    await expect(tab('tree')).toBeFocused();
    await window.keyboard.press('ArrowLeft');
    await expect(tab('document')).toBeFocused();
    await window.keyboard.press('ArrowRight');
    await expect(tab('tree')).toBeFocused();
    await window.keyboard.press('End');
    await expect(tab('document')).toBeFocused();
    await window.keyboard.press('Home');
    await expect(tab('tree')).toBeFocused();
    await expect(tab('tree')).toHaveAttribute('aria-selected', 'true');
    await window.keyboard.press('ArrowRight');
    await window.keyboard.press('ArrowRight');
    await expect(tab('audio')).toBeFocused();
    await window.keyboard.press('Enter');
    await expect(tab('audio')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('tree')).toHaveAttribute('aria-selected', 'false');
    await window.keyboard.press('ArrowRight');
    await expect(tab('video')).toBeFocused();
    await window.keyboard.press('Space');
    await expect(tab('video')).toHaveAttribute('aria-selected', 'true');
    expect(await selectedCount()).toBe(1);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(fixture.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
