'use strict';

/*
 * Shared in-flight state (FR-12, renderer half). Controls that start a long
 * operation on a collection call CollectionBusy.begin(id, kind) ('rescan',
 * 'add-folder') and end(id) when it finishes; other controls read isBusy(id) or
 * holder(id) (the kind, null when idle) and re-sync on the
 * 'collection-busy-changed' event dispatched on document with
 * detail.collectionId. The event fires once per state change: a begin on a
 * collection already busy, or an end on one that is not, changes nothing and
 * fires nothing. The main-process refusal stays the authority.
 */
(function () {
  const busy = new Map();

  function announce(id) {
    document.dispatchEvent(new CustomEvent('collection-busy-changed', { detail: { collectionId: id } }));
  }

  window.CollectionBusy = {
    begin(id, kind) {
      if (busy.has(id)) return false;
      busy.set(id, kind === undefined ? null : kind);
      announce(id);
      return true;
    },
    end(id) {
      if (!busy.delete(id)) return false;
      announce(id);
      return true;
    },
    isBusy(id) {
      return busy.has(id);
    },
    holder(id) {
      return busy.has(id) ? busy.get(id) : null;
    },
  };
})();
