import * as THREE from 'three';

/**
 * DebugMenu: F6-toggled debug UI for runtime diagnostics and toggles
 * 
 * Features:
 * - Toggle collider visibility
 * - Toggle performance metrics
 * - Toggle physics debug visualization
 * - Quick diagnostics display
 */

interface DebugState {
  collidersVisible: boolean;
  performanceMetricsVisible: boolean;
  physicsDebugVisible: boolean;
}

interface GraphicsSettings {
  debugLevel: number;
  pixelSize: number;
  colorBits: number;
  ditherEnabled: boolean;
}

let debugState: DebugState = {
  collidersVisible: false,
  performanceMetricsVisible: false,
  physicsDebugVisible: false,
};

let graphicsSettings: GraphicsSettings = {
  debugLevel: 2,
  pixelSize: 4.0,
  colorBits: 5.0,
  ditherEnabled: true,
};

let debugMenuVisible = false;
let debugMenuElement: HTMLDivElement | null = null;

export function initDebugMenu(): void {
  // Create debug menu HTML
  debugMenuElement = document.createElement('div');
  debugMenuElement.id = 'debug-menu';
  debugMenuElement.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(40, 40, 40, 0.95);
    color: #e8e8e8;
    border: 1px solid #555;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    padding: 12px;
    border-radius: 4px;
    max-width: 320px;
    z-index: 10000;
    display: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  `;

  document.body.appendChild(debugMenuElement);

  // Listen for F6 key
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'F6' || e.code === 'F6') {
      e.preventDefault();
      toggleDebugMenu();
    }
  });

  console.log('[DEBUG_MENU] Initialized - Press F6 to toggle');
}

export function toggleDebugMenu(): void {
  debugMenuVisible = !debugMenuVisible;
  if (debugMenuElement) {
    debugMenuElement.style.display = debugMenuVisible ? 'block' : 'none';
    if (debugMenuVisible) {
      // Release pointer lock so the mouse cursor works on the debug buttons.
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      updateDebugMenuContent();
    }
  }
  console.log(`[DEBUG_MENU] ${debugMenuVisible ? 'SHOWN' : 'HIDDEN'}`);
}

function getHordeDebugInfo(): { hp: number; maxHp: number; registeredIds: string[]; localPlayerId: string; inventoryItems: string[] } {
  const Engine = (window as any).__Engine;
  const ds = (globalThis as any).__dummyEnemySystem;
  const localPlayerId: string = ds?.localPlayerId ?? '—';

  // Try to read health via HealthSystem from bootstrapState
  const bs = (window as any).__bootstrapState;
  const healthSystem = bs?.systems?.healthSystem;
  let hp = -1;
  let maxHp = -1;
  const registeredIds: string[] = [];

  if (healthSystem) {
    // Collect all registered IDs via iterating components map if exposed
    const comps: Map<string, any> | undefined = healthSystem['components'];
    if (comps) {
      for (const [id, comp] of comps) {
        registeredIds.push(id);
        if (id === localPlayerId || id.startsWith('player_') || id.startsWith('local_')) {
          hp = Math.round(comp.hp ?? -1);
          maxHp = Math.round(comp.maxHp ?? -1);
        }
      }
    }
  }

  const invMgr = Engine?.getInventoryGridManager?.();
  const inventoryItems = invMgr?.getInventory()?.items?.map((i: any) => i.itemId) ?? [];

  return { hp, maxHp, registeredIds, localPlayerId, inventoryItems };
}

export function updateDebugMenuContent(): void {
  if (!debugMenuElement) return;

  const colliderCount = getColliderCount();
  const fpsEstimate = Math.round(1000 / (performance.now() % 16.67 || 1));
  const horde = getHordeDebugInfo();
  const hpColor = horde.hp < 0 ? '#888' : horde.hp < 30 ? '#f44' : horde.hp < 60 ? '#fa0' : '#4f4';
  const idList = horde.registeredIds.length ? horde.registeredIds.join(', ') : '(none)';

  debugMenuElement.innerHTML = `
    <div style="margin-bottom: 10px; border-bottom: 1px solid #555; padding-bottom: 8px;">
      <strong style="color: #fff;">DEBUG MENU (F6)</strong>
    </div>
    
    <!-- Graphics Settings Section -->
    <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #555;">
      <div style="color: #0f0; font-weight: bold; margin-bottom: 6px;">GRAPHICS</div>
      
      <div style="margin-bottom: 6px; font-size: 11px; color: #aaa;">Level: <strong style="color: #fff;">${graphicsSettings.debugLevel}</strong></div>
      <div style="display: flex; gap: 3px; margin-bottom: 6px;">
        ${[0, 1, 2, 3, 4].map(level => `
          <div style="cursor: pointer; padding: 3px 6px; background: ${graphicsSettings.debugLevel === level ? '#4a4' : '#2a2a2a'}; border: 1px solid ${graphicsSettings.debugLevel === level ? '#4f4' : '#555'}; border-radius: 2px; font-size: 10px; color: ${graphicsSettings.debugLevel === level ? '#000' : '#888'}; font-weight: bold;" onclick="window.__debugSetGraphicsLevel(${level})">
            ${level}
          </div>
        `).join('')}
      </div>
      
      <div style="margin-bottom: 4px;">
        <label style="font-size: 11px; color: #aaa;">Pixel Size: <strong style="color: #fff;">${graphicsSettings.pixelSize.toFixed(1)}</strong></label>
        <input type="range" min="1" max="10" step="0.5" value="${graphicsSettings.pixelSize}" onchange="window.__debugSetPixelSize(this.value)" style="width: 100%; cursor: pointer;">
      </div>
      
      <div style="margin-bottom: 4px;">
        <label style="font-size: 11px; color: #aaa;">Color Bits: <strong style="color: #fff;">${graphicsSettings.colorBits.toFixed(1)}</strong></label>
        <input type="range" min="1" max="8" step="0.5" value="${graphicsSettings.colorBits}" onchange="window.__debugSetColorBits(this.value)" style="width: 100%; cursor: pointer;">
      </div>

      <div style="cursor: pointer; padding: 4px 6px; background: ${graphicsSettings.ditherEnabled ? '#4a4a4a' : '#2a2a2a'}; border: 1px solid ${graphicsSettings.ditherEnabled ? '#777' : '#555'}; border-radius: 2px; font-size: 11px;" onclick="window.__debugToggleDither()">
        <span style="color: ${graphicsSettings.ditherEnabled ? '#4f4' : '#888'};">[${graphicsSettings.ditherEnabled ? '✓' : ' '}]</span> Dithering
      </div>
    </div>
    
    <div style="margin-bottom: 6px;">
      <div style="cursor: pointer; padding: 6px; margin-bottom: 4px; background: ${debugState.collidersVisible ? '#4a4a4a' : '#2a2a2a'}; border: 1px solid ${debugState.collidersVisible ? '#777' : '#555'}; border-radius: 3px;" onclick="window.__debugToggleColliders()" onmouseenter="this.style.background='#4a4a4a'" onmouseleave="this.style.background='${debugState.collidersVisible ? '#4a4a4a' : '#2a2a2a'}'">
        <span style="color: ${debugState.collidersVisible ? '#4f4' : '#888'};">[${debugState.collidersVisible ? '✓' : ' '}]</span> Show Colliders
      </div>
    </div>

    <div style="margin-bottom: 6px;">
      <div style="cursor: pointer; padding: 6px; background: #2a2a2a; border: 1px solid #555; border-radius: 3px; font-weight: bold; color: #0f0;" onclick="window.__debugSpawnHealthPacks()" onmouseenter="this.style.background='#4a4a4a'" onmouseleave="this.style.background='#2a2a2a'">
        ▶ SPAWN 500 HEALTH PACKS
      </div>
    </div>

    <!-- HORDE DEBUG Section -->
    <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #555; border-top: 1px solid #555; padding-top: 8px; margin-top: 8px;">
      <div style="color: #f80; font-weight: bold; margin-bottom: 6px;">HORDE DEBUG</div>

      <div style="font-size: 11px; margin-bottom: 6px; background: #1a1a1a; border-radius: 3px; padding: 5px;">
        <div>HP: <strong style="color:${hpColor}">${horde.hp < 0 ? '?' : horde.hp + ' / ' + horde.maxHp}</strong></div>
        <div style="color:#777; word-break:break-all;">localPlayerId: <span style="color:#aaa">${horde.localPlayerId}</span></div>
        <div style="color:#777; word-break:break-all;">health IDs: <span style="color:#aaa; font-size:10px">${idList}</span></div>
        <div style="color:#777; word-break:break-all;">inventory: <span style="color:#aaa; font-size:10px">${horde.inventoryItems.join(', ') || '(empty)'}</span></div>
      </div>

      <div style="display:flex; gap:4px; margin-bottom:5px; flex-wrap:wrap;">
        <div style="cursor:pointer; padding:4px 7px; background:#3a1a1a; border:1px solid #933; border-radius:3px; font-size:11px; color:#f88;" onclick="window.__debugApplyDamage(10)">-10 HP</div>
        <div style="cursor:pointer; padding:4px 7px; background:#3a1a1a; border:1px solid #933; border-radius:3px; font-size:11px; color:#f88;" onclick="window.__debugApplyDamage(25)">-25 HP</div>
        <div style="cursor:pointer; padding:4px 7px; background:#3a1a1a; border:1px solid #933; border-radius:3px; font-size:11px; color:#f88;" onclick="window.__debugApplyDamage(50)">-50 HP</div>
        <div style="cursor:pointer; padding:4px 7px; background:#1a3a1a; border:1px solid #393; border-radius:3px; font-size:11px; color:#8f8;" onclick="window.__debugHealFull()">HEAL</div>
      </div>

      <div style="display:flex; gap:4px; margin-bottom:5px; flex-wrap:wrap;">
        <div style="cursor:pointer; padding:4px 7px; background:#2a1a3a; border:1px solid #639; border-radius:3px; font-size:11px; color:#c8f;" onclick="window.__debugForceHordeInventory()">Force Horde Inv</div>
        <div style="cursor:pointer; padding:4px 7px; background:#2a1a3a; border:1px solid #639; border-radius:3px; font-size:11px; color:#c8f;" onclick="window.__debugForceRegisterPlayer()">Fix HP Reg</div>
      </div>

      <div style="display:flex; gap:4px; flex-wrap:wrap;">
        <div style="cursor:pointer; padding:4px 7px; background:#1a2a3a; border:1px solid #369; border-radius:3px; font-size:11px; color:#8cf;" onclick="window.__debugSpawnOneDummy()">+1 Zombie</div>
        <div style="cursor:pointer; padding:4px 7px; background:#2a2a1a; border:1px solid #663; border-radius:3px; font-size:11px; color:#ff8;" onclick="window.__debugKillAllDummies()">Kill All</div>
        <div style="cursor:pointer; padding:4px 7px; background:#1a3a3a; border:1px solid #363; border-radius:3px; font-size:11px; color:#8ff;" onclick="window.__debugStartHorde()">Start Horde</div>
      </div>
    </div>

    <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #555; font-size: 11px; color: #999;">
      <div>FPS: <span style="color: #aaa;">${fpsEstimate}</span></div>
      <div>Colliders: <span style="color: #aaa;">${colliderCount}</span></div>
    </div>
  `;
}

export function toggleColliders(): void {
  try {
    console.log('[DEBUG_MENU] toggleColliders called, current state:', debugState.collidersVisible);
    debugState.collidersVisible = !debugState.collidersVisible;
    setColliderVisibility(debugState.collidersVisible);
    updateDebugMenuContent();
    console.log(`[DEBUG_MENU] Colliders now ${debugState.collidersVisible ? 'VISIBLE' : 'HIDDEN'}`);
  } catch (err) {
    console.error('[DEBUG_MENU] toggleColliders error:', err);
  }
}

export function togglePerformanceMetrics(): void {
  try {
    debugState.performanceMetricsVisible = !debugState.performanceMetricsVisible;
    updateDebugMenuContent();
    console.log(`[DEBUG_MENU] Performance Metrics ${debugState.performanceMetricsVisible ? 'VISIBLE' : 'HIDDEN'}`);
  } catch (err) {
    console.error('[DEBUG_MENU] togglePerformanceMetrics error:', err);
  }
}

export function togglePhysicsDebug(): void {
  try {
    debugState.physicsDebugVisible = !debugState.physicsDebugVisible;
    updateDebugMenuContent();
    console.log(`[DEBUG_MENU] Physics Debug ${debugState.physicsDebugVisible ? 'VISIBLE' : 'HIDDEN'}`);
  } catch (err) {
    console.error('[DEBUG_MENU] togglePhysicsDebug error:', err);
  }
}

export function spawnHealthPacks(): void {
  console.log('[DEBUG_SPAWN] Starting health pack spawn...');
  
  try {
    // Get InventorySystem which is exposed globally
    const inventorySystem = (window as any).__InventorySystem;
    
    if (!inventorySystem) {
      console.error('[DEBUG_SPAWN] InventorySystem not available.');
      alert('InventorySystem not ready. Make sure game is fully loaded.');
      return;
    }

    if (!inventorySystem.spawnPickup) {
      console.error('[DEBUG_SPAWN] spawnPickup method not found on InventorySystem');
      alert('spawnPickup method unavailable.');
      return;
    }

    console.log('[DEBUG_SPAWN] Using InventorySystem.spawnPickup()...');
    const startTime = performance.now();

    // Spawn 500 health packs in grid formation around origin (16, 1, 16)
    // Grid spacing is 2.0 units per cell, so sqrt(500) ≈ 22x22 grid
    const gridSize = Math.ceil(Math.sqrt(500));
    const spacing = 2.0;
    const baseX = 16;
    const baseY = 1;
    const baseZ = 16;
    const offset = (gridSize * spacing) / 2;
    
    let spawnedCount = 0;
    
    for (let i = 0; i < gridSize && spawnedCount < 500; i++) {
      for (let j = 0; j < gridSize && spawnedCount < 500; j++) {
        const x = baseX - offset + (i * spacing);
        const y = baseY + (j % 3); // Vary height slightly to avoid z-fighting
        const z = baseZ - offset + (j * spacing);
        
        try {
          inventorySystem.spawnPickup('health_small', { x, y, z });
          spawnedCount++;
        } catch (err) {
          console.warn(`[DEBUG_SPAWN] Failed to spawn health pack at (${x}, ${y}, ${z}):`, err);
        }
      }
    }

    const duration = performance.now() - startTime;
    console.log(`[DEBUG_SPAWN] ✓ Complete! Spawned ${spawnedCount}/500 health packs in ${duration.toFixed(1)}ms`, {
      spawnedCount,
      totalAttempted: 500,
      durationMs: duration.toFixed(1),
    });
    
  } catch (err) {
    console.error('[DEBUG_SPAWN] Error spawning health packs:', err);
    alert(`Spawn failed: ${err}`);
  }
  
  updateDebugMenuContent();
}

export function spawnBiteArmy(): void {
  console.log('[DEBUG_SPAWN] Starting bite army spawn (DUMMY ARMY)...');
  
  try {
    // Get DummyEnemySystem which is exposed in constructor
    const dummyEnemySystem = (globalThis as any).__dummyEnemySystem;
    
    if (!dummyEnemySystem) {
      console.error('[DEBUG_SPAWN] DummyEnemySystem not available. Available globals:', 
        Object.keys(window as any).filter(k => k.startsWith('__')).slice(0, 10)
      );
      alert('Dummy spawn system not ready. Make sure game is fully loaded.');
      return;
    }

    if (!dummyEnemySystem.spawnArmy) {
      console.error('[DEBUG_SPAWN] spawnArmy method not found on DummyEnemySystem');
      alert('Spawn method unavailable.');
      return;
    }

    console.log('[DEBUG_SPAWN] Using DummyEnemySystem.spawnArmy()...');
    const startTime = performance.now();

    // Spawn 500 dummies in grid formation around origin (16, 1, 16)
    // Grid spacing is 2.0 units per cell, so sqrt(500) ≈ 22x22 grid
    const handles = dummyEnemySystem.spawnArmy(
      500,
      { x: 16, y: 1, z: 16 },
      2.0  // spacing between entities
    );

    const duration = performance.now() - startTime;
    console.log(`[DEBUG_SPAWN] ✓ Complete! Spawned ${handles.length}/500 bites in ${duration.toFixed(1)}ms`, {
      spawnedCount: handles.length,
      totalAttempted: 500,
      durationMs: duration.toFixed(1),
    });

    // Enable idle-bob animation
    if (dummyEnemySystem.setIdleBobActive) {
      dummyEnemySystem.setIdleBobActive(true);
      console.log('[DEBUG_SPAWN] Idle-Bob animation enabled');
    }
    
  } catch (err) {
    console.error('[DEBUG_SPAWN] Error spawning army:', err);
    alert(`Spawn failed: ${err}`);
  }
  
  updateDebugMenuContent();
}

function setColliderVisibility(visible: boolean): void {
  try {
    const Engine = (window as any).__Engine;
    if (!Engine) {
      console.warn('[DEBUG_MENU] Engine not available in setColliderVisibility');
      return;
    }

    const scene = Engine.getEngineScene?.();
    if (!scene) {
      console.warn('[DEBUG_MENU] Scene not available in setColliderVisibility');
      return;
    }

    const existingColliders: any[] = [];
    scene.traverse((obj: any) => {
      if (obj.userData?.debugType === 'staticCollider') {
        existingColliders.push(obj);
      }
    });

    if (visible && existingColliders.length === 0) {
      const createdCount = createDebugStaticColliderMeshes(scene, Engine);
      console.log(`[DEBUG_MENU] Created ${createdCount} static collider debug meshes`);
    }

    let count = 0;
    scene.traverse((obj: any) => {
      if (obj.userData?.debugType === 'staticCollider') {
        obj.visible = visible;
        count++;
      }
    });

    console.log(`[DEBUG_MENU] Set ${count} colliders to visible=${visible}`);
  } catch (err) {
    console.error('[DEBUG_MENU] Error in setColliderVisibility:', err);
  }
}

function createDebugStaticColliderMeshes(scene: THREE.Scene, Engine: any): number {
  try {
    const systemContext = Engine.getSystemContext?.();
    const collisionAuthority = systemContext?.systems?.clientCollisionAuthoritySystem ?? systemContext?.resolveSystem?.('clientCollisionAuthoritySystem');
    const staticLayout = collisionAuthority?.getStaticLayout?.();
    if (!staticLayout?.boxes?.length) {
      return 0;
    }

    for (const box of staticLayout.boxes) {
      const geometry = new THREE.BoxGeometry(
        box.halfExtents.x * 2,
        box.halfExtents.y * 2,
        box.halfExtents.z * 2,
      );
      const material = new THREE.MeshPhongMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.15,
        wireframe: false,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(box.position.x, box.position.y, box.position.z);
      mesh.rotation.set(0, 0, 0);
      mesh.userData = { debugType: 'staticCollider', source: 'collisionAuthority', authorityId: box.id };
      mesh.name = `debug_static_collider_${box.id}`;
      scene.add(mesh);
    }

    return staticLayout.boxes.length;
  } catch (err) {
    console.error('[DEBUG_MENU] Error creating static collider debug meshes:', err);
    return 0;
  }
}

function getColliderCount(): number {
  const Engine = (window as any).__Engine;
  if (!Engine) return 0;

  const scene = Engine.getEngineScene?.();
  if (!scene) return 0;

  let count = 0;
  scene.traverse((obj: any) => {
    if (obj.userData?.debugType === 'staticCollider') {
      count++;
    }
  });
  return count;
}

// Expose functions to window for onclick handlers
(window as any).__debugToggleColliders = toggleColliders;
(window as any).__debugToggleMetrics = togglePerformanceMetrics;
(window as any).__debugTogglePhysics = togglePhysicsDebug;
(window as any).__debugSpawnBiteArmy = spawnBiteArmy;
(window as any).__debugSpawnHealthPacks = spawnHealthPacks;
(window as any).__debugMenuUpdateContent = updateDebugMenuContent;
(window as any).__graphicsSettings = graphicsSettings;

// Graphics settings handlers
(window as any).__debugSetGraphicsLevel = (level: number) => {
  graphicsSettings.debugLevel = level;
  const config = (window as any).__debugGraphicsConfig;
  if (config) {
    config.setDebugLevel(level);
  }
  updateDebugMenuContent();
};

(window as any).__debugSetPixelSize = (value: string) => {
  graphicsSettings.pixelSize = parseFloat(value);
  (window as any).__graphicsSettings = graphicsSettings;
  updateDebugMenuContent();
};

(window as any).__debugSetColorBits = (value: string) => {
  graphicsSettings.colorBits = parseFloat(value);
  (window as any).__graphicsSettings = graphicsSettings;
  updateDebugMenuContent();
};

(window as any).__debugToggleDither = () => {
  graphicsSettings.ditherEnabled = !graphicsSettings.ditherEnabled;
  (window as any).__graphicsSettings = graphicsSettings;
  updateDebugMenuContent();
};

// Auto-update debug menu every 100ms when visible
Engine.timer.setInterval(() => {
  if (debugMenuVisible && debugMenuElement) {
    updateDebugMenuContent();
  }
}, 100);

// ── HORDE DEBUG ACTIONS ───────────────────────────────────────────────────

(window as any).__debugApplyDamage = (amount: number) => {
  const bs = (window as any).__bootstrapState;
  const hs = bs?.systems?.healthSystem;
  const ds = (globalThis as any).__dummyEnemySystem;
  const targetId = ds?.localPlayerId;
  if (!hs || !targetId) {
    console.warn('[DebugMenu] Cannot apply damage — healthSystem or localPlayerId not ready. bs=', bs, 'ds=', ds);
    return;
  }
  const result = hs.applyDamage(targetId, { amount, type: 'debug', sourceId: 'debug_menu' });
  console.log(`[DebugMenu] Applied ${amount} dmg to "${targetId}" → effective=${result}`);
  updateDebugMenuContent();
};

(window as any).__debugHealFull = () => {
  const bs = (window as any).__bootstrapState;
  const hs = bs?.systems?.healthSystem;
  const ds = (globalThis as any).__dummyEnemySystem;
  const targetId = ds?.localPlayerId;
  if (!hs || !targetId) { console.warn('[DebugMenu] Cannot heal — not ready'); return; }
  const comp = hs['components']?.get(targetId);
  if (comp) { comp.hp = comp.maxHp; comp.isDead = false; hs['_syncToState']?.(targetId); hs['_notify']?.(); }
  console.log(`[DebugMenu] Healed "${targetId}" to full`);
  updateDebugMenuContent();
};

(window as any).__debugForceRegisterPlayer = () => {
  const bs = (window as any).__bootstrapState;
  const hs = bs?.systems?.healthSystem;
  const ds = (globalThis as any).__dummyEnemySystem;
  const targetId = ds?.localPlayerId;
  if (!hs || !targetId) { console.warn('[DebugMenu] Not ready'); return; }
  if (!hs.get?.(targetId)) {
    hs.register(targetId, { maxHp: 100, armor: 0, revivable: true });
    console.log(`[DebugMenu] Registered "${targetId}" in HealthSystem`);
  } else {
    console.log(`[DebugMenu] "${targetId}" already registered`);
  }
  updateDebugMenuContent();
};

(window as any).__debugForceHordeInventory = () => {
  const Engine = (window as any).__Engine;
  const igm = Engine?.getInventoryGridManager?.();
  const ds = (globalThis as any).__dummyEnemySystem;
  const playerId = ds?.localPlayerId ?? 'local_freeplay_player';
  if (!igm) { console.warn('[DebugMenu] InventoryGridManager not ready'); return; }
  igm.initOffline(playerId, ['debug_fireball', 'weapon_shotgun', 'weapon_pistol'])
    .then(() => { console.log('[DebugMenu] Horde inventory forced'); updateDebugMenuContent(); });
};

(window as any).__debugSpawnOneDummy = () => {
  const ds = (globalThis as any).__dummyEnemySystem;
  if (!ds?.spawnRandomDummy) { console.warn('[DebugMenu] DummyEnemySystem not ready'); return; }
  const Engine = (window as any).__Engine;
  const em = Engine?.getEntityManager?.();
  const localEnt = em?.getEntities?.()?.find?.((e: any) => e.hasComponent?.('localPlayer'));
  const pos = localEnt?.getComponent?.('position') ?? { x: 5, y: 1, z: 5 };
  ds.spawnRandomDummy(pos.x ?? 5, pos.y ?? 1);
  console.log('[DebugMenu] Spawned 1 zombie');
  updateDebugMenuContent();
};

(window as any).__debugKillAllDummies = () => {
  const ds = (globalThis as any).__dummyEnemySystem;
  if (!ds) { console.warn('[DebugMenu] DummyEnemySystem not ready'); return; }
  const active: any[] = ds.getActiveDummies?.() ?? [];
  active.forEach((d: any) => ds['killDummy']?.(d.handle));
  console.log(`[DebugMenu] Killed ${active.length} dummies`);
  updateDebugMenuContent();
};

(window as any).__debugStartHorde = () => {
  const glc = (window as any).__gameLaunchCoordinator;
  if (glc?.startHorde) { glc.startHorde(); }
  else { console.warn('[DebugMenu] gameLaunchCoordinator.startHorde not available'); }
};
