import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { parseGitHubUrl } from "../shared/url";
import { validateBranchName } from "../shared/validation";
import {
  CommentMark,
  CommentController,
  handleFormatAction,
  sidebarHtml,
  esc,
} from "../shared/editor";
import { WebGitHubApi } from "./api";
import {
  getToken,
  clearToken,
  validateToken,
  requestDeviceCode,
  pollForToken,
} from "./auth";

import "./styles.css";

// ── State ────────────────────────────────────────────────────────────

let api: WebGitHubApi | null = null;
let currentUser = "You";
let fileSha = "";
let commentsSha: string | undefined;
let readOnly = false;
let docContext: {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  contentRef?: string;
} | null = null;
let editor: Editor;
let ctrl: CommentController;
let sourceVisible = false;
let syncingFromSource = false;
let syncingFromEditor = false;

const appEl = document.getElementById("app")!;

// ── App Init ─────────────────────────────────────────────────────────

async function boot() {
  const valid = await validateToken();
  if (valid) {
    api = new WebGitHubApi(getToken()!);
    try {
      const user = await api.getCurrentUser();
      currentUser = user.login;
    } catch {
      clearToken();
      api = null;
    }
  }

  if (!api) {
    showLoginScreen();
  } else {
    showOpenScreen();
  }
}

// ── Login Screen ─────────────────────────────────────────────────────

function showLoginScreen() {
  appEl.innerHTML = `
    <div class="screen">
      <div class="screen-card">
        <h1>Graft</h1>
        <p class="screen-desc">Collaborative markdown editor backed by GitHub</p>
        <button id="login-btn" class="primary-btn">Sign in with GitHub</button>
        <div id="device-flow" class="hidden">
          <p>Go to <a id="verify-link" href="#" target="_blank" rel="noopener"></a> and enter:</p>
          <div id="user-code" class="user-code"></div>
          <p id="poll-status" class="poll-status">Waiting for authorization…</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById("login-btn")!.addEventListener("click", startLogin);
}

async function startLogin() {
  const btn = document.getElementById("login-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Starting…";

  try {
    const deviceCode = await requestDeviceCode();
    const flowEl = document.getElementById("device-flow")!;
    flowEl.classList.remove("hidden");

    const link = document.getElementById("verify-link") as HTMLAnchorElement;
    link.href = deviceCode.verification_uri;
    link.textContent = deviceCode.verification_uri.replace("https://", "");

    document.getElementById("user-code")!.textContent = deviceCode.user_code;
    btn.textContent = "Waiting…";

    try {
      await navigator.clipboard.writeText(deviceCode.user_code);
      document.getElementById("poll-status")!.textContent =
        "Code copied to clipboard. Waiting for authorization…";
    } catch {
      // Clipboard API might not be available
    }

    const token = await pollForToken(
      deviceCode.device_code,
      deviceCode.interval,
      deviceCode.expires_in,
    );

    api = new WebGitHubApi(token);
    const user = await api.getCurrentUser();
    currentUser = user.login;
    showOpenScreen();
  } catch (err: any) {
    btn.disabled = false;
    btn.textContent = "Sign in with GitHub";
    document.getElementById("poll-status")!.textContent =
      `Error: ${err.message}`;
  }
}

// ── Open Screen ──────────────────────────────────────────────────────

function showOpenScreen() {
  appEl.innerHTML = `
    <div class="screen">
      <div class="screen-card">
        <div class="screen-header">
          <h1>Graft</h1>
          <div class="screen-user">
            <span>${esc(currentUser)}</span>
            <button id="logout-btn" class="text-btn">Sign out</button>
          </div>
        </div>
        <p class="screen-desc">Open a markdown file from GitHub to start editing</p>
        <div class="url-input-group">
          <input
            id="url-input"
            type="text"
            placeholder="https://github.com/owner/repo/blob/main/docs/file.md"
            spellcheck="false"
          />
          <button id="open-btn" class="primary-btn">Open</button>
        </div>
        <p class="input-hint">Paste a GitHub file URL or PR URL</p>
        <div id="open-error" class="error hidden"></div>
        <div id="pr-file-picker" class="hidden"></div>
      </div>
    </div>
  `;

  document.getElementById("logout-btn")!.addEventListener("click", () => {
    clearToken();
    api = null;
    showLoginScreen();
  });

  const input = document.getElementById("url-input") as HTMLInputElement;
  const openBtn = document.getElementById("open-btn")!;

  openBtn.addEventListener("click", () => openUrl(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openUrl(input.value);
  });

  // Check URL hash for deep linking
  if (window.location.hash.length > 1) {
    const url = decodeURIComponent(window.location.hash.slice(1));
    input.value = url;
    openUrl(url);
  }
}

async function openUrl(url: string) {
  const errorEl = document.getElementById("open-error")!;
  errorEl.classList.add("hidden");

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    errorEl.textContent = "Enter a valid GitHub file or PR URL";
    errorEl.classList.remove("hidden");
    return;
  }

  const openBtn = document.getElementById("open-btn") as HTMLButtonElement;
  openBtn.disabled = true;
  openBtn.textContent = "Loading…";

  try {
    if (parsed.type === "file") {
      const { branch, path: filePath } = await api!.resolveRefAndPath(
        parsed.owner,
        parsed.repo,
        parsed.refAndPath,
      );
      const defaultBranch = await api!.getDefaultBranch(
        parsed.owner,
        parsed.repo,
      );
      readOnly = branch === defaultBranch;
      docContext = {
        owner: parsed.owner,
        repo: parsed.repo,
        branch,
        filePath,
      };
      await loadEditor();
    } else {
      // PR — list .md files and pick one
      const prDetails = await api!.getPR(
        parsed.owner,
        parsed.repo,
        parsed.number,
      );
      const files = await api!.getPRFiles(
        parsed.owner,
        parsed.repo,
        parsed.number,
      );
      const mdFiles = files.filter((f) => f.filename.endsWith(".md"));

      if (mdFiles.length === 0) {
        errorEl.textContent = "No markdown files found in this PR.";
        errorEl.classList.remove("hidden");
        openBtn.disabled = false;
        openBtn.textContent = "Open";
        return;
      }

      const isMerged = prDetails.merged;
      readOnly = isMerged;
      const contentRef = isMerged
        ? prDetails.merge_commit_sha ?? prDetails.base.sha
        : undefined;

      if (mdFiles.length === 1) {
        docContext = {
          owner: parsed.owner,
          repo: parsed.repo,
          branch: prDetails.head.ref,
          filePath: mdFiles[0].filename,
          contentRef,
        };
        await loadEditor();
      } else {
        showPRFilePicker(
          parsed.owner,
          parsed.repo,
          prDetails.head.ref,
          mdFiles,
          contentRef,
        );
      }
    }
  } catch (err: any) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    openBtn.disabled = false;
    openBtn.textContent = "Open";
  }
}

function showPRFilePicker(
  owner: string,
  repo: string,
  branch: string,
  files: { filename: string; status: string }[],
  contentRef?: string,
) {
  const picker = document.getElementById("pr-file-picker")!;
  picker.classList.remove("hidden");
  picker.innerHTML = `
    <p class="picker-label">Select a markdown file:</p>
    ${files
      .map(
        (f) =>
          `<button class="file-pick-btn" data-file="${esc(f.filename)}">
            ${esc(f.filename)} <span class="file-status">${esc(f.status)}</span>
          </button>`,
      )
      .join("")}
  `;

  picker.querySelectorAll(".file-pick-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const filePath = (btn as HTMLElement).dataset.file!;
      docContext = { owner, repo, branch, filePath, contentRef };
      await loadEditor();
    });
  });
}

// ── Editor Screen ────────────────────────────────────────────────────

async function loadEditor() {
  if (!api || !docContext) return;

  const { owner, repo, branch, filePath, contentRef } = docContext;
  const ref = contentRef ?? branch;

  window.location.hash = encodeURIComponent(
    `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`,
  );

  const [file, commentsData] = await Promise.all([
    api.getFileContent(owner, repo, filePath, ref),
    api.getCommentsFile(owner, repo, branch, filePath),
  ]);

  fileSha = file.sha;
  commentsSha = commentsData?.sha;

  showEditorUI(file.content, filePath);
  ctrl.comments = commentsData?.comments ?? [];
  ctrl.applyCommentMarks();
  ctrl.renderSidebar();
}

function showEditorUI(markdown: string, fileName: string) {
  const editControls = readOnly
    ? ""
    : `
      <div class="toolbar-sep"></div>
      <div class="toolbar-group">
        <button data-action="bold" title="Bold (⌘B)"><strong>B</strong></button>
        <button data-action="italic" title="Italic (⌘I)"><em>I</em></button>
        <button data-action="strike" title="Strikethrough"><s>S</s></button>
        <button data-action="code" title="Inline Code">&lt;/&gt;</button>
      </div>
      <div class="toolbar-sep"></div>
      <div class="toolbar-group">
        <button data-action="heading1" title="Heading 1">H1</button>
        <button data-action="heading2" title="Heading 2">H2</button>
        <button data-action="heading3" title="Heading 3">H3</button>
      </div>
      <div class="toolbar-sep"></div>
      <div class="toolbar-group">
        <button data-action="bulletList" title="Bullet List">•</button>
        <button data-action="orderedList" title="Numbered List">1.</button>
        <button data-action="blockquote" title="Quote">❝</button>
        <button data-action="codeBlock" title="Code Block">{}</button>
        <button data-action="hr" title="Horizontal Rule">―</button>
      </div>
      <div class="toolbar-sep"></div>
      <div class="toolbar-group">
        <button data-action="comment" title="Add Comment" class="toolbar-action">💬</button>
        <button data-action="suggest" title="Suggest Change" class="toolbar-action">✏️</button>
      </div>`;

  const isDefaultBranch = readOnly && !docContext?.contentRef;
  const readOnlyReason = docContext?.contentRef
    ? "merged PR"
    : "default branch";
  const saveControls = readOnly
    ? `<span class="readonly-badge">Read-only (${readOnlyReason})</span>
       ${isDefaultBranch ? `<button data-action="create-branch" class="toolbar-save">Create branch to edit</button>` : ""}`
    : `<button data-action="toggle-source" title="Toggle markdown source" class="toolbar-toggle-source">MD</button>
       <button data-action="save" title="Save (⌘S)" class="toolbar-save">Save</button>`;

  appEl.innerHTML = `
    <div id="toolbar">
      <div class="toolbar-group">
        <button class="back-btn" data-action="back" title="Back to file picker">←</button>
        <span class="toolbar-filename">${esc(fileName)}</span>
      </div>
      ${editControls}
      <div class="toolbar-group toolbar-right">
        <span class="toolbar-user">${esc(currentUser)}</span>
        ${saveControls}
      </div>
    </div>
    <div id="main">
      <div id="editor-container"></div>
      <div id="source-gutter" class="source-gutter hidden"></div>
      <textarea id="source-pane" class="source-pane hidden" spellcheck="false"></textarea>
      <div id="sidebar">${sidebarHtml()}</div>
    </div>
  `;

  editor = new Editor({
    element: document.getElementById("editor-container")!,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      CommentMark,
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
      }),
    ],
    content: markdown,
    editable: !readOnly,
    autofocus: !readOnly,
  });

  ctrl = new CommentController(editor);
  ctrl.currentUser = currentUser;
  ctrl.readOnly = readOnly;
  ctrl.bindMarkClickHandler();
  ctrl.bindFormHandlers();

  document.getElementById("toolbar")!.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(
      "[data-action]",
    ) as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action!;
    if (handleFormatAction(editor, action)) return;
    switch (action) {
      case "back":
        editor?.destroy();
        showOpenScreen();
        break;
      case "create-branch":
        promptCreateBranch();
        break;
      case "comment":
        ctrl.startComment();
        break;
      case "suggest":
        ctrl.startSuggestion();
        break;
      case "toggle-source":
        toggleSource();
        break;
      case "save":
        save();
        break;
    }
  });
  // Sync WYSIWYG → source pane
  editor.on("update", () => {
    if (syncingFromSource) return;
    const sourcePaneEl = document.getElementById("source-pane") as HTMLTextAreaElement | null;
    if (!sourcePaneEl || sourcePaneEl.classList.contains("hidden")) return;
    syncingFromEditor = true;
    sourcePaneEl.value = stripCommentMarks((editor.storage as any).markdown.getMarkdown());
    syncingFromEditor = false;
    updateLineNumbers();
  });
}

function stripCommentMarks(md: string): string {
  return md.replace(/<mark[^>]*data-comment-id[^>]*>/g, "").replace(/<\/mark>/g, "");
}

function updateLineNumbers() {
  const gutter = document.getElementById("source-gutter");
  const sp = document.getElementById("source-pane") as HTMLTextAreaElement | null;
  if (!gutter || !sp) return;
  const lines = sp.value.split("\n").length;
  gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join("");
}

// ── Source Pane ───────────────────────────────────────────────────────

let sourceDebounce: ReturnType<typeof setTimeout> | null = null;

function toggleSource() {
  const sourcePaneEl = document.getElementById("source-pane") as HTMLTextAreaElement;
  const gutter = document.getElementById("source-gutter")!;
  const btn = document.querySelector('[data-action="toggle-source"]') as HTMLElement;
  sourceVisible = !sourceVisible;

  if (sourceVisible) {
    sourcePaneEl.value = stripCommentMarks((editor.storage as any).markdown.getMarkdown());
    sourcePaneEl.classList.remove("hidden");
    gutter.classList.remove("hidden");
    btn.classList.add("active");
    updateLineNumbers();

    sourcePaneEl.addEventListener("input", onSourceInput);
    sourcePaneEl.addEventListener("scroll", syncGutterScroll);
  } else {
    sourcePaneEl.classList.add("hidden");
    gutter.classList.add("hidden");
    btn.classList.remove("active");
    sourcePaneEl.removeEventListener("input", onSourceInput);
    sourcePaneEl.removeEventListener("scroll", syncGutterScroll);
  }
}

function syncGutterScroll() {
  const sp = document.getElementById("source-pane") as HTMLTextAreaElement;
  const gutter = document.getElementById("source-gutter");
  if (gutter) gutter.scrollTop = sp.scrollTop;
}

function onSourceInput() {
  if (syncingFromEditor) return;
  if (sourceDebounce) clearTimeout(sourceDebounce);
  sourceDebounce = setTimeout(() => {
    const sourcePaneEl = document.getElementById("source-pane") as HTMLTextAreaElement;
    syncingFromSource = true;
    editor.commands.setContent(sourcePaneEl.value);
    ctrl.applyCommentMarks();
    syncingFromSource = false;
    updateLineNumbers();
  }, 300);
}

async function promptCreateBranch() {
  if (!api || !docContext) return;

  const defaultName = `graft/${docContext.filePath.replace(/\//g, "-").replace(/\.md$/, "")}`;
  const branchName = prompt("New branch name:", defaultName);
  if (!branchName) return;

  const error = validateBranchName(branchName);
  if (error) {
    alert(error);
    return;
  }

  const btn = document.querySelector(
    '[data-action="create-branch"]',
  ) as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Creating…";

  try {
    await api.createBranch(
      docContext.owner,
      docContext.repo,
      branchName,
      docContext.branch,
    );

    docContext.branch = branchName;
    readOnly = false;

    window.location.hash = encodeURIComponent(
      `https://github.com/${docContext.owner}/${docContext.repo}/blob/${branchName}/${docContext.filePath}`,
    );

    const file = await api.getFileContent(
      docContext.owner,
      docContext.repo,
      docContext.filePath,
      branchName,
    );
    fileSha = file.sha;
    commentsSha = undefined;

    const markdown = ctrl.getCleanMarkdown();
    editor.destroy();
    showEditorUI(markdown, docContext.filePath);
  } catch (err: any) {
    btn.disabled = false;
    btn.textContent = "Create branch to edit";
    alert(`Failed to create branch: ${err.message}`);
  }
}

// ── Save ─────────────────────────────────────────────────────────────

async function save() {
  if (!ctrl || ctrl.readOnly || !api || !docContext) return;

  const btn = document.querySelector('[data-action="save"]') as HTMLElement;
  btn.textContent = "Saving…";

  ctrl.updateAnchors();
  const markdown = ctrl.getCleanMarkdown();
  const { owner, repo, branch, filePath } = docContext;

  try {
    const result = await api.commitFile(
      owner,
      repo,
      filePath,
      markdown,
      fileSha,
      `Update ${filePath}`,
      branch,
    );
    fileSha = result.sha;

    if (ctrl.comments.length > 0 || commentsSha) {
      const newSha = await api.saveCommentsFile(
        owner,
        repo,
        branch,
        filePath,
        ctrl.comments,
        commentsSha,
      );
      commentsSha = newSha;
    }

    btn.textContent = "Saved ✓";
    setTimeout(() => (btn.textContent = "Save"), 2000);
  } catch (err: any) {
    btn.textContent = "Error!";
    setTimeout(() => (btn.textContent = "Save"), 2000);
    console.error("Save failed:", err);

    if (err.status === 409) {
      alert(
        "Conflict: someone else edited this file. Reload and try again.",
      );
    }
  }
}

// ── Keyboard Shortcut ────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    save();
  }
});

// ── Boot ─────────────────────────────────────────────────────────────

boot();
