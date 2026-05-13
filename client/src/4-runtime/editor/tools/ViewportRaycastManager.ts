import * as THREE from 'three';
import { matchesRaycastLayers, type RaycastLayer } from '@engine/1-kernel/core/public-api';

export type ViewportPickType = 'entity' | 'gizmo' | 'overlay' | 'world' | 'none';

export interface ViewportPickResult {
  type: ViewportPickType;
  object: THREE.Object3D | null;
  point: THREE.Vector3 | null;
  normal: THREE.Vector3 | null;
  distance: number;
  entityId?: string;
  hitType?: string;
}

export interface ViewportRaycastConfig {
  raycastDistance?: number;
}

export class ViewportRaycastManager {
  private readonly raycaster: THREE.Raycaster;

  constructor(config: ViewportRaycastConfig = {}) {
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = config.raycastDistance ?? 10000;
  }

  createMouseVector(event: MouseEvent, canvas: HTMLCanvasElement): THREE.Vector2 {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  createRay(mouse: THREE.Vector2, camera: THREE.Camera): THREE.Ray {
    this.raycaster.setFromCamera(mouse, camera);
    return this.raycaster.ray;
  }

  raycastObjects(
    mouse: THREE.Vector2,
    camera: THREE.Camera,
    objects: THREE.Object3D[],
    recursive = true,
  ): THREE.Intersection[] {
    this.raycaster.setFromCamera(mouse, camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  raycastScene(
    mouse: THREE.Vector2,
    camera: THREE.Camera,
    scene: THREE.Scene,
    options?: {
      layerMask?: RaycastLayer[];
      exclude?: THREE.Object3D[];
    },
  ): THREE.Intersection[] {
    this.raycaster.setFromCamera(mouse, camera);
    const objects: THREE.Object3D[] = [];
    const excluded = new Set(options?.exclude ?? []);

    scene.traverseVisible((object) => {
      if (excluded.has(object)) return;
      if (options?.layerMask && !matchesRaycastLayers(object, options.layerMask)) return;
      objects.push(object);
    });

    return this.raycaster.intersectObjects(objects, true);
  }

  raycastPlane(
    mouse: THREE.Vector2,
    camera: THREE.Camera,
    plane: THREE.Plane,
  ): THREE.Vector3 | null {
    const ray = this.createRay(mouse, camera);
    const point = new THREE.Vector3();
    if (!ray.intersectPlane(plane, point)) {
      return null;
    }
    return point;
  }

  pickFirstEntityHit(
    mouse: THREE.Vector2,
    camera: THREE.Camera,
    objects: THREE.Object3D[],
  ): ViewportPickResult {
    const intersects = this.raycastObjects(mouse, camera, objects, true);
    if (intersects.length === 0) {
      return {
        type: 'none',
        object: null,
        point: null,
        normal: null,
        distance: Infinity,
      };
    }

    const first = intersects[0];
    return {
      type: 'entity',
      object: first.object,
      point: first.point.clone(),
      normal: first.face ? first.face.normal.clone() : new THREE.Vector3(0, 1, 0),
      distance: first.distance,
      entityId: (first.object.userData as any)?.entityId ?? null,
    };
  }
}
