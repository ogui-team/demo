/**
 * DRIFT BOMB OBJECTIVE SYSTEM
 * Bomb sites, drift routes, spawn locations, map logic
 */

export interface BombSite {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  radius: number; // plant radius
  epoch: number; // for determinism tracking
}

export interface DriftRoute {
  id: string;
  name: string;
  startSite: string; // bomb site ID
  waypoints: Array<{ x: number; y: number; z: number; order: number }>;
  durationSec: number; // expected drift time
  epoch: number;
}

export interface SpawnZone {
  id: string;
  name: string;
  team: 'attackers' | 'defenders';
  position: { x: number; y: number; z: number };
  radius: number; // spread radius
  epoch: number;
}

export interface MapObjectives {
  bombSites: BombSite[];
  driftRoutes: DriftRoute[];
  spawnZones: SpawnZone[];
  buyZones: SpawnZone[]; // special zones where buying is allowed
}

export class DriftBombObjectiveSystem {
  private objectives: MapObjectives;
  private selectedSite: BombSite | null = null;
  private selectedRoute: DriftRoute | null = null;
  private plantedSiteId: string | null = null;

  constructor(objectives: MapObjectives) {
    this.objectives = objectives;
  }

  /**
   * Get all bomb sites for this map
   */
  getBombSites(): readonly BombSite[] {
    return [...this.objectives.bombSites];
  }

  /**
   * Get all drift routes
   */
  getDriftRoutes(): readonly DriftRoute[] {
    return [...this.objectives.driftRoutes];
  }

  /**
   * Get routes that start from a specific bomb site
   */
  getRoutesForSite(siteId: string): DriftRoute[] {
    return this.objectives.driftRoutes.filter((route) => route.startSite === siteId);
  }

  /**
   * Get all spawn zones
   */
  getSpawnZones(): readonly SpawnZone[] {
    return [...this.objectives.spawnZones];
  }

  /**
   * Get spawn zones for a specific team
   */
  getSpawnZonesForTeam(team: 'attackers' | 'defenders'): SpawnZone[] {
    return this.objectives.spawnZones.filter((zone) => zone.team === team);
  }

  /**
   * Get buy zones
   */
  getBuyZones(): readonly SpawnZone[] {
    return [...this.objectives.buyZones];
  }

  /**
   * Attempt to plant bomb at a site
   */
  canPlantAtSite(siteId: string, playerPos: { x: number; y: number; z: number }): boolean {
    const site = this.objectives.bombSites.find((s) => s.id === siteId);
    if (!site) return false;

    // Check if player is within plant radius
    const distance = this.calculateDistance(playerPos, site.position);
    return distance <= site.radius;
  }

  /**
   * Plant bomb at a site, select a drift route
   */
  plantBomb(siteId: string): DriftRoute | null {
    const site = this.objectives.bombSites.find((s) => s.id === siteId);
    if (!site) return null;

    this.selectedSite = site;
    this.plantedSiteId = siteId;

    // Get available routes from this site
    const routes = this.getRoutesForSite(siteId);
    if (routes.length === 0) return null;

    // For now, select the first route
    // In future, could randomize or allow player selection
    this.selectedRoute = routes[0];
    return this.selectedRoute;
  }

  /**
   * Get planted site info
   */
  getPlantedSiteId(): string | null {
    return this.plantedSiteId;
  }

  /**
   * Get selected drift route
   */
  getSelectedRoute(): DriftRoute | null {
    return this.selectedRoute;
  }

  /**
   * Get waypoints for current route as array suitable for bomb movement
   */
  getRouteWaypoints(): Array<{ position: { x: number; y: number; z: number }; order: number; epoch: number }> {
    if (!this.selectedRoute) return [];

    return this.selectedRoute.waypoints.map((wp) => ({
      position: wp,
      order: wp.order,
      epoch: this.selectedRoute!.epoch,
    }));
  }

  /**
   * Get random spawn position for a team
   */
  getRandomSpawnPosition(team: 'attackers' | 'defenders'): { x: number; y: number; z: number } {
    const zones = this.getSpawnZonesForTeam(team);
    if (zones.length === 0) {
      // Fallback spawn
      return { x: 0, y: 0, z: 0 };
    }

    // Select random zone
    const zone = zones[Math.floor(Math.random() * zones.length)];

    // Select random position within zone radius
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * zone.radius;

    return {
      x: zone.position.x + Math.cos(angle) * radius,
      y: zone.position.y,
      z: zone.position.z + Math.sin(angle) * radius,
    };
  }

  /**
   * Check if player is in a buy zone
   */
  isInBuyZone(playerPos: { x: number; y: number; z: number }): boolean {
    for (const zone of this.objectives.buyZones) {
      const distance = this.calculateDistance(playerPos, zone.position);
      if (distance <= zone.radius) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get default map objectives (training map)
   */
  static createDefaultMap(): MapObjectives {
    return {
      bombSites: [
        {
          id: 'site_a',
          name: 'Site A',
          position: { x: 50, y: 0, z: 50 },
          radius: 10,
          epoch: 0,
        },
        {
          id: 'site_b',
          name: 'Site B',
          position: { x: -50, y: 0, z: 50 },
          radius: 10,
          epoch: 0,
        },
      ],
      driftRoutes: [
        {
          id: 'route_a_left',
          name: 'Site A → Left Path',
          startSite: 'site_a',
          waypoints: [
            { x: 50, y: 0, z: 50, order: 0 },
            { x: 30, y: 5, z: 60, order: 1 },
            { x: 10, y: 10, z: 70, order: 2 },
            { x: -10, y: 8, z: 65, order: 3 },
            { x: -30, y: 5, z: 60, order: 4 },
          ],
          durationSec: 30,
          epoch: 0,
        },
        {
          id: 'route_a_right',
          name: 'Site A → Right Path',
          startSite: 'site_a',
          waypoints: [
            { x: 50, y: 0, z: 50, order: 0 },
            { x: 50, y: 5, z: 70, order: 1 },
            { x: 45, y: 10, z: 85, order: 2 },
            { x: 20, y: 8, z: 80, order: 3 },
            { x: 0, y: 5, z: 90, order: 4 },
          ],
          durationSec: 30,
          epoch: 0,
        },
        {
          id: 'route_b_left',
          name: 'Site B → Left Path',
          startSite: 'site_b',
          waypoints: [
            { x: -50, y: 0, z: 50, order: 0 },
            { x: -50, y: 5, z: 70, order: 1 },
            { x: -45, y: 10, z: 85, order: 2 },
            { x: -20, y: 8, z: 80, order: 3 },
            { x: 0, y: 5, z: 90, order: 4 },
          ],
          durationSec: 30,
          epoch: 0,
        },
      ],
      spawnZones: [
        {
          id: 'spawn_attackers',
          name: 'Attacker Spawn',
          team: 'attackers',
          position: { x: 0, y: 0, z: -50 },
          radius: 15,
          epoch: 0,
        },
        {
          id: 'spawn_defenders',
          name: 'Defender Spawn',
          team: 'defenders',
          position: { x: 0, y: 0, z: 0 },
          radius: 15,
          epoch: 0,
        },
      ],
      buyZones: [
        {
          id: 'buy_spawn_attackers',
          name: 'Attacker Buy Zone',
          team: 'attackers',
          position: { x: 0, y: 0, z: -50 },
          radius: 20,
          epoch: 0,
        },
        {
          id: 'buy_spawn_defenders',
          name: 'Defender Buy Zone',
          team: 'defenders',
          position: { x: 0, y: 0, z: 0 },
          radius: 20,
          epoch: 0,
        },
      ],
    };
  }

  /**
   * Compact verification map tuned for rapid offline gameplay validation.
   */
  static createDebugMap(): MapObjectives {
    return {
      bombSites: [
        {
          id: 'site_alpha',
          name: 'Site Alpha',
          position: { x: 18, y: 0, z: 10 },
          radius: 7,
          epoch: 1,
        },
        {
          id: 'site_bravo',
          name: 'Site Bravo',
          position: { x: -18, y: 0, z: 10 },
          radius: 7,
          epoch: 1,
        },
      ],
      driftRoutes: [
        {
          id: 'route_alpha_escort',
          name: 'Alpha Escort Corridor',
          startSite: 'site_alpha',
          waypoints: [
            { x: 18, y: 0.6, z: 10, order: 0 },
            { x: 10, y: 1.0, z: 16, order: 1 },
            { x: 2, y: 1.2, z: 20, order: 2 },
            { x: -8, y: 0.9, z: 18, order: 3 },
            { x: -16, y: 0.7, z: 14, order: 4 },
          ],
          durationSec: 26,
          epoch: 1,
        },
        {
          id: 'route_bravo_escort',
          name: 'Bravo Escort Corridor',
          startSite: 'site_bravo',
          waypoints: [
            { x: -18, y: 0.6, z: 10, order: 0 },
            { x: -10, y: 0.9, z: 16, order: 1 },
            { x: -2, y: 1.1, z: 20, order: 2 },
            { x: 8, y: 0.9, z: 18, order: 3 },
            { x: 16, y: 0.7, z: 14, order: 4 },
          ],
          durationSec: 26,
          epoch: 1,
        },
      ],
      spawnZones: [
        {
          id: 'spawn_attackers_debug',
          name: 'Attack Spawn',
          team: 'attackers',
          position: { x: 0, y: 0, z: -16 },
          radius: 6,
          epoch: 1,
        },
        {
          id: 'spawn_defenders_debug',
          name: 'Defend Spawn',
          team: 'defenders',
          position: { x: 0, y: 0, z: 22 },
          radius: 6,
          epoch: 1,
        },
      ],
      buyZones: [
        {
          id: 'buy_attackers_debug',
          name: 'Attack Buy',
          team: 'attackers',
          position: { x: 0, y: 0, z: -16 },
          radius: 9,
          epoch: 1,
        },
        {
          id: 'buy_defenders_debug',
          name: 'Defend Buy',
          team: 'defenders',
          position: { x: 0, y: 0, z: 22 },
          radius: 9,
          epoch: 1,
        },
      ],
    };
  }

  private calculateDistance(
    pos1: { x: number; y: number; z: number },
    pos2: { x: number; y: number; z: number },
  ): number {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const dz = pos2.z - pos1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
