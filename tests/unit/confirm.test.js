import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createConfirmer } = require('../../src/main/confirm.js');

const args = { title: 'Remove', message: 'Remove X?', detail: 'Files stay.', confirmLabel: 'Remove' };

function setup({ response = 0, win = null, reject } = {}) {
  const showMessageBox = vi.fn(() => (reject ? Promise.reject(reject) : Promise.resolve({ response })));
  const confirm = createConfirmer({ dialog: { showMessageBox }, getWindow: () => win });
  return { showMessageBox, confirm };
}

describe('createConfirmer', () => {
  it('passes warning options with the given text and Cancel as default and cancel', async () => {
    const { showMessageBox, confirm } = setup();
    await confirm(args);
    expect(showMessageBox).toHaveBeenCalledWith({
      type: 'warning', title: 'Remove', message: 'Remove X?', detail: 'Files stay.',
      buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1,
    });
  });

  it('resolves true for response 0', async () => {
    expect(await setup({ response: 0 }).confirm(args)).toBe(true);
  });

  it('resolves false for response 1', async () => {
    expect(await setup({ response: 1 }).confirm(args)).toBe(false);
  });

  it('rejects when the dialog rejects', async () => {
    const { confirm } = setup({ reject: new Error('closed') });
    await expect(confirm(args)).rejects.toThrow('closed');
  });

  it('passes a live window as the first argument', async () => {
    const win = { isDestroyed: () => false };
    const { showMessageBox, confirm } = setup({ win });
    await confirm(args);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toBe(win);
    expect(showMessageBox.mock.calls[0]).toHaveLength(2);
  });

  it('calls showMessageBox(options) when there is no window', async () => {
    const { showMessageBox, confirm } = setup({ win: null });
    await confirm(args);
    expect(showMessageBox.mock.calls[0]).toHaveLength(1);
    expect(showMessageBox.mock.calls[0][0].type).toBe('warning');
  });

  it('does not pass a destroyed window', async () => {
    const { showMessageBox, confirm } = setup({ win: { isDestroyed: () => true } });
    await confirm(args);
    expect(showMessageBox.mock.calls[0]).toHaveLength(1);
  });
});
