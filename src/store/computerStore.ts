import { create } from 'zustand';
import type { ApplicationRegistry } from '../core/applications/ApplicationRegistry';
import { VirtualComputer } from '../core/computer/VirtualComputer';
import { errorMessage } from '../core/errors';
import { AutoSaver } from '../core/storage/AutoSaver';
import { IndexedDBBackend, MemoryBackend } from '../core/storage/backends';
import { ComputerStorage } from '../core/storage/ComputerStorage';

interface ComputerState {
  status: 'idle' | 'booting' | 'ready';
  computer: VirtualComputer | null;
  registry: ApplicationRegistry | null;
  storage: ComputerStorage | null;
  saver: AutoSaver | null;
  /** True when IndexedDB is unavailable and changes will not survive a reload. */
  volatile: boolean;
  boot(registry: ApplicationRegistry): Promise<void>;
  /** Wipes every saved byte and boots a brand-new computer. */
  reset(): Promise<void>;
  flush(): Promise<void>;
}

function createStorage(): { storage: ComputerStorage; volatile: boolean } {
  try {
    return { storage: new ComputerStorage(new IndexedDBBackend()), volatile: false };
  } catch {
    return { storage: new ComputerStorage(new MemoryBackend()), volatile: true };
  }
}

/** Holds the running computer instance and its persistence. */
export const useComputerStore = create<ComputerState>((set, get) => {
  const power = (computer: VirtualComputer, storage: ComputerStorage) => {
    computer.start();
    return new AutoSaver(computer, storage);
  };

  return {
    status: 'idle',
    computer: null,
    registry: null,
    storage: null,
    saver: null,
    volatile: false,

    async boot(registry) {
      if (get().status !== 'idle') return;
      set({ status: 'booting' });
      let { storage, volatile } = createStorage();
      let snapshot = null;
      let loadError: unknown = null;
      try {
        snapshot = await storage.load();
      } catch (e) {
        loadError = e;
        storage = new ComputerStorage(new MemoryBackend());
        volatile = true;
      }
      let computer: VirtualComputer;
      try {
        computer = new VirtualComputer({ applications: registry, snapshot });
      } catch (e) {
        // Saved data is unusable: start from scratch rather than leaving the user with a blank page.
        loadError = e;
        computer = new VirtualComputer({ applications: registry });
      }
      const saver = power(computer, storage);
      if (loadError) computer.notifications.warning('Saved data could not be loaded', errorMessage(loadError));
      if (volatile) computer.notifications.warning('Storage unavailable', 'Changes will be lost when the page is closed.');
      set({ status: 'ready', computer, registry, storage, saver, volatile });
      void saver.flush();
    },

    async reset() {
      const { computer, saver, storage, registry } = get();
      if (!storage || !registry) return;
      saver?.dispose();
      computer?.stop();
      await storage.reset();
      const fresh = new VirtualComputer({ applications: registry });
      const nextSaver = power(fresh, storage);
      set({ computer: fresh, saver: nextSaver });
      await nextSaver.flush();
      fresh.notifications.success('Computer reset', 'All data was erased and the default system was restored.');
    },

    async flush() {
      await get().saver?.flush();
    },
  };
});
