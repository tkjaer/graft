# Graft v2 — Real-time Collaborative Editor

> Design doc and status tracker for the v2 collaborative editing features.

## Context

Graft is a collaborative markdown editor backed by GitHub. Documents stay as markdown in GitHub repos. The editing experience needs to match what people expect from Google Docs: open a link, see who else is editing, leave comments, suggest changes — no git or markdown knowledge required.

## Architecture

```
┌─────────────┐     wss://       ┌──────────────────────────┐
│  Browsers   │◄────────────────►│  Sync server (k8s pods)  │
│             │                  │  y-websocket + custom    │
└─────────────┘                  │  persistence hooks       │
                                 └──────────┬───────────────┘
       ┌──────────────┐                     │
       │  VS Code ext │◄───── wss:// ──-────┘
       └──────────────┘                     │
                                 ┌──────────▼───────────────┐
                                 │   Redis (pub/sub)        │
                                 └──────────┬───────────────┘
                                            │
                                 ┌──────────▼───────────────┐
                                 │   GitHub API             │
                                 │   content + orphan branch│
                                 └──────────────────────────┘
```

- **Sync server**: Node.js, y-websocket, one Y.Doc per open document. Saves to GitHub on debounced idle (60s). 2–6 pods, HPA on WebSocket connection count (~200-300/pod). Graceful shutdown on SIGTERM (flush saves, send reconnect close frame, 30s drain).
- **Redis**: pub/sub for cross-pod Y.Doc sync (`y-redis`). Single instance.
- **Ingress**: WebSocket upgrade, sticky sessions on document ID.
- **Web app**: Static Vite bundle, served separately (CDN/nginx/Pages). Connects to sync server via WebSocket.
- **VS Code extension**: Same WebSocket connection. Falls back to async mode (direct GitHub API) if sync server is down.

## Build plan

Two phases: **build everything**, then **make it work**.

### Phase 1: Build

All code written up front. Compiling and structurally correct, not necessarily working end-to-end.

#### Sync server (`server/`)

- [x] y-websocket setup with room management (room ID = branch + file path)
- [x] Persistence hooks
  - Load: GitHub branch → markdown → Y.Doc on first connect
  - Save: Y.Doc → markdown → commit to branch (debounced 60s + on last disconnect)
  - Save comments Y.Map → JSON → orphan branch (same debounce)
- [x] Auth middleware (verify token on WebSocket upgrade, extract user identity, check repo access)
- [x] Redis pub/sub adapter (`y-redis`)
- [x] GitHub webhook endpoint (`POST /webhooks/github`) for external change detection
- [x] Graceful shutdown (SIGTERM: stop accepting, flush, close frames, 30s drain)
- [x] Dockerfile + k8s manifests

#### Client — real-time editing

- [x] `@tiptap/extension-collaboration` (Y.Doc ↔ Tiptap via `Y.XmlFragment`)
- [x] `@tiptap/extension-collaboration-cursor` (colored cursors, awareness protocol)
- [x] Presence indicator in toolbar (user count, names/avatars on click)
- [x] Reconnection with jitter + "Offline mode" badge + async fallback

#### Client — auth + routing

- [x] OAuth redirect flow (alternative to device flow for smoother UX)
- [x] Deep links: `https://graft.example.com/owner/repo/branch/path.md` → auto-auth → editor

#### Client — comments

- [x] Comments as `Y.Map` in shared Y.Doc (id, `Y.RelativePosition` anchor, body, author, resolved, replies)
- [x] `Y.RelativePosition` ↔ `TextAnchor` conversion (for persistence to orphan branch)
- [x] Sidebar renders reactively from Y.Map
- [ ] @mentions with autocomplete from repo collaborators

#### Client — image upload

- [x] Drag-and-drop / paste → upload to repo (`assets/`, content-hashed filename)
- [x] Insert `![alt](relative-path)`, resolve to raw.githubusercontent.com for preview
- [x] Client-side resize for images >1MB

#### Client — editing modes + UX

- [x] "Suggesting" mode (tracked changes — edits wrapped in suggestion marks, accept/reject inline)
- [ ] Simplified toolbar (hide power-user toggles, show formatting/comment/suggest/save)
- [x] Slash commands (`/heading`, `/table`, `/code`, `/image`, `/divider`)

#### Client — history

- [x] Version history panel (git log, click to view, diff between versions)
- [x] "What changed since I last looked" badge (last-viewed timestamp per user)

### Phase 2: Make it work

Integration, debugging, and polish. This is where the time goes.

#### Infrastructure (first — everything else depends on this)

- [ ] Sync server runs locally (Docker Compose: server + Redis)
- [ ] WebSocket connects, Y.Doc round-trips (load → edit → save to GitHub)
- [ ] Two browser tabs editing same doc, changes appear in both
- [ ] Deploy to k8s, ingress with WebSocket upgrade + sticky sessions
- [ ] Redis pub/sub works across pods

#### Auth + access

- [ ] OAuth end-to-end (login → token → WebSocket auth)
- [ ] Deep links resolve correctly
- [ ] Permission denied handled gracefully

#### Real-time edge cases

- [ ] Reconnection after network drop (no data loss)
- [ ] Graceful shutdown during rolling deploy (clients reconnect, no lost edits)
- [ ] 3+ users simultaneous editing (CRDT convergence)
- [ ] Large documents (~500KB) — memory + latency acceptable
- [ ] Source pane shows live markdown (read-only in collab mode)

#### Features

- [ ] Comment anchors survive concurrent edits, persist and reload correctly
- [ ] @mention autocomplete populates
- [ ] Image paste → inline → committed on save
- [ ] Suggesting mode: toggle, tracked changes visible, accept/reject works
- [ ] History panel: git log, version view, diff
- [ ] Conflict: webhook detects external commit → 3-way merge into Y.Doc
- [ ] Toolbar modes, slash commands, "what changed" badge
- [ ] Offline fallback (direct GitHub API)
- [ ] VS Code extension connects to sync server

## Technical decisions

### Y.Doc structure

```
Y.Doc
├── Y.XmlFragment "prosemirror"     ← Tiptap document content
├── Y.Map "comments"                ← comment-id → { anchor, body, author, ... }
└── Y.Map "meta"                    ← file SHA, last save timestamp, savedContent (for 3-way merge base)
```

### Comment anchoring (dual model)

- **Live editing**: `Y.RelativePosition` (CRDT position, survives concurrent edits)
- **Persisted to orphan branch**: `TextAnchor` (`{ text, prefix, suffix }`) — existing format from `anchoring.ts`
- Convert between them on save/load. Y.RelativePosition is the source of truth during live sessions.

### Conflict handling (external commits)

External commits (git push, GitHub web editor) cause the branch HEAD and Y.Doc to diverge.

**Detection**: GitHub webhook on `push` events → sync server matches changed files to open rooms. Fallback: conditional polling every 5 min with `If-None-Match` (304s are free) for repos without webhooks.

**Resolution**: 3-way merge using `node-diff3` (base = last saved content from `Y.Map("meta")`, ours = current Y.Doc, theirs = new HEAD). Clean merge → apply to Y.Doc automatically + toast. Conflicts → notify clients, open `@codemirror/merge` MergeView for manual resolution.

**On save 409** (v1 immediate): same 3-way merge, auto-save if clean, MergeView if not.

### Source pane

Stays editable in collab mode. Y.XmlFragment is the single source of truth (no separate Y.Text for CodeMirror). Edits in the source pane go through markdown parse → ProseMirror transaction → Y.XmlFragment → Yjs propagates to all clients. Remote edits flow the other direction: Y.XmlFragment updates → serialize to markdown → update CodeMirror (debounced ~100ms). Same architecture as v1, with Yjs as the sync layer instead of direct state.
