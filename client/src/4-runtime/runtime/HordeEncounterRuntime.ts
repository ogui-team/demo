import type { HordeSystem } from '../../2-systems/gameplay/systems/HordeSystem';
import type { EncounterRuntimeState, IEncounterRuntime } from './RuntimeSimulationContracts';

export class HordeEncounterRuntime implements IEncounterRuntime {
  constructor(private readonly hordeSystem: HordeSystem) {}

  getRuntimeState(): EncounterRuntimeState {
    const state = this.hordeSystem.getEncounterState();
    return {
      key: state.active ? 'horde:primary' : null,
      active: state.active,
      activeEncounterCount: state.active ? 1 : 0,
      status: state.status,
    };
  }

  stepForeground(dt: number): void {
    this.hordeSystem.update(dt);
  }

  stepBackground(dt: number): void {
    this.hordeSystem.update(dt);
  }
}