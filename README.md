# Graft

A rich editor for markdown files that live in GitHub. Inline comments on text ranges, change suggestions — no database, just GitHub.

**[Try the web app →](https://tkjaer.github.io/graft/)**

Sign in with GitHub, then install the [Graft GitHub App](https://github.com/apps/graft-editor) on the repos you want to edit. The app needs Contents read & write access to commit changes and store comments.

The VS Code extension uses your existing GitHub sign-in — no app install needed.

<img width="2356" height="1568" alt="Web app screenshot" src="https://github.com/user-attachments/assets/aafa3a55-fadb-4e78-a42c-5c4f898c8547" />

<img width="2360" height="1432" alt="VSCode app screenshot" src="https://github.com/user-attachments/assets/e03fd1eb-ebc1-4274-a79e-ebe8334b2c18" />

Built for teams that already collaborate in a repo. Everyone who can push a branch can edit and comment.

> **Heads up:** This is a vibe-coded project. It works, but it hasn't been battle-tested. Use with caution — especially with repos you care about.

## The problem

ADRs, RFCs, docs, blog posts — these belong in a repo, but they often start life in a shared doc because collaboration is easiest there. Then someone copies the final version into markdown, and the drafting history stays behind in a document nobody opens again.

Graft lets you skip the round-trip. Write and review markdown directly in GitHub, with the commenting and suggestion features you'd expect from a collaborative editor.

## What Graft does

Open a GitHub file URL or PR. You get a WYSIWYG editor (Tiptap). Select text to comment or suggest changes. Save commits directly to the branch. The file stays as markdown in your repo the whole time.

Works as a **VS Code extension** or a **static web app** on GitHub Pages.

## The interesting bits

**Comments live on an orphan branch.** `graft-comments` holds JSON files, keyed by branch and file path. No extra infrastructure, no noise in your content branches, full Git history on comments.

**Text anchoring instead of line numbers.** Each comment stores the highlighted text plus `~50` chars of surrounding context. When the document changes, anchors re-resolve: exact match first, then fuzzy prefix/suffix matching, then orphaned. Comments don't break when someone adds a paragraph above yours.

**Default branch is read-only.** You can't accidentally edit `main`. The editor prompts you to create a feature branch, then switches to it.

**No database, no heavyweight backend.** The VS Code extension talks to GitHub from Node. The web app talks to GitHub from the browser via a tiny [CORS proxy](worker/) on Cloudflare Workers (needed because GitHub's OAuth endpoints don't support CORS). Everything else is direct.

## Running it

```
npm install && npm run build
# F5 → "Graft: Open Document" → paste a GitHub URL
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for web app and CORS proxy setup.
