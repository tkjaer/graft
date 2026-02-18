# Graft

A collaborative editor for markdown files that live in GitHub. Real-time multi-user editing, inline comments, change suggestions, version history — no database, just GitHub.

**[Try the web app →](https://tkjaer.github.io/graft/)**

Sign in with GitHub, then install the [Graft GitHub App](https://github.com/apps/graft-editor) on the repos you want to edit. The app needs Contents read & write access to commit changes and store comments.

The VS Code extension uses your existing GitHub sign-in — no app install needed.

Web app showing split `WYSIWYG` and markdown editor:

<img width="2788" height="1828" alt="Web app with markdown screenshot" src="https://github.com/user-attachments/assets/4c143fb3-0e76-4425-bbb0-c6037616ba13" />

Web app showing inline comments:

<img width="2356" height="1568" alt="Web app screenshot" src="https://github.com/user-attachments/assets/aafa3a55-fadb-4e78-a42c-5c4f898c8547" />

VSCode app:

<img width="2360" height="1432" alt="VSCode app screenshot" src="https://github.com/user-attachments/assets/e03fd1eb-ebc1-4274-a79e-ebe8334b2c18" />

Built for teams that already collaborate in a repo. Everyone who can push a branch can edit and comment.

> **Heads up:** This is a vibe-coded project. It works, but it hasn't been battle-tested. Use with caution — especially with repos you care about.

## The problem

ADRs, RFCs, docs, blog posts — these belong in a repo, but they often start life in a shared doc because collaboration is easiest there. Then someone copies the final version into markdown, and the drafting history stays behind in a document nobody opens again.

Graft lets you skip the round-trip. Write and review markdown directly in GitHub, with the commenting and suggestion features you'd expect from a collaborative editor.

## What Graft does

Open a GitHub file URL or PR. You get a WYSIWYG editor (Tiptap). Select text to comment or suggest changes. Save commits directly to the branch. The file stays as markdown in your repo the whole time.

Works as a **VS Code extension** or a **static web app** on GitHub Pages.

## Features

- **Real-time collaboration** — multiple users edit the same document simultaneously. Colored cursors show who's where. Presence indicators in the toolbar. Powered by Yjs CRDTs.
- **WYSIWYG + source split view** — toggle a side-by-side markdown source pane (CodeMirror 6) next to the rich editor. Changes sync both ways in real time.
- **Suggesting mode** — toggle between editing and suggesting. In suggesting mode, edits appear as tracked changes (green insertions, red deletions) that can be accepted or rejected individually.
- **Inline comments and suggestions** — select text to leave a comment or propose a replacement. Comments anchor to text ranges, not line numbers.
- **Slash commands** — type `/` to insert headings, lists, code blocks, tables, dividers, and blockquotes from a floating menu.
- **Image upload** — drag-and-drop or paste images directly into the editor. Images are resized client-side if >1MB and committed to an `assets/` folder with content-hashed filenames.
- **Version history** — browse the git log for the current file, view any version, and see a line-by-line diff against the current content. A "new commits" badge shows what changed since you last looked.
- **Optional vim bindings** — enable vim mode in the source pane with one click. Preference is remembered across sessions.
- **Scroll sync** — proportional scroll synchronization between the WYSIWYG and source panes (toggle on/off).
- **Themes** — GitHub Light, GitHub Dark, GitHub Dark Dimmed, Dracula, and Solarized Light. Defaults to system preference. Persisted in localStorage.
- **Read-only mode** — default branch and merged PRs open read-only. Create a branch from the editor to start editing.
- **Offline fallback** — if the sync server is unavailable, the editor works in single-user mode with direct GitHub API saves (same as v1).

## The interesting bits

**Comments live on an orphan branch.** `graft-comments` holds JSON files, keyed by branch and file path. No extra infrastructure, no noise in your content branches, full Git history on comments.

**Text anchoring instead of line numbers.** Each comment stores the highlighted text plus around 50 chars of surrounding context. When the document changes, anchors re-resolve: exact match first, then fuzzy prefix/suffix matching, then orphaned. Comments don't break when someone adds a paragraph above yours.

**Default branch is read-only.** You can't accidentally edit `main`. The editor prompts you to create a feature branch, then switches to it.

**No database, no heavyweight backend.** The VS Code extension talks to GitHub from Node. The web app talks to GitHub from the browser via a tiny [CORS proxy](worker/) on Cloudflare Workers (needed because GitHub's OAuth endpoints don't support CORS). The optional sync server handles real-time collaboration — without it, everything still works in single-user mode.

## Architecture

```
┌─────────────┐                  ┌──────────────────────────┐
│  Browsers   │◄──── wss:// ───►│  Sync server (optional)  │
│             │                  │  y-websocket + GitHub     │
└─────────────┘                  │  persistence hooks        │
                                 └──────────┬───────────────┘
       ┌──────────────┐                     │
       │  VS Code ext │◄── wss:// ──────────┘
       └──────────────┘                     │
                                 ┌──────────▼───────────────┐
                                 │   GitHub API             │
                                 │   content + orphan branch│
                                 └──────────────────────────┘
```

Without the sync server, clients talk directly to the GitHub API (single-user mode). With it, edits sync in real-time via Yjs CRDTs, and the server handles debounced saves to GitHub.

See [docs/v2-design.md](docs/v2-design.md) for the full architecture and technical decisions.

## Running it

### Web app (single-user mode — no sync server)

```
npm install && npm run dev:web
```

### Web app + real-time collaboration

```
# Start sync server + Redis
docker compose up

# In another terminal
npm run dev:web
```

Set `VITE_SYNC_SERVER_URL=ws://localhost:4000` in `.env`.

### VS Code extension

```
npm install && npm run build
# F5 → "Graft: Open Document" → paste a GitHub URL
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for web app and CORS proxy setup.
