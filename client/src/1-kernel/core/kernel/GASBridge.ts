import type { KernelCommandConsumer } from './types';

interface AbilitySystemAdapter {
  triggerAbility(abilityId: string, playerId: string | null): void;
}

interface GASBridgeConfig {
  abilitySystem: AbilitySystemAdapter;
}

export class GASBridge {
  private readonly abilitySystem: AbilitySystemAdapter;

  constructor(config: GASBridgeConfig) {
    this.abilitySystem = config.abilitySystem;
  }

  readonly consumeCommand: KernelCommandConsumer = (
    _seq,
    _tick,
    _timestamp,
    _source,
    type,
    playerId,
    payload,
  ) => {
    if (type !== 'ABILITY_CMD') {
      return;
    }

    const abilityPayload = payload as { abilityId?: string };
    const abilityId = abilityPayload?.abilityId;
    if (abilityId) {
      this.abilitySystem.triggerAbility(abilityId, playerId);
    }
  };
}