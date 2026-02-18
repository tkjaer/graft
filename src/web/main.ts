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
import { createSourceEditor, type SourceEditor } from "../shared/source-editor";
import {
  initTheme,
  themePickerHtml,
  bindThemePicker,
} from "../shared/themes";
import { WebGitHubApi } from "./api";
import {
  getToken,
  clearToken,
  validateToken,
  requestDeviceCode,
  pollForToken,
} from "./auth";
import {
  createCollaborationProvider,
  userColor,
  getConnectedUsers,
  type CollaborationProvider,
} from "../shared/collaboration";
import { ImageUpload } from "../shared/image-upload";
import {
  SuggestingMode,
  setSuggestingUser,
  isSuggestingModeActive,
} from "../shared/suggesting";
import { SlashCommands } from "../shared/slash-commands";
import {
  fetchFileHistory,
  getLastViewed,
  setLastViewed,
  countNewCommits,
  renderHistoryPanel,
  simpleDiff,
  type CommitEntry,
} from "../shared/history";

import "./styles.css";

// Sync server URL — set via VITE_SYNC_SERVER_URL or fallback to localhost
const SYNC_SERVER_URL = (import.meta as any).env?.VITE_SYNC_SERVER_URL || "ws://localhost:4000";

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
let sourceEditor: SourceEditor | null = null;
let scrollSyncEnabled = true;
let sidebarVisible = true;
let scrollSyncCleanup: (() => void) | null = null;
let collabProvider: CollaborationProvider | null = null;
let connectionStatus: "connecting" | "connected" | "disconnected" = "disconnected";
let historyCommits: CommitEntry[] = [];
let historyPanelVisible = false;

const appEl = document.getElementById("app")!;

// ── App Init ─────────────────────────────────────────────────────────

async function boot() {
  initTheme();

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
      <div class="screen-theme">${themePickerHtml()}</div>
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

  bindThemePicker();
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
      <div class="screen-theme">${themePickerHtml()}</div>
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

  bindThemePicker();

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

  // Set up collaboration if sync server is available and not read-only
  if (!readOnly) {
    setupCollaboration();
  }
}

function setupCollaboration() {
  if (!docContext) return;
  const token = getToken();
  if (!token) return;

  const { owner, repo, branch, filePath } = docContext;
  const roomId = `${owner}/${repo}/${branch}/${filePath}`;

  // Clean up previous provider
  collabProvider?.destroy();

  try {
    collabProvider = createCollaborationProvider({
      serverUrl: SYNC_SERVER_URL,
      roomId,
      token,
      user: {
        name: currentUser,
        color: userColor(currentUser),
      },
      onStatusChange: (status) => {
        connectionStatus = status;
        updateConnectionBadge();
        if (status === "connected") {
          updatePresenceIndicator();
        }
      },
      onExternalMerge: (message) => {
        showToast(message);
      },
      onExternalConflict: (_theirs, _base) => {
        showToast("External change conflicts with your edits — manual resolution needed");
      },
    });

    // Update presence when awareness changes
    collabProvider.awareness.on("change", () => {
      updatePresenceIndicator();
    });

    // Bind comments to Y.Map for collaborative sync
    const commentsMap = collabProvider.doc.getMap("comments");
    ctrl.bindYMap(commentsMap);
  } catch (err) {
    console.warn("[graft] Could not connect to sync server, continuing in async mode", err);
    connectionStatus = "disconnected";
    updateConnectionBadge();
  }
}

function updateConnectionBadge() {
  let badge = document.getElementById("connection-badge");
  if (!badge) {
    const toolbar = document.querySelector(".toolbar-group");
    if (!toolbar) return;
    badge = document.createElement("span");
    badge.id = "connection-badge";
    badge.className = "connection-badge";
    toolbar.appendChild(badge);
  }

  switch (connectionStatus) {
    case "connected":
      badge.textContent = "";
      badge.className = "connection-badge connected";
      badge.title = "Real-time sync active";
      break;
    case "connecting":
      badge.textContent = "⟳";
      badge.className = "connection-badge connecting";
      badge.title = "Connecting to sync server…";
      break;
    case "disconnected":
      badge.textContent = "Offline";
      badge.className = "connection-badge disconnected";
      badge.title = "Sync server unavailable — saving directly to GitHub";
      break;
  }
}

function updatePresenceIndicator() {
  if (!collabProvider) return;

  const users = getConnectedUsers(collabProvider.awareness);
  let indicator = document.getElementById("presence-indicator");

  if (!indicator) {
    const toolbar = document.querySelector(".toolbar-right");
    if (!toolbar) return;
    indicator = document.createElement("span");
    indicator.id = "presence-indicator";
    indicator.className = "presence-indicator";
    toolbar.prepend(indicator);
  }

  // Don't count self
  const others = users.filter((u) => u.name !== currentUser);
  if (others.length === 0) {
    indicator.innerHTML = "";
    indicator.title = "";
    return;
  }

  const avatars = others
    .slice(0, 5)
    .map(
      (u) =>
        `<span class="presence-dot" style="background: ${u.color}" title="${esc(u.name)}">${esc(u.name[0].toUpperCase())}</span>`,
    )
    .join("");

  const extra = others.length > 5 ? `<span class="presence-extra">+${others.length - 5}</span>` : "";
  indicator.innerHTML = avatars + extra;
  indicator.title = others.map((u) => u.name).join(", ");
}

function showToast(message: string) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
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
      </div>
      <div class="toolbar-sep"></div>
      <div class="toolbar-group">
        <button data-action="toggle-suggesting" title="Toggle Suggesting Mode" class="toolbar-toggle-source" id="suggesting-toggle">Suggest</button>
      </div>`;

  const isDefaultBranch = readOnly && !docContext?.contentRef;
  const readOnlyReason = docContext?.contentRef
    ? "merged PR"
    : "default branch";
  const saveControls = readOnly
    ? `<span class="readonly-badge">Read-only (${readOnlyReason})</span>
       <button data-action="toggle-sidebar" title="Toggle comments" class="toolbar-toggle-source active" id="sidebar-toggle">💬</button>
       ${themePickerHtml()}
       ${isDefaultBranch ? `<button data-action="create-branch" class="toolbar-save">Create branch to edit</button>` : ""}`
    : `<button data-action="toggle-source" title="Toggle markdown source" class="toolbar-toggle-source">MD</button>
       <button data-action="toggle-vim" title="Toggle vim mode" class="toolbar-toggle-source hidden" id="vim-toggle">VIM</button>
       <button data-action="toggle-scroll-sync" title="Toggle scroll sync" class="toolbar-toggle-source hidden active" id="sync-toggle">SYNC</button>
       <button data-action="toggle-sidebar" title="Toggle comments" class="toolbar-toggle-source active" id="sidebar-toggle">💬</button>
       <button data-action="toggle-history" title="Version history" class="toolbar-toggle-source" id="history-toggle">📋</button>
       ${themePickerHtml()}
       <button data-action="save" title="Save (⌘S)" class="toolbar-save">Save</button>`;

  appEl.innerHTML = `
    <div id="toolbar">
      <div class="toolbar-group">
        <button class="back-btn" data-action="back" title="Back to file picker">←</button>
        <span class="toolbar-filename">${esc(fileName)}</span>
        <span class="toolbar-user">${esc(currentUser)}</span>
      </div>
      ${editControls}
      <div class="toolbar-group toolbar-right">
        ${saveControls}
      </div>
    </div>
    <div id="main">
      <div id="editor-container"></div>
      <div id="source-pane" class="source-pane hidden"></div>
      <div id="sidebar">${sidebarHtml()}</div>
      <div id="history-panel" class="history-panel hidden"></div>
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
      ...(!readOnly && docContext
        ? [
            ImageUpload.configure({
              upload: async (file: File, fileName: string) => {
                const { owner, repo, branch, filePath } = docContext!;
                const docDir = filePath.includes("/")
                  ? filePath.substring(0, filePath.lastIndexOf("/"))
                  : "";
                const assetsDir = docDir ? `${docDir}/assets` : "assets";
                const uploadPath = `${assetsDir}/${fileName}`;

                // Read file as base64
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = "";
                for (let i = 0; i < bytes.length; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);

                await api!.uploadBinaryFile(
                  owner,
                  repo,
                  uploadPath,
                  base64,
                  `Add image ${fileName} via Graft`,
                  branch,
                );
                return `assets/${fileName}`;
              },
              onUploadStart: () => showToast("Uploading image…"),
              onUploadEnd: () => showToast("Image uploaded ✓"),
            }),
            SuggestingMode,
            SlashCommands,
          ]
        : []),
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
  setSuggestingUser(currentUser);
  bindThemePicker();

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
      case "toggle-vim":
        toggleVim();
        break;
      case "toggle-scroll-sync":
        toggleScrollSync();
        break;
      case "toggle-sidebar":
        toggleSidebar();
        break;
      case "toggle-suggesting":
        toggleSuggestingMode();
        break;
      case "toggle-history":
        toggleHistoryPanel();
        break;
      case "save":
        save();
        break;
    }
  });
  // Sync WYSIWYG → source pane
  editor.on("update", () => {
    if (syncingFromSource) return;
    if (!sourceEditor || !sourceVisible) return;
    syncingFromEditor = true;
    sourceEditor.setContent(stripCommentMarks((editor.storage as any).markdown.getMarkdown()));
    syncingFromEditor = false;
  });
}

function stripCommentMarks(md: string): string {
  return md.replace(/<mark[^>]*data-comment-id[^>]*>/g, "").replace(/<\/mark>/g, "");
}

// ── Source Pane ───────────────────────────────────────────────────────

function toggleVim() {
  if (!sourceEditor) return;
  const active = sourceEditor.toggleVim();
  localStorage.setItem("graft-vim", active ? "1" : "0");
  const btn = document.getElementById("vim-toggle");
  if (btn) btn.classList.toggle("active", active);
}

function toggleScrollSync() {
  scrollSyncEnabled = !scrollSyncEnabled;
  const btn = document.getElementById("sync-toggle");
  if (btn) btn.classList.toggle("active", scrollSyncEnabled);
}

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  const sidebar = document.getElementById("sidebar");
  const btn = document.getElementById("sidebar-toggle");
  if (sidebar) sidebar.classList.toggle("hidden", !sidebarVisible);
  if (btn) btn.classList.toggle("active", sidebarVisible);
}

function toggleSuggestingMode() {
  editor.commands.toggleSuggestingMode();
  const btn = document.getElementById("suggesting-toggle");
  if (btn) {
    const active = isSuggestingModeActive();
    btn.classList.toggle("active", active);
    btn.title = active ? "Switch to Editing mode" : "Switch to Suggesting mode";
  }
}

async function toggleHistoryPanel() {
  historyPanelVisible = !historyPanelVisible;
  const panel = document.getElementById("history-panel");
  const btn = document.getElementById("history-toggle");
  if (!panel) return;

  if (historyPanelVisible) {
    panel.classList.remove("hidden");
    btn?.classList.add("active");
    panel.innerHTML = '<div class="history-loading">Loading history…</div>';

    if (docContext && api) {
      try {
        historyCommits = await fetchFileHistory(
          api,
          docContext.owner,
          docContext.repo,
          docContext.branch,
          docContext.filePath,
        );
        const lastViewed = getLastViewed(
          docContext.owner,
          docContext.repo,
          docContext.branch,
          docContext.filePath,
        );
        const newCount = countNewCommits(historyCommits, lastViewed);
        panel.innerHTML = renderHistoryPanel(historyCommits, newCount);

        // Mark as viewed
        if (historyCommits.length > 0) {
          setLastViewed(
            docContext.owner,
            docContext.repo,
            docContext.branch,
            docContext.filePath,
            historyCommits[0].sha,
          );
        }

        // Bind click handlers
        panel.querySelectorAll("[data-action='view-version']").forEach((el) => {
          el.addEventListener("click", async () => {
            const sha = (el as HTMLElement).dataset.sha;
            if (!sha || !api || !docContext) return;
            try {
              const file = await api.getFileContent(
                docContext.owner,
                docContext.repo,
                docContext.filePath,
                sha,
              );
              // Show in a modal or replace editor content temporarily
              const currentMd = ctrl.getCleanMarkdown();
              const diffHtml = simpleDiff(file.content, currentMd);
              showDiffModal(sha.substring(0, 7), diffHtml, file.content);
            } catch (err: any) {
              showToast(`Error loading version: ${err.message}`);
            }
          });
        });
      } catch (err: any) {
        panel.innerHTML = `<div class="history-empty">Error: ${err.message}</div>`;
      }
    }
  } else {
    panel.classList.add("hidden");
    btn?.classList.remove("active");
  }
}

function showDiffModal(sha: string, diffHtml: string, oldContent: string) {
  const existing = document.getElementById("diff-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "diff-modal";
  modal.className = "diff-modal";
  modal.innerHTML = `
    <div class="diff-modal-backdrop"></div>
    <div class="diff-modal-content">
      <div class="diff-modal-header">
        <h3>Changes since ${sha}</h3>
        <div class="diff-modal-actions">
          <button id="diff-restore-btn" class="toolbar-save">Restore this version</button>
          <button id="diff-close-btn" class="toolbar-toggle-source">Close</button>
        </div>
      </div>
      <div class="diff-modal-body">
        <pre class="diff-output">${diffHtml}</pre>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("diff-close-btn")!.addEventListener("click", () => {
    modal.remove();
  });
  document.getElementById("diff-restore-btn")!.addEventListener("click", () => {
    editor.commands.setContent(oldContent);
    modal.remove();
    showToast("Restored to version " + sha);
  });
  modal.querySelector(".diff-modal-backdrop")!.addEventListener("click", () => {
    modal.remove();
  });
}

function setupScrollSync() {
  cleanupScrollSync();
  const editorEl = document.getElementById("editor-container");
  if (!editorEl || !sourceEditor) return;

  let scrollSource: "editor" | "source" | null = null;
  let guardTimer = 0;
  const cmScroller = sourceEditor.view.scrollDOM;

  const guard = (source: "editor" | "source") => {
    scrollSource = source;
    clearTimeout(guardTimer);
    guardTimer = window.setTimeout(() => { scrollSource = null; }, 50);
  };

  const onEditorScroll = () => {
    if (!scrollSyncEnabled || scrollSource === "source") return;
    guard("editor");
    const max = editorEl.scrollHeight - editorEl.clientHeight;
    if (max <= 0) return;
    const ratio = editorEl.scrollTop / max;
    cmScroller.scrollTop = Math.round(ratio * (cmScroller.scrollHeight - cmScroller.clientHeight));
  };

  const onSourceScroll = () => {
    if (!scrollSyncEnabled || scrollSource === "editor") return;
    guard("source");
    const max = cmScroller.scrollHeight - cmScroller.clientHeight;
    if (max <= 0) return;
    const ratio = cmScroller.scrollTop / max;
    editorEl.scrollTop = Math.round(ratio * (editorEl.scrollHeight - editorEl.clientHeight));
  };

  editorEl.addEventListener("scroll", onEditorScroll);
  cmScroller.addEventListener("scroll", onSourceScroll);

  scrollSyncCleanup = () => {
    editorEl.removeEventListener("scroll", onEditorScroll);
    cmScroller.removeEventListener("scroll", onSourceScroll);
    clearTimeout(guardTimer);
  };
}

function cleanupScrollSync() {
  if (scrollSyncCleanup) {
    scrollSyncCleanup();
    scrollSyncCleanup = null;
  }
}

function toggleSource() {
  const pane = document.getElementById("source-pane")!;
  const btn = document.querySelector('[data-action="toggle-source"]') as HTMLElement;
  const vimBtn = document.getElementById("vim-toggle");
  const syncBtn = document.getElementById("sync-toggle");
  sourceVisible = !sourceVisible;

  if (sourceVisible) {
    const md = stripCommentMarks((editor.storage as any).markdown.getMarkdown());
    pane.classList.remove("hidden");
    btn.classList.add("active");
    vimBtn?.classList.remove("hidden");
    syncBtn?.classList.remove("hidden");
    let debounce: ReturnType<typeof setTimeout> | null = null;
    sourceEditor = createSourceEditor(pane, md, (content) => {
      if (syncingFromEditor) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        syncingFromSource = true;
        editor.commands.setContent(content);
        ctrl.applyCommentMarks();
        syncingFromSource = false;
      }, 300);
    });
    // Restore vim mode if previously enabled
    if (localStorage.getItem("graft-vim") === "1" && !sourceEditor.vimEnabled) {
      sourceEditor.toggleVim();
      vimBtn?.classList.add("active");
    }
    setupScrollSync();
  } else {
    cleanupScrollSync();
    sourceEditor?.destroy();
    sourceEditor = null;
    pane.innerHTML = "";
    pane.classList.add("hidden");
    btn.classList.remove("active");
    if (vimBtn) {
      vimBtn.classList.add("hidden");
      vimBtn.classList.remove("active");
    }
    if (syncBtn) {
      syncBtn.classList.add("hidden");
    }
  }
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
