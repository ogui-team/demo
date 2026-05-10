import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerRuntimeSystemMock = vi.fn();
const wireRuntimeAssembliesMock = vi.fn();

vi.mock('../../../client/src/0-foundation/foundation/Engine', () => ({
  getEngineScene: () => ({}),
  getEntityManager: () => ({}),
  getEntityRenderer: () => ({}),
  getSceneGraph: () => ({}),
  getSpatialPartitionSystem: () => ({}),
  getGasDataRegistry: () => ({}),
  getGasAttributeStore: () => ({}),
  getGasEffectSystem: () => ({}),
  getGasItemSystem: () => ({}),
  getModeManger: () => ({}) as unknown,
  registerRuntimeSystem: registerRuntimeSystemMock,
}));

function mockDisposableClass(methods: Record<string, unknown> = {}) {
  return class {
    dispose = vi.fn();

    constructor(..._args: unknown[]) {}
  } as unknown as new (...args: unknown[]) => { dispose: ReturnType<typeof vi.fn> } & Record<string, unknown>;
}

vi.mock('../../../client/src/2-systems/gameplay/game/PlayerModelSystem', () => ({
  PlayerModelSystem: class {
    dispose = vi.fn();
    setSnapshotInterpolationDelayMs = vi.fn();
  },
}));
vi.mock('../../../client/src/4-runtime/ui/MenuIdentitySystem', () => ({
  MenuIdentitySystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/game/CharacterActorSystem', () => ({
  CharacterActorSystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/systems/PhysicsSystem', () => ({
  PhysicsSystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/systems/HealthSystem', () => ({
  HealthSystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/systems/WeaponSystem', () => ({
  WeaponSystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/systems/PrefabSystem', () => ({
  PrefabSystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/systems/SpawnSystem', () => ({
  SpawnSystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/game/ObjectCreatorSystem', () => ({
  ObjectCreatorSystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/systems/gas/AbilitySystem', () => ({
  AbilitySystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/3-network/network/MultiplayerClient', () => ({
  MultiplayerClient: mockDisposableClass(),
}));
vi.mock('../../../client/src/3-network/network/CollisionAuthoritySystem', () => ({
  CollisionAuthoritySystem: mockDisposableClass(),
}));
vi.mock('../../../client/src/2-systems/gameplay/systems/HUDSystem', () => ({
  HUDSystem: class {
    dispose = vi.fn();
    mount = vi.fn();
  },
}));
vi.mock('../../../client/src/2-systems/gameplay/systems/InventorySystem', () => ({
  InventorySystem: class {
    dispose = vi.fn();
    defineDefaults = vi.fn();
  },
}));

vi.mock('../../../client/src/4-runtime/runtime/bootstrap/wireRuntimeAssemblies', () => ({
  wireRuntimeAssemblies: wireRuntimeAssembliesMock,
}));

describe('Bootstrap phase contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = globalThis.window ?? ({} as Window & typeof globalThis);
  });

  it('Phase3 creates disposable systems and dispose tears them down', async () => {
    const { Phase3_GameplayRuntime } = await import('../../../client/src/4-runtime/runtime/bootstrap/phases');

    const result = Phase3_GameplayRuntime({
      stateManager: {} as never,
      systemContext: {} as never,
      engineController: {} as never,
      listenerRegistry: {} as never,
    });

    expect(Object.keys(result.systems).length).toBe(10);
    const systems = Object.values(result.systems) as Array<{ dispose?: ReturnType<typeof vi.fn> }>;
    result.dispose();
    systems.forEach((system) => {
      expect(system.dispose).toBeDefined();
      expect(system.dispose).toHaveBeenCalledTimes(1);
    });
  });

  it('Phase4 is idempotent and disposable', async () => {
    const { Phase4_NetworkingRuntime } = await import('../../../client/src/4-runtime/runtime/bootstrap/phases');

    const first = Phase4_NetworkingRuntime({
      stateManager: {} as never,
      systemContext: {} as never,
      engineController: {} as never,
      listenerRegistry: {} as never,
    });
    const second = Phase4_NetworkingRuntime({
      stateManager: {} as never,
      systemContext: {} as never,
      engineController: {} as never,
      listenerRegistry: {} as never,
    });

    expect(first.systems).not.toBe(second.systems);
    const firstSystems = Object.values(first.systems) as Array<{ dispose?: ReturnType<typeof vi.fn> }>;
    const secondSystems = Object.values(second.systems) as Array<{ dispose?: ReturnType<typeof vi.fn> }>;

    first.dispose();
    second.dispose();

    [...firstSystems, ...secondSystems].forEach((system) => {
      expect(system.dispose).toHaveBeenCalledTimes(1);
    });
  });

  it('Phase5 creates HUD/inventory and disposes cleanly', async () => {
    const { Phase5_UIRuntime } = await import('../../../client/src/4-runtime/runtime/bootstrap/phases');

    const result = Phase5_UIRuntime(
      {
        stateManager: {} as never,
        systemContext: {} as never,
        engineController: {} as never,
        listenerRegistry: {} as never,
      },
      {} as never,
      {} as never,
      {} as never,
    );

    expect(Object.keys(result.systems)).toEqual(['hud', 'inventory']);
    const systems = Object.values(result.systems) as Array<{ dispose?: ReturnType<typeof vi.fn> }>;
    result.dispose();
    systems.forEach((system) => {
      expect(system.dispose).toHaveBeenCalledTimes(1);
    });
  });

  it('Phase6 wiring exposes reload and wires assemblies', async () => {
    const { completePhase6CoordinatorWiring } = await import('../../../client/src/4-runtime/runtime/bootstrap/phase6CoordinatorWiring');

    const removePhase = vi.fn();
    const phaseResults = new Map<string, { systems: Record<string, unknown>; dispose(): void }>();
    const phase3Dispose = vi.fn();
    phaseResults.set('phase3', {
      systems: { oldSystem: { dispose: vi.fn() } },
      dispose: phase3Dispose,
    });

    completePhase6CoordinatorWiring({
      gameLaunchCoordinator: {} as never,
      multiplayerRuntime: {} as never,
      prefabSystem: {} as never,
      inventorySystem: {} as never,
      phaseResults,
      phaseCtx: {
        stateManager: {} as never,
        systemContext: {} as never,
        engineController: {} as never,
        listenerRegistry: {} as never,
      },
      systemRegistry: { removePhase } as never,
      healthSystem: {} as never,
      weaponSystem: {} as never,
      mpClient: {} as never,
      gameHUD: {} as never,
      gasBridge: {} as never,
      sessionLifecycleCoordinator: {} as never,
      editorAuthorityCoordinator: {} as never,
      auxiliaryAssembly: {} as never,
      worldObjectAuthorityService: {} as never,
      kernelMovementIntegration: {} as never,
    });

    expect(typeof (window as any).__reloadPhase).toBe('function');
    expect(wireRuntimeAssembliesMock).toHaveBeenCalledTimes(1);

    await (window as any).__reloadPhase('phase3');
    expect(phase3Dispose).toHaveBeenCalledTimes(1);
    expect(removePhase).toHaveBeenCalledWith('phase3');
    expect(registerRuntimeSystemMock).toHaveBeenCalled();
  });
});
