import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { registerIpc } = require('../../src/main/ipc.js');
const { installWrapperInMain, IPC_MODULE_PATH } = require('../support/ipc-wrap.js');

// Emulates electronApp.evaluate: the function source is rebuilt in a fresh context
// that has process but NO require global (as in the Electron main process).
function inMainContext(processLike) {
  const registered = new Map();
  const ipcMain = {
    handle: (ch, fn) => registered.set(ch, fn),
    removeHandler: (ch) => registered.delete(ch),
  };
  const ctx = vm.createContext({ process: processLike });
  const fn = vm.runInContext(`(${installWrapperInMain.toString()})`, ctx);
  return { registered, run: (arg) => fn({ ipcMain }, arg) };
}

describe('wrapHandler in-main code', () => {
  it('installs a wrapper that delegates to the originally registered handler', async () => {
    const parentHandlers = new Map();
    registerIpc({
      ipcMain: { handle: (ch, fn) => parentHandlers.set(ch, fn) },
      dialog: {},
      service: {},
      rescanService: {
        rescanCollection: async (id) => ({ summary: { id }, marker: 'original' }),
      },
    });
    const original = parentHandlers.get('collections:rescan');
    expect(typeof original).toBe('function');

    const m = inMainContext(process);
    m.run({
      ipcPath: IPC_MODULE_PATH,
      channel: 'collections:rescan',
      source: '(original) => async (e, ...a) => ({ wrapped: true, inner: await original(e, ...a) })',
    });
    const wrapper = m.registered.get('collections:rescan');
    expect(typeof wrapper).toBe('function');
    expect(wrapper).not.toBe(original);
    const result = await wrapper({}, 'c1');
    expect(result.wrapped).toBe(true);
    expect(result.inner).toEqual(await original({}, 'c1'));
    expect(result.inner.ok).toBe(true);
  });

  it('throws a diagnostic error when no require mechanism exists', () => {
    const m = inMainContext({ versions: { node: '0.0.0', electron: '9.9.9' } });
    expect(() =>
      m.run({ ipcPath: IPC_MODULE_PATH, channel: 'c', source: '() => 0' }),
    ).toThrow(/getBuiltinModule.*0\.0\.0.*9\.9\.9/s);
  });
});
