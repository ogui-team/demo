# Task 04 — Inspector Component Display

## Problem
`InspectorPanel` only shows "Selection: [label]".
`ComponentInspector` already emits a full component payload when an entity is selected — but nobody renders it.

The event that fires is `EDITOR_ENTITY_SELECTED` on `gameBus`.
The payload looks like:
```typescript
{
  entityId: string,
  entityType: string,
  transform: { position: {x,y,z}, rotation: {x,y,z}, scale: {x,y,z} },
  components: [{ name: string, data: Record<string, unknown> }],
}
```

## What to do

### Step 1 — Listen to EDITOR_ENTITY_SELECTED in InspectorPanel

In `client/src/4-runtime/ui/docking/InspectorPanel.ts`, import `gameBus`:
```typescript
import { gameBus } from '@engine/1-kernel/core/public-api';
```

Add a section in the root element for component data:
```typescript
this.componentSection = document.createElement('div');
this.componentSection.style.cssText = 'padding:8px;';
this.root.appendChild(this.componentSection);
```

Subscribe to the selection event in the constructor:
```typescript
const unsub = gameBus.on('EDITOR_ENTITY_SELECTED', (payload) => {
  this.renderComponents(payload);
});
this.destroyFns.push(unsub);

const unsubDeselect = gameBus.on('EDITOR_ENTITY_DESELECTED', () => {
  this.componentSection.replaceChildren();
});
this.destroyFns.push(unsubDeselect);
```

### Step 2 — Render components

Add this method to `InspectorPanel`:
```typescript
private renderComponents(payload: any): void {
  this.componentSection.replaceChildren();

  // Show entity type
  const typeLabel = document.createElement('div');
  typeLabel.textContent = `Type: ${payload.entityType}`;
  typeLabel.style.cssText = 'font-size:11px;color:var(--suite-fg-2);padding:4px 0;';
  this.componentSection.appendChild(typeLabel);

  // Show transform
  this.componentSection.appendChild(this.renderTransformSection(payload.entityId, payload.transform));

  // Show each component as a collapsible section
  for (const component of payload.components) {
    this.componentSection.appendChild(this.renderComponentSection(payload.entityId, component));
  }
}

private renderTransformSection(entityId: string, transform: any): HTMLElement {
  const section = this.createSection('Transform');
  
  for (const axis of ['x', 'y', 'z'] as const) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    
    const label = document.createElement('span');
    label.textContent = `pos.${axis}`;
    label.style.cssText = 'font-size:11px;color:var(--suite-fg-2);width:50px;';
    
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(transform.position[axis].toFixed(3));
    input.step = '0.1';
    input.style.cssText = 'width:80px;height:22px;background:var(--suite-bg-0);border:1px solid var(--suite-border);color:var(--suite-fg-0);padding:0 4px;';
    
    input.addEventListener('change', () => {
      gameBus.emit('EDITOR_UPDATE_COMPONENT', {
        entityId,
        componentName: 'transform',
        path: ['position', axis],
        value: parseFloat(input.value),
        source: 'editor_inspector',
      });
    });
    
    row.append(label, input);
    section.appendChild(row);
  }
  
  return section;
}

private renderComponentSection(entityId: string, component: { name: string; data: any }): HTMLElement {
  const section = this.createSection(component.name);
  
  // Just show the data as JSON for now — can improve later
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(component.data, null, 2);
  pre.style.cssText = 'font-size:10px;color:var(--suite-fg-2);overflow:auto;max-height:120px;margin:0;';
  section.appendChild(pre);
  
  return section;
}
```

## Notes
- The JSON display for non-transform components is intentionally simple — it's readable and gives you visibility
- Position editing is the most important field to edit live
- Rotation inputs can be added the same way as position — copy the `renderTransformSection` pattern
- The `EDITOR_UPDATE_COMPONENT` event is already handled by `ComponentInspector` — the wiring is already done, you just need to emit it

## Done when
- Selecting an entity in the viewport shows its components in the right panel
- Position fields are editable and move the entity when changed
