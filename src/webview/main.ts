import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import {
  BlockImage,
  CommentMark,
  CommentController,
  handleFormatAction,
  sidebarHtml,
} from "../shared/editor";
import { createSourceEditor, type SourceEditor } from "../shared/source-editor";

import "./styles.css";

// ── VS Code API ──────────────────────────────────────────────────────

declare function acquireVsCodeApi(): {
  postMessage(msg: any): void;
  getState(): any;
  setState(state: any): void;
};
const vscode = acquireVsCodeApi();

// ── DOM Setup ────────────────────────────────────────────────────────

document.getElementById("app")!.innerHTML = `
  <div id="toolbar">
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
    <div class="toolbar-group toolbar-right">
      <button data-action="toggle-source" title="Toggle markdown source" class="toolbar-toggle-source">MD</button>
      <button data-action="toggle-vim" title="Toggle vim mode" class="toolbar-toggle-source hidden" id="vim-toggle">VIM</button>
      <button data-action="toggle-scroll-sync" title="Toggle scroll sync" class="toolbar-toggle-source hidden active" id="sync-toggle">SYNC</button>
      <button data-action="toggle-sidebar" title="Toggle comments" class="toolbar-toggle-source active" id="sidebar-toggle">💬</button>
      <button data-action="save" title="Save (⌘S)" class="toolbar-save">Save</button>
    </div>
  </div>
  <div id="main">
    <div id="editor-container"></div>
    <div id="source-pane" class="source-pane hidden"></div>
    <div id="sidebar">
      ${sidebarHtml()}
    </div>
  </div>
`;

// ── Editor Setup ─────────────────────────────────────────────────────

const editor = new Editor({
  element: document.getElementById("editor-container")!,
  extensions: [
    StarterKit,
    Link.configure({ openOnClick: false }),
    BlockImage,
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
  content: "",
  autofocus: true,
});

const ctrl = new CommentController(editor);
ctrl.bindMarkClickHandler();
ctrl.bindFormHandlers();

// ── Source Pane ──────────────────────────────────────────────────────

let sourceVisible = false;
let syncingFromSource = false;
let syncingFromEditor = false;
let sourceEditor: SourceEditor | null = null;
let scrollSyncEnabled = true;
let sidebarVisible = true;
let scrollSyncCleanup: (() => void) | null = null;

editor.on("update", () => {
  if (syncingFromSource) return;
  if (!sourceEditor || !sourceVisible) return;
  syncingFromEditor = true;
  sourceEditor.setContent(stripCommentMarks((editor.storage as any).markdown.getMarkdown()));
  syncingFromEditor = false;
});

function stripCommentMarks(md: string): string {
  return md.replace(/<mark[^>]*data-comment-id[^>]*>/g, "").replace(/<\/mark>/g, "");
}

function toggleVim() {
  if (!sourceEditor) return;
  const active = sourceEditor.toggleVim();
  vscode.setState({ ...vscode.getState(), vimEnabled: active });
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
    if (vscode.getState()?.vimEnabled && !sourceEditor.vimEnabled) {
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

// ── Toolbar Actions ──────────────────────────────────────────────────

document.getElementById("toolbar")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(
    "[data-action]",
  ) as HTMLElement | null;
  if (!btn) return;
  const action = btn.dataset.action!;
  if (handleFormatAction(editor, action)) return;
  switch (action) {
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
    case "save":
      save();
      break;
  }
});

// ── Keyboard Shortcuts ───────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    save();
  }
});

// ── Save ─────────────────────────────────────────────────────────────

function save() {
  if (ctrl.readOnly) return;
  ctrl.updateAnchors();
  const markdown = ctrl.getCleanMarkdown();
  vscode.postMessage({ type: "save", markdown, comments: ctrl.comments });
}

// ── Messages from Extension Host ─────────────────────────────────────

window.addEventListener("message", (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      ctrl.currentUser = msg.user || "You";
      ctrl.readOnly = msg.readOnly ?? false;
      editor.commands.setContent(msg.markdown);
      editor.setEditable(!ctrl.readOnly);
      ctrl.comments = msg.comments || [];
      ctrl.applyCommentMarks();
      ctrl.renderSidebar();
      if (ctrl.readOnly) {
        document
          .querySelectorAll(
            '#toolbar [data-action="bold"], #toolbar [data-action="italic"], #toolbar [data-action="strike"], #toolbar [data-action="code"], #toolbar [data-action="heading1"], #toolbar [data-action="heading2"], #toolbar [data-action="heading3"], #toolbar [data-action="bulletList"], #toolbar [data-action="orderedList"], #toolbar [data-action="blockquote"], #toolbar [data-action="codeBlock"], #toolbar [data-action="hr"], #toolbar [data-action="comment"], #toolbar [data-action="suggest"], #toolbar [data-action="save"]',
          )
          .forEach((el) => ((el as HTMLElement).style.display = "none"));
        document
          .querySelectorAll("#toolbar .toolbar-sep")
          .forEach((el) => ((el as HTMLElement).style.display = "none"));
      }
      break;

    case "saved": {
      const btn = document.querySelector(
        '[data-action="save"]',
      ) as HTMLElement;
      if (btn) {
        btn.textContent = "Saved ✓";
        setTimeout(() => (btn.textContent = "Save"), 2000);
      }
      break;
    }

    case "saveError": {
      const btn = document.querySelector(
        '[data-action="save"]',
      ) as HTMLElement;
      if (btn) {
        btn.textContent = "Error!";
        setTimeout(() => (btn.textContent = "Save"), 2000);
      }
      break;
    }
  }
});

// ── Init ─────────────────────────────────────────────────────────────

vscode.postMessage({ type: "ready" });
