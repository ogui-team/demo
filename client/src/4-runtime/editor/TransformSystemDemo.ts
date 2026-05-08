/**
 * Transform System Demo & Usage Examples
 * 
 * The Transform System provides a centralized way to manage all entity
 * position, rotation, and scale modifications through StateManager.
 * 
 * Key Benefits:
 * - All modifications route through StateManager (consistency)
 * - Perfect for editor systems (undo/redo via state snapshots)
 * - Multiplayer-ready (state changes can be synced)
 * - Save/load compatible (transforms stored in state)
 * - Type-safe (full TypeScript support)
 */

import * as Engine from '../../0-foundation/foundation/Engine';
import { Entity, Vector3, Transform } from '@engine/1-kernel/core/public-api';

/**
 * Example: Get transform system
 */
export function exampleGetTransformSystem() {
  const transformSystem = Engine.getTransformSystem();
  if (!transformSystem) {
    console.error('Transform system not initialized');
    return;
  }
  console.log('✓ Transform system available');
}

/**
 * Example: Get entity position through StateManager
 */
export function exampleGetPosition() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  const position = transformSystem.getPosition(entity);
  console.log('Entity position:', position);
  // Output: { x: 5, y: 1, z: -3 }
}

/**
 * Example: Set entity position through StateManager
 * This is the CORRECT way - ensures state consistency
 */
export function exampleSetPosition() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  // Set position (updates both entity and StateManager)
  transformSystem.setPosition(entity, { x: 10, y: 2, z: 0 });
  console.log('✓ Position updated');

  // Verify it was stored in state
  const pos = transformSystem.getPosition(entity);
  console.log('Verified position:', pos);
}

/**
 * Example: Translate (move) entity relative to current position
 */
export function exampleTranslate() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  // Move 1 unit right, 0.5 units up, -2 units forward
  transformSystem.translate(entity, 1, 0.5, -2);
  console.log('✓ Entity translated');
}

/**
 * Example: Rotate entity around an axis
 */
export function exampleRotate() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  // Rotate 45 degrees (π/4 radians) around Y axis
  const angle = Math.PI / 4;
  transformSystem.rotateAxis(entity, 'y', angle);
  console.log('✓ Entity rotated 45° around Y axis');
}

/**
 * Example: Scale entity
 */
export function exampleScale() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  // Double size in X, keep Y/Z same
  transformSystem.scale(entity, 2, 1, 1);
  console.log('✓ Entity scaled');

  // Or scale uniformly
  transformSystem.scale(entity, 1.5); // 1.5x on all axes
  console.log('✓ Entity uniformly scaled to 1.5x');
}

/**
 * Example: Get full transform object
 */
export function exampleGetFullTransform() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  const transform = transformSystem.getTransform(entity);
  console.log('Full transform:', transform);
  // Output: { position: {...}, rotation: {...}, scale: {...} }
}

/**
 * Example: Set full transform
 */
export function exampleSetFullTransform() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  transformSystem.setTransform(entity, {
    position: { x: 0, y: 5, z: 10 },
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
    scale: { x: 2, y: 2, z: 2 },
  });
  console.log('✓ Full transform set');
}

/**
 * Example: Subscribe to transform changes
 * Useful for reactive UI (inspector panels, gizmos, etc.)
 */
export function exampleSubscribeToTransform() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  // Subscribe to any transform changes
  const unsubscribe = transformSystem.subscribe(entity, (newTransform, oldTransform) => {
    console.log('Transform changed:');
    console.log('  Old:', oldTransform);
    console.log('  New:', newTransform);

    // Update UI inspector panels, visual gizmos, etc.
    updateInspectorPanel(entity, newTransform);
  });

  // Later, unsubscribe when done
  // unsubscribe();
}

/**
 * Example: Create and manage an entity with transforms
 */
export function exampleCreateAndTransform() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();
  const entityRenderer = Engine.getEntityRenderer();

  if (!entityManager || !transformSystem || !entityRenderer) return;

  // Create entity
  const entity = entityManager.createEntity('Player', {
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  });

  // Add render component
  entity.addComponent({
    name: 'render',
    data: {
      meshType: 'sphere',
      color: 0xff0000,
      geometry: { radius: 1, segments: 32 },
    },
  });
  entityRenderer.syncEntity(entity);

  // Now transform it through the system
  transformSystem.setPosition(entity, { x: 5, y: 2, z: -3 });
  transformSystem.rotateAxis(entity, 'y', Math.PI / 4);

  console.log('✓ Entity created and transformed:', transformSystem.getTransform(entity));
}

/**
 * Example: Use transforms for animation
 * On each frame, modify transforms through the system
 */
export function exampleAnimateWithTransforms() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  // Initialize animation timer
  let time = 0;
  const animationSpeed = 2; // cycles per second

  // Call this on each render frame
  const animateFrame = (deltaTime: number): void => {
    time += deltaTime * animationSpeed;

    // Circular motion around center
    const radius = 5;
    const x = Math.cos(time * Math.PI * 2) * radius;
    const z = Math.sin(time * Math.PI * 2) * radius;
    const y = Math.sin(time * Math.PI * 2) * 2 + 1;

    transformSystem.setPosition(entity, { x, y, z });

    // Rotation
    transformSystem.setRotation(entity, {
      x: 0,
      y: time * Math.PI * 2,
      z: 0,
    });
  };

  // Hook into game loop
  // Engine.onUpdate((deltaTime) => animateFrame(deltaTime));
}

/**
 * Example: Editor gizmo system
 * Move/rotate/scale entities through inspector
 */
export function exampleEditorGizmo() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  // Simulate editor inspector inputs
  function handleInspectorChange(entityId: string, transformType: 'position' | 'rotation' | 'scale', values: Vector3) {
    const entity = entityManager!.getEntity(entityId);
    if (!entity) return;

    switch (transformType) {
      case 'position':
        transformSystem!.setPosition(entity, values);
        break;
      case 'rotation':
        transformSystem!.setRotation(entity, values);
        break;
      case 'scale':
        transformSystem!.setScale(entity, values);
        break;
    }

    console.log(`✓ ${transformType} changed for ${entityId}`);
  }

  // UI form submission
  handleInspectorChange('entity_0', 'position', { x: 10, y: 5, z: 0 });
  handleInspectorChange('entity_0', 'rotation', { x: 0, y: Math.PI / 2, z: 0 });
  handleInspectorChange('entity_0', 'scale', { x: 2, y: 2, z: 2 });
}

/**
 * Example: Batch transform multiple entities
 */
export function exampleBatchTransform() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  // Get all entities of a type (e.g., enemies)
  const enemies = entityManager.getEntitiesByType('Enemy');

  // Apply transform to all (e.g., move them together)
  enemies.forEach((enemy, index) => {
    transformSystem!.setPosition(enemy, {
      x: index * 2,
      y: 1,
      z: 0,
    });
  });

  console.log(`✓ Transformed ${enemies.length} enemies`);
}

/**
 * Example: Get all entity transforms (snapshot)
 * Useful for saving/serializing
 */
export function exampleGetAllTransforms() {
  const transformSystem = Engine.getTransformSystem();

  if (!transformSystem) return;

  const allTransforms = transformSystem.getAllTransforms();

  allTransforms.forEach((transform, entityId) => {
    console.log(`${entityId}:`, transform);
  });

  // Output:
  // entity_0: { position: {...}, rotation: {...}, scale: {...} }
  // entity_1: { position: {...}, rotation: {...}, scale: {...} }
}

/**
 * Example: Restore entity from saved state
 * Useful for load/undo operations
 */
export function exampleRestoreTransformFromState() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();

  if (!entityManager || !transformSystem) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  // Sync entity's transform from StateManager
  // (useful after loading from save)
  transformSystem.syncFromState(entity);
  console.log('✓ Entity restored from state:', transformSystem.getTransform(entity));
}

/**
 * Example: State consistency check
 * Ensure local entity matches StateManager
 */
export function exampleVerifyStateConsistency() {
  const entityManager = Engine.getEntityManager();
  const transformSystem = Engine.getTransformSystem();
  const stateManager = Engine.getEngineState();

  if (!entityManager || !transformSystem || !stateManager) return;

  const entity = entityManager.getEntity('entity_0');
  if (!entity) return;

  // Get from TransformSystem (StateManager-backed)
  const systemTransform = transformSystem.getTransform(entity);

  // Get from entity directly (local)
  const entityTransform = entity.getTransform();

  // They should match!
  const match =
    JSON.stringify(systemTransform) === JSON.stringify(entityTransform);
  console.log('State consistency check:', match ? '✓ PASS' : '✗ FAIL');

  if (!match) {
    console.warn('Transforms do not match!');
    console.log('System:', systemTransform);
    console.log('Entity:', entityTransform);
  }
}

/**
 * Helper: Update inspector UI panel with transform
 */
function updateInspectorPanel(entity: Entity, transform: Transform) {
  const inspectorPanel = document.getElementById('inspector');
  if (!inspectorPanel) return;

  inspectorPanel.innerHTML = `
    <div style="font-family: monospace; font-size: 12px;">
      <div><strong>${entity.id}</strong> (${entity.type})</div>
      <div style="margin-top: 8px;">
        <div>Position:</div>
        <div style="margin-left: 16px;">
          X: ${transform.position.x.toFixed(2)}
          Y: ${transform.position.y.toFixed(2)}
          Z: ${transform.position.z.toFixed(2)}
        </div>
      </div>
      <div style="margin-top: 8px;">
        <div>Rotation (rad):</div>
        <div style="margin-left: 16px;">
          X: ${transform.rotation.x.toFixed(4)}
          Y: ${transform.rotation.y.toFixed(4)}
          Z: ${transform.rotation.z.toFixed(4)}
        </div>
      </div>
      <div style="margin-top: 8px;">
        <div>Scale:</div>
        <div style="margin-left: 16px;">
          X: ${transform.scale!.x.toFixed(2)}
          Y: ${transform.scale!.y.toFixed(2)}
          Z: ${transform.scale!.z.toFixed(2)}
        </div>
      </div>
    </div>
  `;
}

// Export console API for easy testing
(window as any).TransformAPI = {
  getSystem: Engine.getTransformSystem,
  getPosition: exampleGetPosition,
  setPosition: exampleSetPosition,
  translate: exampleTranslate,
  rotate: exampleRotate,
  scale: exampleScale,
  getTransform: exampleGetFullTransform,
  setTransform: exampleSetFullTransform,
  subscribe: exampleSubscribeToTransform,
};

console.log(
  '%c[Transform System Demo Loaded]%c\nUsage: TransformAPI.getPosition(), TransformAPI.setPosition(), etc.\nSee TransformSystemDemo.ts for all examples.',
  'color: #0f0; font-weight: bold;',
  'color: #aaa;'
);
