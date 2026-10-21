'use strict';

/*
 * View tabs (Feature 4, FR-1, FR-11): the tab row over the shared view area.
 *
 * Builds one button per TabsModel.TABS entry (Tree, Images, Audio, Video, Documents) into
 * [data-testid="view-tabs"] (role="tablist"). The WAI-ARIA tabs pattern with manual
 * activation: one Tab stop (the selected tab, tabindex 0, the others -1), ArrowLeft and
 * ArrowRight move focus with wrap-around, Home and End go to the first and last tab
 * (TabsModel.nextTab), Enter and Space (a button's click) or a click select the focused tab.
 * Focus alone never switches the view.
 *
 * The view area ([data-testid="view-area"], role="tabpanel", aria-labelledby the selected
 * tab) holds the tree container and the list container. Only the selected one is visible;
 * the other gets .view-inactive (visibility hidden, kept in layout) so the tree keeps its
 * expansion and scroll position while a list is shown.
 *
 * No collection selected (launch, after a delete): the tabs are disabled and the view is
 * Tree. Selecting a collection enables them and keeps the current view.
 *
 * This module only manages tab state and panel visibility. A change of view dispatches
 * `view-changed` on document with detail.view = the tab id ('tree', 'image', 'audio',
 * 'video', 'document'); the data is wired by type-views.js.
 *
 * API: window.ViewTabs = { current(), select(id) }
 */
(function () {
  const tabs = TabsModel.TABS;
  const tablist = document.querySelector('[data-testid="view-tabs"]');
  const panel = document.querySelector('[data-testid="view-area"]');
  const panels = {
    tree: document.querySelector('[data-testid="tree-view"]'),
    list: document.querySelector('[data-testid="list-view"]'),
  };

  let selected = 'tree';
  panel.id = panel.id || 'view-area';

  const buttons = tabs.map((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'view-tab-' + tab.id;
    button.dataset.testid = 'view-tab-' + tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panel.id);
    button.textContent = tab.label;
    button.disabled = true;
    button.addEventListener('click', () => select(tab.id));
    button.addEventListener('keydown', (event) => onKeyDown(event, tab.id));
    return button;
  });
  tablist.replaceChildren(...buttons);

  function sync() {
    tabs.forEach((tab, i) => {
      const on = tab.id === selected;
      buttons[i].setAttribute('aria-selected', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', 'view-tab-' + selected);
    panels.tree.classList.toggle('view-inactive', selected !== 'tree');
    panels.list.classList.toggle('view-inactive', selected === 'tree');
  }

  function select(id) {
    if (id === selected || !tabs.some((t) => t.id === id)) return;
    selected = id;
    sync();
    document.dispatchEvent(new CustomEvent('view-changed', { detail: { view: id } }));
  }

  function onKeyDown(event, id) {
    const from = tabs.findIndex((t) => t.id === id);
    const to = TabsModel.nextTab(from, event.key, tabs.length);
    if (to === null) return;
    event.preventDefault();
    buttons[to].focus();
  }

  document.addEventListener('collection-selected', (event) => {
    const active = event.detail.collectionId !== null;
    for (const button of buttons) button.disabled = !active;
    if (!active) select('tree');
  });

  sync();
  window.ViewTabs = { current: () => selected, select };
})();
