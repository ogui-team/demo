import { PositionStorage } from './PositionStorage';
import { VelocityStorage } from './VelocityStorage';
import { InventoryStorage } from './InventoryStorage';
import { HealthStorage } from './HealthStorage';
import { AbilityStorage } from './AbilityStorage';

export interface ComponentMapperConfig {
  positions: PositionStorage;
  velocities: VelocityStorage;
  inventories: InventoryStorage;
  healths: HealthStorage;
  abilities: AbilityStorage;
}

export class ComponentMapper {
  private readonly positions: PositionStorage;
  private readonly velocities: VelocityStorage;
  private readonly inventories: InventoryStorage;
  private readonly healths: HealthStorage;
  private readonly abilities: AbilityStorage;

  constructor(config: ComponentMapperConfig) {
    this.positions = config.positions;
    this.velocities = config.velocities;
    this.inventories = config.inventories;
    this.healths = config.healths;
    this.abilities = config.abilities;
  }

  copyComponents(oldDense: number, newDense: number, statePreservationMask: number): boolean {
    try {
      // Position and Velocity always copied (mask bit 0 for position, 1 for velocity)
      if (statePreservationMask & 1) {
        // Copy position
        const posRead = this.positions.getReadBuffer();
        this.positions.setWriteXYZ(newDense, posRead[oldDense * 3], posRead[oldDense * 3 + 1], posRead[oldDense * 3 + 2]);
      }
      if (statePreservationMask & 2) {
        // Copy velocity
        const vel = this.velocities.getAuthoritativeBuffer();
        this.velocities.setAuthoritativeXYZ(newDense, vel[oldDense * 3], vel[oldDense * 3 + 1], vel[oldDense * 3 + 2]);
      }
      if (statePreservationMask & 4) {
        // Copy inventory
        this.inventories.setAmmo(newDense, this.inventories.getAmmo(oldDense));
        this.inventories.setItemId(newDense, this.inventories.getItemId(oldDense));
      }
      if (statePreservationMask & 8) {
        // Copy health
        this.healths.setHealth(newDense, this.healths.getHealth(oldDense));
        this.healths.setMaxHealth(newDense, this.healths.getMaxHealth(oldDense));
      }
      if (statePreservationMask & 16) {
        // Copy ability
        this.abilities.setPrimaryAbility(newDense, this.abilities.getPrimaryAbility(oldDense));
      }
      return true;
    } catch (error) {
      console.error('ComponentMapper: Failed to copy components', error);
      return false;
    }
  }
}