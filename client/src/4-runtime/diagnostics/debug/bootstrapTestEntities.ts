import * as Engine from '../../../0-foundation/foundation/Engine';
import * as Utils from '../../../0-foundation/foundation/Utils';
import { addToScene } from '../../../2-systems/render/Scene';

export function bootstrapTestEntities(): void {
  const entityManager = Engine.getEntityManager();
  const entityRenderer = Engine.getEntityRenderer();

  if (entityManager && entityRenderer) {
    console.log('[App] EntityManager and EntityRenderer initialized, creating test entities...');

    const cubeEntity = entityManager.createEntity('TestCube', {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    cubeEntity.addComponent({
      name: 'render',
      data: {
        meshType: 'box',
        color: 0xff6b6b,
        geometry: { width: 2, height: 2, depth: 2 },
      },
    });
    entityRenderer.syncEntity(cubeEntity);

    const sphereEntity = entityManager.createEntity('TestSphere', {
      position: { x: -4, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    sphereEntity.addComponent({
      name: 'render',
      data: {
        meshType: 'sphere',
        color: 0x6b9eff,
        geometry: { radius: 1.5, segments: 32 },
      },
    });
    entityRenderer.syncEntity(sphereEntity);

    const groundEntity = entityManager.createEntity('Ground', {
      position: { x: 0, y: -3, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    groundEntity.addComponent({
      name: 'render',
      data: {
        meshType: 'plane',
        color: 0x444444,
        geometry: { width: 20, height: 20 },
      },
    });
    entityRenderer.syncEntity(groundEntity);

    console.log(`[App] Created ${entityManager.getEntityCount()} test entities`);
    return;
  }

  console.warn('[App] EntityManager or EntityRenderer not available, using fallback geometry');

  const testCube = Utils.createBox(2, 0xff6b6b);
  testCube.position.set(0, 0, 0);
  addToScene(testCube);

  const testSphere = Utils.createSphere(1.5, 0x6b9eff);
  testSphere.position.set(-4, 0, 0);
  addToScene(testSphere);

  const ground = Utils.createPlane(20, 20, 0x444444);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
  addToScene(ground);
}
