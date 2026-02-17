# Graft — Collaborative Markdown Editor

## What is this?

A collaborative markdown editor backed by GitHub. It provides a Google Docs-like editing experience for markdown files stored in GitHub repos — WYSIWYG editing (Tiptap), inline comments anchored to text ranges, and change suggestions. The underlying format is always raw markdown committed to a Git branch.

Available as both a **VS Code extension** and a **standalone web app** (hosted on GitHub Pages).

## Why does this exist?

Markdown files in GitHub repos (docs, RFCs, specs, blog posts) are collaborative documents, but the editing experience is poor:

- GitHub's web editor is basic and has no inline commenting on text ranges
- PR review comments are line-based and tied to diffs — they can't anchor to phrases
- Non-technical collaborators (PMs, writers, designers) shouldn't need to know markdown syntax
- There's no "suggest changes" flow for prose like Google Docs has

Graft bridges this gap: developers keep their markdown-in-git workflow, non-technical collaborators get a rich editor with inline comments and suggestions.

## Architecture

Two entry points share the same core logic:

```
┌──────────────────────┐    ┌─────────────────────────┐
│  VS Code Extension   │    │  Web App (GitHub Pages)  │
│  (EditorPanel.ts)    │    │  (web/main.ts)           │
│                      │    │                          │
│  ┌────────────────┐  │    │  ┌───────────────────┐   │
│  │  Tiptap WYSIWYG│  │    │  │  Tiptap WYSIWYG   │   │
│  │  (WebviewPanel)│  │    │  │  (same editor)    │   │
│  └───────┬────────┘  │    │  └───────┬───────────┘   │
│          │ postMsg   │    │          │ direct calls   │
│  ┌───────▼────────┐  │    │  ┌───────▼───────────┐   │
│  │  github/api.ts │  │    │  │  web/api.ts        │   │
│  │  (Node/Buffer) │  │    │  │  (browser/btoa)    │   │
│  └───────┬────────┘  │    │  └───────┬───────────┘   │
└──────────┼───────────┘    └──────────┼───────────────┘
           │                           │
     ┌─────▼───────────────────────────▼──┐
     │         GitHub REST API            │
     │  Content: branch file              │
     │  Comments: orphan branch           │
     └────────────────────────────────────┘

Shared modules: src/shared/anchoring.ts, src/shared/url.ts, src/types.ts
```

### Key design decisions

1. **Tiptap + tiptap-markdown** — WYSIWYG editing with markdown serialization. Users never see markdown syntax unless they open the source pane. The file on disk is always `.md`.

2. **Split view with CodeMirror 6** — A toggleable source pane shows the raw markdown side-by-side with the WYSIWYG editor. Built with CodeMirror 6 (`@codemirror/view`, `@codemirror/lang-markdown`). Changes sync bidirectionally with debouncing. Optional vim bindings via `@replit/codemirror-vim` (toggled at runtime using a CodeMirror `Compartment`). Scroll position syncs proportionally between panes (with a 50ms guard + `Math.round()` to prevent feedback loops).

2. **Comments on an orphan branch** — Comments are stored as JSON files on a `graft-comments` orphan branch in the same repo. This avoids polluting the main branch, requires zero infrastructure (no database), and comments get full Git history for free. The branch is created automatically on first comment.

3. **Text anchoring, not line numbers** — Comments are anchored by `{ text, prefix, suffix }` — the highlighted text plus ~50 chars of surrounding context. This survives edits (lines added/removed, paragraphs reworded). Resolution algorithm: exact match → fuzzy prefix/suffix match → orphaned. Core logic is in `src/shared/anchoring.ts`.

4. **Comments die with the branch** — When a PR branch is deleted after merge, the comments path (keyed by branch name) becomes unreachable. No cleanup needed.

5. **Two entry points, shared core** — The VS Code extension uses `postMessage` to bridge the webview and Node APIs. The web app calls the GitHub API directly from the browser. Both share types, anchoring logic, and URL parsing from `src/shared/`.

6. **Device flow auth (web app)** — The web app uses GitHub's OAuth device flow, which requires no client secret and runs entirely in the browser. The GitHub App client ID is the only config, set via `VITE_GITHUB_CLIENT_ID` at build time. Tokens are stored in `sessionStorage` (cleared on tab close).

7. **No backend** — Both the extension and web app are fully client-side. The web app is a static site on GitHub Pages. GitHub handles auth, storage, and access control.

8. **Themes** — The web app supports multiple themes (GitHub Light, GitHub Dark, GitHub Dark Dimmed, Dracula, Solarized Light) defined in `src/shared/themes.ts`. Each theme is a set of CSS variable values applied to `:root` via JS. Defaults to system preference, persisted in `localStorage`. The VS Code extension uses VS Code's own theme via `--vscode-*` CSS variables.

9. **Syntax highlighting via `classHighlighter`** — Instead of CodeMirror's `defaultHighlightStyle` (which injects inline colors), we use `classHighlighter` from `@lezer/highlight` which only adds `.tok-*` CSS classes. This lets themes control syntax colors via CSS variables (`--syn-keyword`, `--syn-comment`, etc.).

## File structure

```
src/
  extension.ts          — Extension entry, registers `graft.open` command
  EditorPanel.ts        — WebviewPanel host, message bridge, save handler
  types.ts              — DocComment, TextAnchor, CommentReply types (shared)
  shared/
    anchoring.ts        — Text anchor creation + resolution (shared, pure functions)
    url.ts              — GitHub URL parsing (shared)
    source-editor.ts    — CodeMirror 6 source pane (shared between extension + web)
    themes.ts           — Theme definitions + application (web app only)
  github/
    auth.ts             — GitHub OAuth via VS Code authentication API
    api.ts              — Octokit wrapper (Node, uses Buffer)
  webview/
    main.ts             — Tiptap editor for VS Code webview (uses postMessage)
    styles.css          — VS Code-themed styles (uses --vscode-* CSS variables)
  web/
    main.ts             — Web app entry: login, file picker, editor (direct API calls)
    api.ts              — Octokit wrapper (browser, uses btoa/atob)
    auth.ts             — Device flow authentication
    styles.css          — Web styles (theme-driven via CSS variables)
    env.d.ts            — Vite env type declarations
web/
  index.html            — Web app HTML entry point (for Vite)
esbuild.mjs             — Dual build: extension (Node/CJS) + webview (browser/IIFE)
vite.config.ts          — Vite config for web app build
.env.example            — Template for VITE_GITHUB_CLIENT_ID
.github/
  workflows/
    deploy-web.yml      — GitHub Actions: build + deploy to GitHub Pages
  copilot-instructions.md
```

## Data model

### Document content
- Stored as a markdown file on a GitHub branch
- Read/written via the GitHub Contents API with SHA-based optimistic concurrency
- The Tiptap editor round-trips through `tiptap-markdown` for serialization

### Comments (`DocComment`)
- Stored as `{branch}/{filepath}.comments.json` on the `graft-comments` orphan branch
- Each comment has: `id`, `type` (comment|suggestion), `anchor` (TextAnchor), `body`, `replacement?`, `author`, `resolved`, `replies[]`
- Suggestions include a `replacement` field — the proposed text change

### Text anchors (`TextAnchor`)
- `text` — the exact highlighted text
- `prefix` — ~50 chars before (for disambiguation when the same text appears multiple times)
- `suffix` — ~50 chars after
- Anchors are re-serialized on every save so they stay current
- Core logic in `src/shared/anchoring.ts` — pure functions, no editor dependency

## User flows

### VS Code extension
1. User runs `Graft: Open Document`
2. Pastes a GitHub URL — either a file URL (`/blob/branch/path.md`) or a PR URL (`/pull/42`)
3. For PRs: lists `.md` files in the PR, user picks one
4. Loads markdown content + comments from GitHub
5. Opens Tiptap WYSIWYG editor in a WebviewPanel

### Web app
1. User opens the web app URL
2. Signs in via GitHub device flow (enters code at github.com/login/device)
3. Pastes a GitHub URL in the input field (or uses a deep link via URL hash)
4. For PRs: picks a markdown file from the PR's file list
5. Editor loads with same Tiptap WYSIWYG + comment sidebar

### Commenting (both)
1. Select text in the editor
2. Click 💬 (comment) or ✏️ (suggest change)
3. Type comment body (and replacement text for suggestions)
4. Submit → yellow/green highlight appears in editor, comment card appears in sidebar
5. Save → comments committed to orphan branch alongside the markdown content

### Accepting a suggestion
1. Click "Accept suggestion" on a suggestion card in the sidebar
2. The highlighted text is replaced with the suggestion's replacement text in the editor
3. The comment is marked as resolved

### Saving
1. ⌘S or click Save
2. Markdown content is committed to the document's branch
3. Comments JSON is committed to the orphan branch
4. Both use SHA-based concurrency (409 on conflict)

## Tech stack

- **Editor**: Tiptap v2 + ProseMirror (via `@tiptap/core`, `@tiptap/starter-kit`)
- **Source pane**: CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`)
- **Vim bindings**: `@replit/codemirror-vim` (optional, runtime toggle via `Compartment`)
- **Syntax highlighting**: `classHighlighter` from `@lezer/highlight` (CSS class–based)
- **Markdown**: `tiptap-markdown` for round-trip serialization
- **GitHub API**: `@octokit/rest` v21
- **Extension build**: esbuild (dual bundle: Node extension + browser webview)
- **Web app build**: Vite
- **Extension API**: VS Code WebviewPanel, authentication API
- **Web auth**: GitHub Device Flow (no client secret, client-side only)
- **Hosting**: GitHub Pages (static site, no backend)

## Security (web app)

- **No server, no secrets** — the web app is a static bundle; the GitHub App client ID is public by design
- **Token in sessionStorage** — cleared on tab close; never sent to any server other than api.github.com
- **CSP** — enforce strict Content-Security-Policy in production (script-src, connect-src to api.github.com only)
- **Access control** — GitHub App visibility (private = only your account can authorize) + repo collaborator permissions
- **Supply chain** — pin dependencies, run npm audit, enable Dependabot
- **Custom domain recommended** — isolates origin from other github.io repos sharing the same subdomain

## Development

### VS Code extension
```bash
npm run build          # Build extension + webview
npm run watch          # Watch mode
npm run package        # Package as .vsix
```

### Web app
```bash
cp .env.example .env   # Set VITE_GITHUB_CLIENT_ID
npm run dev:web        # Vite dev server (localhost:5173)
npm run build:web      # Production build → dist-web/
npm run preview:web    # Preview production build
```

### Deployment
- Push to `main` triggers `.github/workflows/deploy-web.yml`
- Set `GITHUB_CLIENT_ID` as a repository variable (Settings → Variables → Actions)
- Enable GitHub Pages (Settings → Pages → Source: GitHub Actions)

## What's NOT here (yet)

- Real-time collaboration (would need Yjs + a WebSocket server)
- Copy/paste as markdown (clipboard handler for `text/plain` as markdown)
- Mermaid diagram rendering in the WYSIWYG
- Image upload (drag-and-drop to GitHub)
- Conflict resolution UI (currently shows an error on 409)
