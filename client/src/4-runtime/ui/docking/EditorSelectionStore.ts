export type EditorSelectionType = 'none' | 'map-node' | 'entity' | 'entities';

export interface EditorSelectionState {
  type: EditorSelectionType;
  nodeId: string | null;
  label: string | null;
  selectedIds?: string[];
}

type SelectionListener = (state: EditorSelectionState) => void;

const INITIAL_STATE: EditorSelectionState = {
  type: 'none',
  nodeId: null,
  label: null,
  selectedIds: undefined,
};

export class EditorSelectionStore {
  private state: EditorSelectionState = INITIAL_STATE;
  private readonly listeners = new Set<SelectionListener>();

  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): EditorSelectionState {
    return this.state;
  }

  clear(): void {
    this.setState(INITIAL_STATE);
  }

  selectMapNode(nodeId: string, label: string): void {
    this.setState({
      type: 'map-node',
      nodeId,
      label,
      selectedIds: undefined,
    });
  }

  selectEntity(entityId: string, label?: string): void {
    this.setState({
      type: 'entity',
      nodeId: entityId,
      label: label ?? entityId,
      selectedIds: [entityId],
    });
  }

  selectEntities(entityIds: string[], label?: string): void {
    const normalizedIds = Array.from(new Set(entityIds));
    if (normalizedIds.length === 0) {
      this.clear();
      return;
    }

    if (normalizedIds.length === 1) {
      this.selectEntity(normalizedIds[0], label);
      return;
    }

    this.setState({
      type: 'entities',
      nodeId: normalizedIds[0],
      label: label ?? `${normalizedIds.length} selected`,
      selectedIds: normalizedIds,
    });
  }

  toggleEntity(entityId: string, label?: string): void {
    const currentIds = this.state.selectedIds ?? [];
    const activeSet = new Set(currentIds);

    if (activeSet.has(entityId)) {
      activeSet.delete(entityId);
    } else {
      activeSet.add(entityId);
    }

    const nextIds = Array.from(activeSet);
    if (nextIds.length === 0) {
      this.clear();
      return;
    }

    if (nextIds.length === 1) {
      this.selectEntity(nextIds[0], label);
      return;
    }

    this.setState({
      type: 'entities',
      nodeId: nextIds[0],
      label: label ?? `${nextIds.length} selected`,
      selectedIds: nextIds,
    });
  }

  private setState(next: EditorSelectionState): void {
    if (
      this.state.type === next.type
      && this.state.nodeId === next.nodeId
      && this.state.label === next.label
      && JSON.stringify(this.state.selectedIds) === JSON.stringify(next.selectedIds)
    ) {
      return;
    }

    this.state = next;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
