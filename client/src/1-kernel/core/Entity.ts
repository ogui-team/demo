/**
 * Entity System
 * Lightweight component-based entity for managing game objects
 */

import type { IPoolable } from './ObjectPool';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vector3;
  rotation: Vector3;
  scale?: Vector3;
}

export interface Component {
  name: string;
  data: Record<string, any>;
  update?: (deltaTime: number, entity: Entity) => void;
}

export interface EntityData {
  id: string;
  type: string;
  active: boolean;
  lastUsedTime?: number;
  transform: Transform;
  components: Record<string, Component>;
}

/**
 * Entity - represents a single object in the world
 */
export class Entity implements IPoolable {
  id: string;
  type: string;
  active: boolean;
  lastUsedTime: number;

  private transform: Transform;
  private components: Map<string, Component>;

  constructor(id: string, type: string, transform: Partial<Transform> = {}) {
    this.components = new Map();
    this.id = '';
    this.type = '';
    this.active = false;
    this.lastUsedTime = 0;
    this.transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    this.reinitialize(id, type, transform);
  }

  get isActive(): boolean {
    return this.active;
  }

  set isActive(value: boolean) {
    this.active = value;
    this.touch();
  }

  touch(timestamp: number = Engine.time.now()): void {
    this.lastUsedTime = timestamp;
  }

  reinitialize(id: string, type: string, transform: Partial<Transform> = {}): void {
    this.id = id;
    this.type = type;
    this.active = true;
    this.lastUsedTime = Engine.time.now();
    this.transform.position.x = transform.position?.x ?? 0;
    this.transform.position.y = transform.position?.y ?? 0;
    this.transform.position.z = transform.position?.z ?? 0;
    this.transform.rotation.x = transform.rotation?.x ?? 0;
    this.transform.rotation.y = transform.rotation?.y ?? 0;
    this.transform.rotation.z = transform.rotation?.z ?? 0;
    this.transform.scale = {
      x: transform.scale?.x ?? 1,
      y: transform.scale?.y ?? 1,
      z: transform.scale?.z ?? 1,
    };
    this.components.clear();
  }

  reset(): void {
    this.active = false;
    this.lastUsedTime = 0;
    this.id = '';
    this.type = '';
    this.transform.position.x = 0;
    this.transform.position.y = 0;
    this.transform.position.z = 0;
    this.transform.rotation.x = 0;
    this.transform.rotation.y = 0;
    this.transform.rotation.z = 0;
    this.transform.scale = { x: 1, y: 1, z: 1 };
    this.components.clear();
  }

  /**
   * Get current transform
   */
  getTransform(): Transform {
    return { ...this.transform };
  }

  /**
   * Set transform (returns copy for immutability pattern)
   */
  setTransform(transform: Partial<Transform>): void {
    if (transform.position) {
      this.transform.position = { ...transform.position };
    }
    if (transform.rotation) {
      this.transform.rotation = { ...transform.rotation };
    }
    if (transform.scale) {
      this.transform.scale = { ...transform.scale };
    }
    this.touch();
  }

  /**
   * Get position
   */
  getPosition(): Vector3 {
    return { ...this.transform.position };
  }

  /**
   * Set position
   */
  setPosition(position: Vector3): void {
    this.transform.position = { ...position };
    this.touch();
  }

  /**
   * Get rotation
   */
  getRotation(): Vector3 {
    return { ...this.transform.rotation };
  }

  /**
   * Set rotation
   */
  setRotation(rotation: Vector3): void {
    this.transform.rotation = { ...rotation };
    this.touch();
  }

  /**
   * Get scale
   */
  getScale(): Vector3 {
    return {
      x: this.transform.scale?.x ?? 1,
      y: this.transform.scale?.y ?? 1,
      z: this.transform.scale?.z ?? 1,
    };
  }

  /**
   * Set scale
   */
  setScale(scale: Vector3): void {
    this.transform.scale = { ...scale };
    this.touch();
  }

  /**
   * Add a component to this entity
   */
  addComponent(component: Component): void {
    this.components.set(component.name, component);
    this.touch();
  }

  /**
   * Remove a component from this entity
   */
  removeComponent(name: string): void {
    this.components.delete(name);
    this.touch();
  }

  /**
   * Get a component by name
   */
  getComponent(name: string): Component | undefined {
    return this.components.get(name);
  }

  /**
   * Check if entity has a component
   */
  hasComponent(name: string): boolean {
    return this.components.has(name);
  }

  /**
   * Get all components
   */
  getComponents(): Component[] {
    return Array.from(this.components.values());
  }

  /**
   * Update all components
   */
  update(deltaTime: number): void {
    if (!this.active) return;

    this.touch();

    for (const component of this.components.values()) {
      if (component.update) {
        component.update(deltaTime, this);
      }
    }
  }

  /**
   * Serialize entity to JSON
   */
  toJSON(): EntityData {
    const componentsObj: Record<string, Component> = {};
    for (const [name, component] of this.components.entries()) {
      componentsObj[name] = {
        name: component.name,
        data: { ...component.data },
        // Don't serialize update function, it will be reattached on deserialization
      };
    }

    return {
      id: this.id,
      type: this.type,
      active: this.active,
      lastUsedTime: this.lastUsedTime,
      transform: {
        position: { ...this.transform.position },
        rotation: { ...this.transform.rotation },
        scale: this.transform.scale ? { ...this.transform.scale } : { x: 1, y: 1, z: 1 },
      },
      components: componentsObj,
    };
  }

  /**
   * Create entity from JSON data
   */
  static fromJSON(data: EntityData): Entity {
    const entity = new Entity(data.id, data.type, data.transform);
    entity.active = data.active;
    entity.lastUsedTime = typeof data.lastUsedTime === 'number' ? data.lastUsedTime : Engine.time.now();

    // Recreate components (without update functions - those are handled by system).
    // Handles two serialization formats:
    //   - Entity.toJSON format:  { name: string, data: object }  (wrapped)
    //   - SaveLoadManager format: raw data object keyed by component name (flat)
    for (const [name, componentData] of Object.entries(data.components)) {
      const raw = componentData as unknown;
      const isWrapped =
        raw !== null &&
        typeof raw === 'object' &&
        typeof (raw as Record<string, unknown>).name === 'string' &&
        (raw as Record<string, unknown>).data !== null &&
        typeof (raw as Record<string, unknown>).data === 'object';
      entity.addComponent(
        isWrapped
          ? {
              name: (raw as { name: string; data: Record<string, unknown> }).name,
              data: { ...(raw as { name: string; data: Record<string, unknown> }).data },
            }
          : {
              name,
              data: { ...(raw as Record<string, unknown>) },
            },
      );
    }

    return entity;
  }

  /**
   * Create a deep copy of this entity
   */
  clone(newId?: string): Entity {
    const cloned = new Entity(newId || this.id + '_clone', this.type, this.getTransform());
    cloned.active = this.active;
    cloned.lastUsedTime = this.lastUsedTime;

    // Clone all components
    for (const component of this.components.values()) {
      cloned.addComponent({
        name: component.name,
        data: { ...component.data },
        update: component.update,
      });
    }

    return cloned;
  }
}
