import { describe, it, expect } from 'vitest';
import { EditorSelectionStore } from '../../client/src/4-runtime/ui/docking/EditorSelectionStore';
import { HierarchyPanel } from '../../client/src/4-runtime/ui/docking/HierarchyPanel';

describe('Editor repair smoke tests', () => {
  it('keeps hierarchy rows ordered by label', () => {
    const entityManager = {
      getEntities: () => [
        { id: 'b', type: 'Entity', label: 'Box' },
        { id: 'a', type: 'Entity', label: 'Apple' },
        { id: 'c', type: 'Entity', label: 'Cube' },
      ],
      onEntityCreated: () => () => {},
      onEntityUpdated: () => () => {},
      onEntityDestroyed: () => () => {},
    };

    const selectionStore = new EditorSelectionStore();
    const hierarchy = new HierarchyPanel({ selectionStore, entityManager });

    const rows = Array.from(hierarchy.getElement().querySelectorAll('button'));
    expect(rows.map((row) => row.textContent)).toEqual(['Apple', 'Box', 'Cube']);

    hierarchy.destroy();
  });

  it('selection store toggles and clears correctly', () => {
    const store = new EditorSelectionStore();

    store.selectEntity('one', 'One');
    expect(store.getState()).toEqual({ type: 'entity', nodeId: 'one', label: 'One', selectedIds: ['one'] });

    store.toggleEntity('two', 'Two');
    expect(store.getState().type).toBe('entities');
    expect(store.getState().selectedIds).toContain('one');
    expect(store.getState().selectedIds).toContain('two');

    store.toggleEntity('one');
    expect(store.getState().type).toBe('entity');
    expect(store.getState().selectedIds).toEqual(['two']);

    store.clear();
    expect(store.getState().type).toBe('none');
    expect(store.getState().nodeId).toBeNull();
  });
});
