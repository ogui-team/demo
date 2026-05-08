# 🚀 5000 NPC SCALING: PRACTICAL RULES
**Date**: April 17, 2026  
**Philosophy**: Simple limits. Don't over-architect.  
**Goal**: 5000 entities @ 60 FPS with <150MB memory

---

## 🎯 3 HARD LIMITS (Enforce these)

### LIMIT 1: Physics Collision Range
**Rule**: Collision checks only within 50-unit radius  
**Implementation**: Spatial grid with 50-unit cells  
**Cost if violated**: O(n²) slowdown, 5000 entities = 1000x slower  
**Where to enforce**: PhysicsSystem.checkCollisions()  

```typescript
// client/src/engine/systems/PhysicsSystem.ts
checkCollisions(): void {
  const cellSize = 50;
  for (const entity of this.entities) {
    const cell = Math.floor(entity.position.x / cellSize);
    // Only check entities in same cell ± 1 cell
    const nearby = this.spatialGrid.getCell(cell - 1, 0, cell + 1);
    for (const other of nearby) {
      this.checkPair(entity, other);
    }
  }
}
```

### LIMIT 2: AI Update Rate
**Rule**: Distant entities update every 4 frames (LOD-based)  
**Implementation**: distance < 100 units = update every frame, else every 4th  
**Cost if violated**: CPU spike from 5000 AI updates/frame  
**Where to enforce**: CharacterActorSystem.update()  

```typescript
update(dt: number): void {
  const playerPos = this.getLocalPlayerPosition();
  for (const actor of this.actors) {
    const dist = distance(actor.pos, playerPos);
    const updateFreq = dist < 100 ? 1 : 4;  // Every 1 frame or every 4
    if (this.frameCount % updateFreq === 0) {
      actor.updateAI(dt);
    }
  }
}
```

### LIMIT 3: Network Snapshot Filtering
**Rule**: Don't broadcast entities > 200 units from any player  
**Implementation**: Server filters snapshot by distance before send  
**Cost if violated**: Network bandwidth grows linearly, 5000 entities = 1000x BW  
**Where to enforce**: server/src/snapshotBroadcast.ts  

```typescript
broadcastSnapshot(entities: Entity[], recipients: Player[]): void {
  for (const recipient of recipients) {
    const filtered = entities.filter(e => {
      return distance(e.pos, recipient.pos) < 200;
    });
    this.send(recipient, filtered);
  }
}
```

---

## 📊 EXPECTED PERFORMANCE AT 5000

| Aspect | Value | Test |
|--------|-------|------|
| Physics checks/frame | 500 (not 5000²) | Measure via profiler |
| AI updates/frame | 2000 (at scale) | Count active LOD |
| Network bandwidth | 50 KiB/s | Monitor server send |
| Memory | 120-140 MB | Heap snapshot |
| FPS | 55-60 | Sustained |

---

## ⚠️ WHAT NOT TO DO

### ❌ Don't do adaptive limits
Tempting: "Auto-adjust limits based on perf"  
Reality: Over-engineers, adds bugs, hard to debug  
Better: Hard limits known in advance

### ❌ Don't cache entity results
Tempting: "Cache all collisions each frame"  
Reality: 5000 entities = 25M cache entries = memory spike  
Better: Spatial grid (on-demand)

### ❌ Don't multi-thread physics
Tempting: "Parallelize collision checks"  
Reality: Synchronization overhead > speedup at this scale  
Better: Single-threaded with spatial grid (already fast enough)

### ❌ Don't add async systems
Tempting: "Load/unload distant entities"  
Reality: Introduce race conditions, hard to test  
Better: Keep all 5000, just reduce update frequency (LOD)

---

## 🔧 INTEGRATION (Where to add these)

### Milestone 2A: Spatial Culling (5 days)
- Implement PhysicsSystem collision range limit
- Add spatial grid to SpatialPartitionSystem
- Verify FPS @ 1000, 2000, 5000 entities

### Milestone 2B: LOD System (4 days)
- Add distance-based AI update throttling
- Verify CPU load @ 5000 entities
- Monitor FPS stays >55

### Milestone 1C (Existing): Network Filtering
- Integrate snapshot distance filtering into server broadcast
- Verify bandwidth doesn't exceed 100 KiB/s @ 5000 entities
- Test multiplayer session stability

---

## ✅ VALIDATION GATE (Milestone 2A-2B)

After implementing limits, verify:

```bash
npm run test:stress:5knpc

Expected output:
✅ PASS: 5000 NPCs, 60 FPS, 120MB memory

Breakdown:
- Physics: 500 checks/frame ✓
- AI: 2000 active updates ✓
- Memory: 120MB ✓
- FPS: Steady 60 ✓
```

**If fails**: Debug which limit is violated, adjust threshold  
**If passes**: 5000 NPC benchmark = COMPLETE

---

## 📝 RULE SUMMARY (Quick reference)

| Rule | Limit | File | Impact |
|------|-------|------|--------|
| Physics range | 50 units | PhysicsSystem.ts | Prevents O(n²) |
| AI LOD | 100 unit range = every frame | CharacterActorSystem.ts | Halves CPU @ distance |
| Network filter | 200 units | snapshotBroadcast.ts | Reduces BW by 90% |

---

**Cost to implement**: Integrated into Milestones 2A-2B  
**Implementation time**: Already accounted for (5 + 4 days)  
**Expected result**: 5000 NPC benchmark PASS
