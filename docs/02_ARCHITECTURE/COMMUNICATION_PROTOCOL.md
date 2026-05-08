# Engine Communication Protocol

## Tower 1: The Logic Tower (Engine/Architecture)
- **Role:** Strict compiler and refactor agent.
- **Constraints:** Must respect 0.1.2 replication policies. Must use EventBus. Must provide TypeDocs.
- **Goal:** Stability, Memory Safety, Performance.

## Tower 2: The Design Tower (Ideation/Iteration)
- **Role:** Creative Director / Product Manager.
- **Constraints:** Focuses on "The Experience," not the implementation.
- **Goal:** Gameplay loops, user satisfaction, feature roadmap.

## Handshake Rule
No logic changes from Tower 2 are allowed in the engine until they are formalized as a `SPEC_*.md` file and reviewed by Tower 1.