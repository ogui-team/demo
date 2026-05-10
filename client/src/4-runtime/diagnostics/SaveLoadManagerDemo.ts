/**
 * Save/Load System Demo & Testing
 * 
 * This file demonstrates how to use the SaveLoadManager API
 * to save, load, export, and import world states.
 * 
 * Integration with Engine API (Engine.ts):
 * - saveMap(name: string) → boolean
 * - loadMap(name: string) → { success, entitiesCreated, settingsApplied }
 * - listMaps() → string[]
 * - deleteMap(name: string) → boolean
 * - exportMap(name?: string) → string (JSON)
 * - importMap(json: string, name?: string) → { success, entitiesCreated, settingsApplied }
 * - getMapInfo(name: string) → SavedWorldState | null
 */

import * as Engine from '../../0-foundation/foundation/Engine';

/**
 * Example: Save current world state with a name
 */
export function exampleSaveMap() {
  const success = Engine.saveMap('my-level-v1');
  if (success) {
    console.log('✓ World saved as "my-level-v1"');
  } else {
    console.error('✗ Failed to save world');
  }
}

/**
 * Example: Load a previously saved world state
 */
export function exampleLoadMap() {
  const result = Engine.loadMap('my-level-v1');
  if (result.success) {
    console.log(`✓ World loaded: ${result.entitiesCreated} entities, ${result.settingsApplied} settings`);
  } else {
    console.warn('✗ World not found or failed to load');
  }
}

/**
 * Example: List all saved worlds
 */
export function exampleListMaps() {
  const maps = Engine.listMaps();
  console.log('Saved worlds:', maps);
  // Output: ['my-level-v1', 'test-level', 'autosave']
}

/**
 * Example: Export current world as JSON (for download/backup)
 */
export function exampleExportMap() {
  const json = Engine.exportMap();
  console.log('Exported JSON:', json);

  // Optionally save to file or send to server:
  // const blob = new Blob([json], { type: 'application/json' });
  // const url = URL.createObjectURL(blob);
  // const a = document.createElement('a');
  // a.href = url;
  // a.download = 'world.json';
  // a.click();
}

/**
 * Example: Export and save to localStorage with a name
 */
export function exampleExportAndSaveMap() {
  const json = Engine.exportMap('backup-v1');
  console.log('✓ Exported and saved as "backup-v1"');
}

/**
 * Example: Import world from JSON string
 */
export function exampleImportMap(jsonString: string) {
  const result = Engine.importMap(jsonString);
  if (result.success) {
    console.log(`✓ World imported: ${result.entitiesCreated} entities, ${result.settingsApplied} settings`);
  } else {
    console.error('✗ Failed to import world (invalid JSON)');
  }
}

/**
 * Example: Import and save with a name
 */
export function exampleImportAndSaveMap(jsonString: string) {
  const result = Engine.importMap(jsonString, 'imported-level');
  if (result.success) {
    console.log(`✓ World imported and saved as "imported-level"`);
  } else {
    console.error('✗ Import failed');
  }
}

/**
 * Example: Get info about a saved world
 */
export function exampleGetMapInfo() {
  const info = Engine.getMapInfo('my-level-v1');
  if (info) {
    console.log('World created at:', new Date(info.timestamp).toLocaleString());
    console.log('Entities:', info.entities.length);
    console.log('Fog density:', info.settings.fog.density);
  }
}

/**
 * Example: Delete a saved world
 */
export function exampleDeleteMap() {
  const deleted = Engine.deleteMap('my-level-v1');
  if (deleted) {
    console.log('✓ World deleted');
  } else {
    console.log('ℹ World not found');
  }
}

/**
 * Example: Auto-save every 30 seconds
 */
export function exampleAutoSave() {
  setInterval(() => {
    const timestamp = Engine.time.date().toLocaleTimeString();
    Engine.saveMap(`autosave-${timestamp}`);
    console.log(`[${timestamp}] Auto-saved world`);
  }, 30000); // 30 seconds
}

/**
 * Example: Create UI controls for save/load
 */
export function createSaveLoadUI() {
  const container = document.createElement('div');
  container.style.cssText = 'position: absolute; top: 20px; right: 20px; background: #1a1a1a; color: #fff; padding: 10px; border: 1px solid #444; border-radius: 4px;';
  container.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 10px;">Save/Load</div>
    <div style="margin-bottom: 10px;">
      <input type="text" id="mapName" placeholder="Map name" style="padding: 4px; width: 150px;">
    </div>
    <button id="saveBtn" style="padding: 6px 12px; margin-right: 5px; cursor: pointer;">Save</button>
    <button id="loadBtn" style="padding: 6px 12px; margin-right: 5px; cursor: pointer;">Load</button>
    <button id="exportBtn" style="padding: 6px 12px; margin-right: 5px; cursor: pointer;">Export</button>
    <button id="deleteBtn" style="padding: 6px 12px; cursor: pointer;">Delete</button>
    <div id="mapList" style="margin-top: 10px; font-size: 12px; max-height: 150px; overflow-y: auto;">
      <div>No maps</div>
    </div>
  `;

  document.body.appendChild(container);

  const mapNameInput = document.getElementById('mapName') as HTMLInputElement;
  const saveBtn = document.getElementById('saveBtn')!;
  const loadBtn = document.getElementById('loadBtn')!;
  const exportBtn = document.getElementById('exportBtn')!;
  const deleteBtn = document.getElementById('deleteBtn')!;
  const mapList = document.getElementById('mapList')!;

  function updateMapList() {
    const maps = Engine.listMaps();
    if (maps.length === 0) {
      mapList.innerHTML = '<div>No maps</div>';
    } else {
      mapList.innerHTML = maps
        .map((name) => `<div style="padding: 4px; cursor: pointer; hover: #444;">${name}</div>`)
        .join('');
    }
  }

  saveBtn.addEventListener('click', () => {
    const name = mapNameInput.value || `map-${Engine.time.now()}`;
    const success = Engine.saveMap(name);
    if (success) {
      console.log(`✓ Saved as "${name}"`);
      mapNameInput.value = '';
      updateMapList();
    }
  });

  loadBtn.addEventListener('click', () => {
    const name = mapNameInput.value;
    if (!name) {
      console.warn('Enter a map name');
      return;
    }
    const result = Engine.loadMap(name);
    if (result.success) {
      console.log(`✓ Loaded "${name}"`);
    } else {
      console.error(`✗ Map not found: "${name}"`);
    }
  });

  exportBtn.addEventListener('click', () => {
    const name = mapNameInput.value;
    const json = Engine.exportMap(name || undefined);
    console.log('Exported JSON:', json);
    // Clone to clipboard
    navigator.clipboard.writeText(json).then(() => {
      console.log('✓ JSON copied to clipboard');
    });
  });

  deleteBtn.addEventListener('click', () => {
    const name = mapNameInput.value;
    if (!name) {
      console.warn('Enter a map name');
      return;
    }
    const deleted = Engine.deleteMap(name);
    if (deleted) {
      console.log(`✓ Deleted "${name}"`);
      mapNameInput.value = '';
      updateMapList();
    }
  });

  updateMapList();
}

/**
 * Example: Custom serialization hook (if needed)
 * 
 * To extend SaveLoadManager with custom data:
 * 1. Extend SavedWorldState interface
 * 2. Override serializeWorld / deserializeWorld in SaveLoadManager
 * 3. Add custom save methods to Engine.ts
 */
export function exampleCustomSerialization() {
  // Get the SaveLoadManager instance
  const manager = Engine.getSaveLoadManager();
  if (!manager) {
    console.error('SaveLoadManager not available');
    return;
  }

  // Example: Get full serialized world
  // const world: SavedWorldState = manager.serializeWorld();
  // console.log('Full world state:', world);

  // Example: Get map metadata
  // const info = manager.getMapInfo('my-level');
  // console.log('Map version:', info?.version);
  // console.log('Created:', new Date(info?.timestamp || 0).toLocaleString());
}

/**
 * Example: Handle file import from user
 */
export function handleFileImport(file: File) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const json = event.target?.result as string;
    const mapName = file.name.replace('.json', '');

    const result = Engine.importMap(json, mapName);
    if (result.success) {
      console.log(`✓ Imported from "${file.name}": ${result.entitiesCreated} entities`);
    } else {
      console.error('✗ Failed to import file');
    }
  };
  reader.readAsText(file);
}

// Export console API for easy testing
(window as any).GameAPI = {
  saveMap: Engine.saveMap,
  loadMap: Engine.loadMap,
  listMaps: Engine.listMaps,
  deleteMap: Engine.deleteMap,
  exportMap: Engine.exportMap,
  importMap: Engine.importMap,
  getMapInfo: Engine.getMapInfo,
};

console.log(
  '%c[Save/Load System Initialized]%c\nUsage: GameAPI.saveMap("name"), GameAPI.loadMap("name"), etc.\nSee SaveLoadManagerDemo.ts for examples.',
  'color: #00ff00; font-weight: bold;',
  'color: #aaa;'
);
