import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import {
  CommentMark,
  CommentController,
  handleFormatAction,
  sidebarHtml,
} from "../shared/editor";

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
      <button data-action="save" title="Save (⌘S)" class="toolbar-save">Save</button>
    </div>
  </div>
  <div id="main">
    <div id="editor-container"></div>
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
  content: "",
  autofocus: true,
});

const ctrl = new CommentController(editor);
ctrl.bindMarkClickHandler();
ctrl.bindFormHandlers();

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
