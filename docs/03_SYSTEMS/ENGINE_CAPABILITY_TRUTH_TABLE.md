# Engine Capability Truth Table

This table reflects the frozen v0.1.1 baseline and uses current-state wording only.

| Feature | Status in v0.1.1 | Notes |
| --- | --- | --- |
| Client prediction | Partial | `NetworkSyncSystem` provides the reusable client-side prediction and reconciliation surface used by the current runtime. |
| Server reconciliation | Partial | Reconciliation logic exists in the current networking/runtime stack, but the shipped baseline remains focused on the validated local representative server flow rather than a broader dedicated-server product surface. |
| Lag compensation | Partial | History buffer and rewind validation exist in the client/network runtime, while the live server baseline does not yet consume the full rewind path for general gameplay. |
| Reflection-driven replication | Implemented foundation | `ReplicationSystem` uses reflection metadata through the current serialization path. |
| Delta snapshots | Implemented foundation | Replication snapshots track changed fields instead of always transmitting full entity state. |
| Spatial partitioning | Implemented foundation | `SpatialPartitionSystem` provides runtime neighborhood and relevance support. |
| Resource lifetime management | Implemented foundation | `ResourceManager` provides loading, ref-counting, and controlled resource lifetime support. |
| Asset streaming | Partial | Runtime streaming hooks exist, but the frozen baseline does not expose a broader authoring workflow around them. |
| Entity lifecycle metadata | Implemented foundation | Entity lifecycle metadata is present in the current entity/runtime model. |
| Network-safe ability validation | Partial | Validation hooks exist in the networking layer, while the full gameplay surface is not uniformly routed through them in the frozen baseline. |
| Advanced animation graph / IK | Not part of v0.1.1 | No general blend graph, skeletal controller, or IK runtime is part of the shipped baseline. |
| Spatial audio occlusion / reverb volumes | Partial | Positional audio exists; room-volume and occlusion modeling are not part of the current baseline. |
| Behavior trees / AI director | Partial | The baseline includes actor-runtime support but not a broader behavior-tree or AI-director framework. |
| Full BVH / octree world partition | Not part of v0.1.1 | The shipped runtime uses grid-based spatial partitioning rather than BVH or octree partitioning. |
| Database-backed persistence / auth | Not part of v0.1.1 | Server persistence remains file-based in the frozen baseline. |
| Full frame graph profiler | Partial | Runtime diagnostics and netgraph exist, but a full frame-graph or GPU-timing profiler is not part of v0.1.1. |
| Timeline-driven VFX sequencing | Not part of v0.1.1 | The shipped baseline does not include a timeline-driven gameplay VFX sequencer. |
| Sandboxed modding runtime | Partial | Script registration exists; a hardened sandboxed mod runtime is not part of the frozen baseline. |
