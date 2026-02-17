# Graft

A rich editor for markdown files that live in GitHub. Inline comments on text ranges, change suggestions — no server, no database, just GitHub.

The comments don't render great here.

![Screenshot 2026-02-17 at 12 50 57](https://github.com/user-attachments/assets/e4aa35c1-61ac-4e42-b360-76a75f0621f4)Built for teams that already collaborate in a repo. Everyone who can push a branch can edit and comment.

> **Heads up:** This is a vibe-coded project. It works, but it hasn't been battle-tested. Use with caution — especially with repos you care about.

## The problem

ADRs, RFCs, docs, blog posts — these belong in a repo, but they often start life in a shared doc because collaboration is easiest there. Then someone copies the final version into markdown, and the drafting history stays behind in a document nobody opens again.

Graft lets you skip the round-trip. Write and review markdown directly in GitHub, with the commenting and suggestion features you'd expect from a collaborative editor.

## What Graft does

Open a GitHub file URL or PR. You get a WYSIWYG editor (Tiptap). Select text to comment or suggest changes. Save commits directly to the branch. The file stays as markdown in your repo the whole time.

Works as a **VS Code extension** or a **static web app** on GitHub Pages.

## The interesting bits

**Comments live on an orphan branch.** `graft-comments` holds JSON files, keyed by branch and file path. No extra infrastructure, no noise in your content branches, full Git history on comments.

**Text anchoring instead of line numbers.** Each comment stores the highlighted text plus \~50 chars of surrounding context. When the document changes, anchors re-resolve: exact match first, then fuzzy prefix/suffix matching, then orphaned. Comments don't break when someone adds a paragraph above yours.

**Default branch is read-only.** You can't accidentally edit `main`. The editor prompts you to create a feature branch, then switches to it.

**No backend at all.** The VS Code extension talks to GitHub from Node. The web app talks to GitHub from the browser. Both are fully client-side.

## Running it

VS Code extension:

```
npm install && npm run build
# F5 → "Graft: Open Document" → paste a GitHub URL
```

Web app:

```
cp .env.example .env  # set VITE_GITHUB_CLIENT_ID
npm run dev:web
```