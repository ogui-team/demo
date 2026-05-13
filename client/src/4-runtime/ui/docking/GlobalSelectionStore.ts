export interface GlobalSelectionSnapshot {
  selectedId: string | null;
  payload: unknown | null;
  version: number;
}

class GlobalSelectionStore {
  private snapshot: GlobalSelectionSnapshot = {
    selectedId: null,
    payload: null,
    version: 0,
  };

  getSnapshot(): GlobalSelectionSnapshot {
    return this.snapshot;
  }

  setSelection(selectedId: string, payload: unknown): void {
    this.snapshot = {
      selectedId,
      payload,
      version: this.snapshot.version + 1,
    };
  }

  clear(): void {
    this.snapshot = {
      selectedId: null,
      payload: null,
      version: this.snapshot.version + 1,
    };
  }
}

const globalSelectionStore = new GlobalSelectionStore();

export function getGlobalSelectionStore(): GlobalSelectionStore {
  return globalSelectionStore;
}