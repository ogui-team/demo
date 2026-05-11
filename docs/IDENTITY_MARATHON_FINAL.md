# Identity Marathon Finalization

## Scope Completed

This document captures the finalized Identity Marathon work completed in the current implementation.

### 1. Identity Model and Deterministic Boundary

- Identity providers supported: `guest`, `google`, `discord`
- Kernel/gameplay boundary remains opaque-only:
  - `userId`
  - `isGuest`
  - `permissions`
- No raw OAuth provider tokens are exposed to deterministic gameplay systems.

### 2. Shared Contracts and Runtime Services

Implemented in shared SDK contracts and client runtime:

- Auth contracts exported via shared SDK surface
- Client auth service (`auth.manager`) and profile service (`profile.service`)
- `auth:changed` event emitted through public event bus
- Auth lock gating integrated before multiplayer host/join startup

### 3. Backend Identity Boundary

Implemented backend boundary and callback scaffolding:

- Session middleware with opaque auth context injection
- OAuth callback placeholders for Google and Discord
- Internal game API JWT signing/verification
- In-memory session and user-identity stores

### 4. WebSocket Identity Propagation

Implemented for real multiplayer session startup flow:

- WS handshake resolves auth from:
  1. Session cookie
  2. Bearer token
  3. Query token (`?token=...`)
  4. Guest fallback
- Invalid token handshake is rejected
- Socket-to-identity binding is established on connection
- `AUTH_CONTEXT` message is emitted after connect
- `JOIN_ACK` and `GAME_START` now include `identitySnapshot`
- Authenticated users resolve deterministic player identity to `userId`

### 5. Main Screen Login HUD

Implemented in the main screen accessory area:

- New auth HUD panel visible directly on the main menu
- Shows current auth state/provider/lock and profile identity
- Action buttons:
  - Google sign-in
  - Discord sign-in
  - Guest
  - Logout
- Uses existing `auth.manager` service methods
- Auth plugin now performs callback POST requests against backend routes and persists JWT/profile locally

## Persistence and Repository Readiness

Repository abstraction interfaces were added to support future persistence swap:

- Base repository interface
- Session repository interface
- User identity repository interface
- Player profile repository interface
- In-memory player profile store

This allows replacing in-memory implementations with Prisma-backed repositories without changing business-level auth flow.

## Prisma Readiness

Prisma schema has been prepared at:

- `prisma/schema.prisma`

Defined models:

- `User`
- `UserIdentity`
- `Session`
- `PlayerProfile`

Schema is aligned to current auth/session flow so migration can proceed with minimal logic changes.

## How to Use Prisma Later

When you are ready to enable Prisma runtime usage, run these steps from repository root:

1. Install Prisma dependencies:

```powershell
npm install prisma @prisma/client --save-dev
```

2. Set database URL in environment:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public"
```

3. Generate first migration:

```powershell
npx prisma migrate dev --name init_identity
```

4. Generate Prisma client:

```powershell
npx prisma generate
```

5. Replace in-memory repositories with Prisma-backed repositories, keeping the same repository interfaces.

## Current Status

- Identity propagation: implemented
- Login HUD on main screen: implemented
- Prisma schema draft and DB-readiness docs: implemented
- Next optional step: switch in-memory stores to Prisma adapters and add DB-backed integration tests
