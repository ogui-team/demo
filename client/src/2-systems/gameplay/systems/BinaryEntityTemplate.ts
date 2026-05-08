/**
 * Binary Entity Template Builder
 * Frostbite-style entity spawning: pre-built binary blobs for zero-allocation batch spawning
 * 
 * Template Format (24 bytes per entity):
 *   Offset 0-11: Position [X, Y, Z] (Float32 × 3)
 *   Offset 12-15: Health (Float32)
 *   Offset 16-19: Ammo (Uint32)
 *   Offset 20-23: ItemId (Uint32)
 */

export class BinaryEntityTemplate {
  /**
   * Create a binary blob for batch entity spawning.
   * 
   * ZERO-ALLOCATION: Pre-computes all entity data into a single buffer.
   * 
   * @param entities Array of entity spawn data: { x, y, z, health?, ammo?, itemId? }
   * @returns Uint8Array blob ready for kernel.spawnFromBlob()
   */
  static createBlob(
    entities: Array<{
      x: number;
      y: number;
      z: number;
      health?: number;
      ammo?: number;
      itemId?: number;
    }>
  ): Uint8Array {
    // Allocate buffer: 4 bytes for count + 24 bytes per entity
    const totalSize = 4 + entities.length * 24;
    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);

    // Write entity count (Uint32 @ offset 0)
    view.setUint32(0, entities.length, true); // little-endian

    // Write each entity
    let offset = 4;
    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];

      // Position (3 × Float32)
      view.setFloat32(offset, entity.x, true);
      view.setFloat32(offset + 4, entity.y, true);
      view.setFloat32(offset + 8, entity.z, true);

      // Health (Float32) - default 100
      view.setFloat32(offset + 12, entity.health ?? 100, true);

      // Ammo (Uint32) - default 30
      view.setUint32(offset + 16, entity.ammo ?? 30, true);

      // ItemId (Uint32) - default 1
      view.setUint32(offset + 20, entity.itemId ?? 1, true);

      offset += 24;
    }

    return buffer;
  }

  /**
   * Create a grid formation blob for dummy armies.
   * 
   * FROSTBITE STANDARD: Spawn many entities in a grid with even spacing.
   * 
   * @param count Number of entities to spawn
   * @param centerX Grid center X coordinate
   * @param centerZ Grid center Z coordinate
   * @param spacing Distance between entities
   * @param health Entity health (default 50 for dummies)
   * @returns Uint8Array blob ready for kernel.spawnFromBlob()
   */
  static createGridBlob(
    count: number,
    centerX: number,
    centerZ: number,
    spacing: number = 2,
    health: number = 50
  ): Uint8Array {
    const entities: Array<{
      x: number;
      y: number;
      z: number;
      health: number;
      ammo: number;
      itemId: number;
    }> = [];

    // Calculate grid dimensions (roughly square)
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (index >= count) break;

        const x = centerX + (col - cols / 2) * spacing;
        const z = centerZ + (row - rows / 2) * spacing;
        const y = 1; // Spawn height

        entities.push({
          x,
          y,
          z,
          health,
          ammo: 30,
          itemId: 1,
        });

        index += 1;
      }
    }

    return BinaryEntityTemplate.createBlob(entities);
  }

  /**
   * Create a circle formation blob.
   * 
   * @param count Number of entities to spawn
   * @param centerX Circle center X
   * @param centerZ Circle center Z
   * @param radius Circle radius
   * @param health Entity health
   * @returns Uint8Array blob
   */
  static createCircleBlob(
    count: number,
    centerX: number,
    centerZ: number,
    radius: number = 10,
    health: number = 50
  ): Uint8Array {
    const entities: Array<{
      x: number;
      y: number;
      z: number;
      health: number;
      ammo: number;
      itemId: number;
    }> = [];

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      const y = 1;

      entities.push({
        x,
        y,
        z,
        health,
        ammo: 30,
        itemId: 1,
      });
    }

    return BinaryEntityTemplate.createBlob(entities);
  }

  /**
   * Create a line formation blob.
   * 
   * @param count Number of entities to spawn
   * @param startX Start X coordinate
   * @param startZ Start Z coordinate
   * @param endX End X coordinate
   * @param endZ End Z coordinate
   * @param health Entity health
   * @returns Uint8Array blob
   */
  static createLineBlob(
    count: number,
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    health: number = 50
  ): Uint8Array {
    const entities: Array<{
      x: number;
      y: number;
      z: number;
      health: number;
      ammo: number;
      itemId: number;
    }> = [];

    for (let i = 0; i < count; i += 1) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const x = startX + (endX - startX) * t;
      const z = startZ + (endZ - startZ) * t;
      const y = 1;

      entities.push({
        x,
        y,
        z,
        health,
        ammo: 30,
        itemId: 1,
      });
    }

    return BinaryEntityTemplate.createBlob(entities);
  }
}
