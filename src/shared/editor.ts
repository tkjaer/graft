import { Editor, Mark, mergeAttributes } from "@tiptap/core";
import type { DocComment, TextAnchor } from "../types";
import { createAnchorFromText, resolveAnchorInText } from "./anchoring";
import type * as Y from "yjs";

// ── Comment Mark Extension ───────────────────────────────────────────

export const CommentMark = Mark.create({
  name: "comment",

  addAttributes() {
    return {
      commentId: { default: null },
      commentType: { default: "comment" },
    };
  },

  excludes: "",

  parseHTML() {
    return [{ tag: "mark[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const type = HTMLAttributes.commentType || "comment";
    return [
      "mark",
      mergeAttributes(HTMLAttributes, {
        "data-comment-id": HTMLAttributes.commentId,
        "data-comment-type": type,
        class: `comment-mark ${type}`,
      }),
      0,
    ];
  },
});

// ── Comment Controller ───────────────────────────────────────────────

export class CommentController {
  comments: DocComment[] = [];
  currentUser = "You";
  readOnly = false;
  pendingAction: {
    type: "comment" | "suggestion";
    from: number;
    to: number;
  } | null = null;

  /** Optional Y.Map for collaborative comment storage */
  private yComments: Y.Map<any> | null = null;
  private yObserverCleanup: (() => void) | null = null;

  constructor(public editor: Editor) {}

  /**
   * Bind to a Y.Map for collaborative comment sync.
   * Comments in Y.Map are the source of truth — local `comments` array
   * is derived from it. Observe handler re-renders sidebar on remote changes.
   */
  bindYMap(commentsMap: Y.Map<any>): void {
    this.unbindYMap();
    this.yComments = commentsMap;

    // Sync existing Y.Map entries into local array
    this.syncFromYMap();
    this.applyCommentMarks();
    this.renderSidebar();

    // Observe changes from remote users
    const handler = () => {
      this.syncFromYMap();
      this.applyCommentMarks();
      this.renderSidebar();
    };
    commentsMap.observe(handler);
    this.yObserverCleanup = () => commentsMap.unobserve(handler);
  }

  /** Disconnect from Y.Map. */
  unbindYMap(): void {
    this.yObserverCleanup?.();
    this.yObserverCleanup = null;
    this.yComments = null;
  }

  /** Pull comments from Y.Map into local array. */
  private syncFromYMap(): void {
    if (!this.yComments) return;
    const comments: DocComment[] = [];
    this.yComments.forEach((value, key) => {
      if (value && typeof value === "object" && value.id) {
        comments.push(value as DocComment);
      }
    });
    // Sort by creation time for stable ordering
    comments.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    this.comments = comments;
  }

  /** Write a comment to Y.Map (if bound) or local array. */
  private putComment(comment: DocComment): void {
    if (this.yComments) {
      this.yComments.set(comment.id, { ...comment });
    } else {
      const idx = this.comments.findIndex((c) => c.id === comment.id);
      if (idx >= 0) {
        this.comments[idx] = comment;
      } else {
        this.comments.push(comment);
      }
    }
  }

  /** Remove a comment from Y.Map (if bound) or local array. */
  private removeComment(id: string): void {
    if (this.yComments) {
      this.yComments.delete(id);
    } else {
      this.comments = this.comments.filter((c) => c.id !== id);
    }
  }

  /** Get a comment by ID. */
  private getComment(id: string): DocComment | undefined {
    return this.comments.find((c) => c.id === id);
  }

  // ── Comment creation ─────────────────────────────────────────────

  startComment() {
    if (this.readOnly) return;
    const { from, to } = this.editor.state.selection;
    if (from === to) return;

    this.pendingAction = { type: "comment", from, to };
    const text = this.editor.state.doc.textBetween(from, to);
    this.showForm(
      `Comment on: "${truncate(text, 80)}"`,
      "Write a comment…",
      false,
    );
  }

  startSuggestion() {
    if (this.readOnly) return;
    const { from, to } = this.editor.state.selection;
    if (from === to) return;

    this.pendingAction = { type: "suggestion", from, to };
    const text = this.editor.state.doc.textBetween(from, to);
    this.showForm(
      `Suggest change to: "${truncate(text, 80)}"`,
      "Explain your suggestion…",
      true,
    );
    (document.getElementById("suggest-body") as HTMLTextAreaElement).value =
      text;
  }

  private showForm(
    header: string,
    placeholder: string,
    showSuggest: boolean,
  ) {
    const form = document.getElementById("comment-form")!;
    document.getElementById("form-header")!.textContent = header;
    const body = document.getElementById(
      "comment-body",
    ) as HTMLTextAreaElement;
    body.value = "";
    body.placeholder = placeholder;
    document
      .getElementById("suggest-replacement")!
      .classList.toggle("hidden", !showSuggest);
    form.classList.remove("hidden");
    body.focus();
  }

  submitComment() {
    if (!this.pendingAction) return;

    const body = (
      document.getElementById("comment-body") as HTMLTextAreaElement
    ).value.trim();
    if (!body && this.pendingAction.type === "comment") return;

    const { from, to, type } = this.pendingAction;
    const id = generateId();
    const anchorText = this.editor.state.doc.textBetween(from, to);
    const anchor = createAnchorFromText(
      this.editor.state.doc.textContent,
      anchorText,
    );

    const comment: DocComment = {
      id,
      type,
      anchor,
      body,
      author: this.currentUser,
      createdAt: new Date().toISOString(),
      resolved: false,
      replies: [],
    };

    if (type === "suggestion") {
      comment.replacement = (
        document.getElementById("suggest-body") as HTMLTextAreaElement
      ).value;
    }

    const tr = this.editor.state.tr;
    tr.addMark(
      from,
      to,
      this.editor.schema.marks.comment.create({
        commentId: id,
        commentType: type,
      }),
    );
    this.editor.view.dispatch(tr);

    this.putComment(comment);
    if (!this.yComments) {
      // In non-collab mode, render immediately
      this.renderSidebar();
    }

    document.getElementById("comment-form")!.classList.add("hidden");
    this.pendingAction = null;
    this.editor.commands.focus();
  }

  // ── Sidebar rendering ────────────────────────────────────────────

  renderSidebar() {
    const list = document.getElementById("comments-list")!;
    const active = this.comments.filter((c) => !c.resolved);
    const resolved = this.comments.filter((c) => c.resolved);

    let html = active.map((c) => this.commentCardHtml(c)).join("");
    if (resolved.length) {
      html += `<div class="resolved-section"><h4>Resolved (${resolved.length})</h4>${resolved.map((c) => this.commentCardHtml(c)).join("")}</div>`;
    }
    list.innerHTML = html;

    list.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const el = btn as HTMLElement;
        const id = el.dataset.id!;
        switch (el.dataset.action) {
          case "accept":
            this.acceptSuggestion(id);
            break;
          case "resolve":
            this.resolveComment(id);
            break;
          case "unresolve":
            this.unresolveComment(id);
            break;
          case "reply":
            this.toggleReplyForm(id);
            break;
          case "reply-submit":
            this.submitReply(id);
            break;
          case "delete":
            this.deleteComment(id);
            break;
        }
      });
    });

    list.querySelectorAll(".comment-card").forEach((card) => {
      card.addEventListener("click", () => {
        this.scrollToComment(card.getAttribute("data-id")!);
      });
    });
  }

  private commentCardHtml(c: DocComment): string {
    const suggestionHtml =
      c.type === "suggestion"
        ? `
      <div class="suggestion-diff">
        <div class="diff-del">${esc(c.anchor.text)}</div>
        <div class="diff-ins">${esc(c.replacement ?? "")}</div>
      </div>
      ${c.body ? `<div class="comment-body">${esc(c.body)}</div>` : ""}
      ${!c.resolved && !this.readOnly ? `<button data-action="accept" data-id="${esc(c.id)}" class="accept-btn">Accept suggestion</button>` : ""}`
        : `<div class="comment-body">${esc(c.body)}</div>`;

    const repliesHtml = c.replies
      .map(
        (r) => `
      <div class="comment-reply">
        <strong>${esc(r.author)}</strong>
        <span class="comment-time">${timeAgo(r.createdAt)}</span>
        <div>${esc(r.body)}</div>
      </div>`,
      )
      .join("");

    const deleteBtn = this.readOnly
      ? ""
      : `<button data-action="delete" data-id="${esc(c.id)}" class="delete-btn" title="Delete">×</button>`;

    const actionsHtml = this.readOnly
      ? ""
      : `
      <div class="comment-actions">
        <button data-action="reply" data-id="${esc(c.id)}">Reply</button>
        ${c.resolved ? `<button data-action="unresolve" data-id="${esc(c.id)}">Unresolve</button>` : `<button data-action="resolve" data-id="${esc(c.id)}">Resolve</button>`}
      </div>
      <div class="reply-form hidden" id="reply-form-${esc(c.id)}">
        <textarea class="reply-input" rows="2" placeholder="Write a reply…"></textarea>
        <button data-action="reply-submit" data-id="${esc(c.id)}" class="reply-submit-btn">Send</button>
      </div>`;

    const safeType = c.type === "suggestion" ? "suggestion" : "comment";

    return `
      <div class="comment-card ${safeType} ${c.resolved ? "resolved" : ""}" data-id="${esc(c.id)}">
        <div class="comment-header">
          <strong>${esc(c.author)}</strong>
          <span class="comment-time">${timeAgo(c.createdAt)}</span>
          ${deleteBtn}
        </div>
        ${suggestionHtml}
        ${repliesHtml}
        ${actionsHtml}
      </div>`;
  }

  // ── Comment actions ──────────────────────────────────────────────

  resolveComment(id: string) {
    const c = this.getComment(id);
    if (c) {
      const updated = { ...c, resolved: true };
      this.removeCommentMark(id);
      this.putComment(updated);
      if (!this.yComments) this.renderSidebar();
    }
  }

  unresolveComment(id: string) {
    const c = this.getComment(id);
    if (c) {
      const updated = { ...c, resolved: false };
      this.putComment(updated);
      this.reapplyCommentMark(updated);
      if (!this.yComments) this.renderSidebar();
    }
  }

  deleteComment(id: string) {
    this.removeComment(id);
    this.removeCommentMark(id);
    if (!this.yComments) this.renderSidebar();
  }

  acceptSuggestion(id: string) {
    const c = this.getComment(id);
    if (!c || c.type !== "suggestion" || !c.replacement) return;

    const range = this.findCommentMarkRange(id);
    if (range) {
      const tr = this.editor.state.tr;
      tr.removeMark(range.from, range.to, this.editor.schema.marks.comment);
      tr.replaceWith(
        range.from,
        range.to,
        this.editor.schema.text(c.replacement),
      );
      this.editor.view.dispatch(tr);
    }

    const updated = { ...c, resolved: true };
    this.putComment(updated);
    if (!this.yComments) this.renderSidebar();
  }

  private toggleReplyForm(id: string) {
    const form = document.getElementById(`reply-form-${id}`);
    if (form) form.classList.toggle("hidden");
  }

  private submitReply(id: string) {
    const form = document.getElementById(`reply-form-${id}`);
    if (!form) return;
    const textarea = form.querySelector(".reply-input") as HTMLTextAreaElement;
    const body = textarea.value.trim();
    if (!body) return;

    const c = this.getComment(id);
    if (c) {
      const updated = {
        ...c,
        replies: [
          ...c.replies,
          {
            id: generateId(),
            body,
            author: this.currentUser,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      this.putComment(updated);
      if (!this.yComments) this.renderSidebar();
    }
  }

  scrollToComment(id: string) {
    const range = this.findCommentMarkRange(id);
    if (range) {
      this.editor.commands.setTextSelection(range);
      this.editor.commands.scrollIntoView();
    }
  }

  highlightSidebarComment(id: string) {
    const card = document.querySelector(
      `.comment-card[data-id="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("highlight-flash");
      setTimeout(() => card.classList.remove("highlight-flash"), 1500);
    }
  }

  // ── Mark helpers ─────────────────────────────────────────────────

  findCommentMarkRange(
    commentId: string,
  ): { from: number; to: number } | null {
    const markType = this.editor.schema.marks.comment;
    let from: number | null = null;
    let to: number | null = null;

    this.editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const mark = node.marks.find(
        (m) => m.type === markType && m.attrs.commentId === commentId,
      );
      if (mark) {
        if (from === null) from = pos;
        to = pos + node.nodeSize;
      }
    });

    if (from === null || to === null) return null;
    return { from, to };
  }

  removeCommentMark(commentId: string) {
    const markType = this.editor.schema.marks.comment;
    const tr = this.editor.state.tr;
    let changed = false;

    this.editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const mark = node.marks.find(
        (m) => m.type === markType && m.attrs.commentId === commentId,
      );
      if (mark) {
        tr.removeMark(pos, pos + node.nodeSize, mark);
        changed = true;
      }
    });

    if (changed) this.editor.view.dispatch(tr);
  }

  reapplyCommentMark(comment: DocComment) {
    const resolved = this.resolveAnchorInEditor(comment.anchor);
    if (!resolved) return;

    const tr = this.editor.state.tr;
    tr.addMark(
      resolved.from,
      resolved.to,
      this.editor.schema.marks.comment.create({
        commentId: comment.id,
        commentType: comment.type,
      }),
    );
    this.editor.view.dispatch(tr);
  }

  /** Apply comment marks for all unresolved comments. */
  applyCommentMarks() {
    for (const c of this.comments) {
      if (!c.resolved) this.reapplyCommentMark(c);
    }
  }

  private resolveAnchorInEditor(
    anchor: TextAnchor,
  ): { from: number; to: number } | null {
    const doc = this.editor.state.doc;
    const entries: { char: string; pmPos: number }[] = [];
    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        for (let i = 0; i < node.text.length; i++) {
          entries.push({ char: node.text[i], pmPos: pos + i });
        }
      }
    });

    const fullText = entries.map((e) => e.char).join("");
    const result = resolveAnchorInText(fullText, anchor);
    if (!result) return null;

    const fromEntry = entries[result.from];
    const toEntry = entries[result.to - 1];
    if (!fromEntry || !toEntry) return null;

    return { from: fromEntry.pmPos, to: toEntry.pmPos + 1 };
  }

  // ── Serialization ────────────────────────────────────────────────

  /** Get markdown with comment marks stripped so they don't leak into output. */
  getCleanMarkdown(): string {
    const markType = this.editor.schema.marks.comment;
    const tr = this.editor.state.tr;
    let changed = false;
    this.editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type === markType) {
          tr.removeMark(pos, pos + node.nodeSize, mark);
          changed = true;
        }
      }
    });
    if (changed) this.editor.view.dispatch(tr);

    const markdown = (this.editor.storage as any).markdown.getMarkdown();

    if (changed) this.applyCommentMarks();
    return markdown;
  }

  /** Refresh anchors based on current mark positions (call before save). */
  updateAnchors() {
    for (const c of this.comments) {
      if (!c.resolved) {
        const range = this.findCommentMarkRange(c.id);
        if (range) {
          const text = this.editor.state.doc.textBetween(range.from, range.to);
          c.anchor = createAnchorFromText(
            this.editor.state.doc.textContent,
            text,
          );
        }
      }
    }
  }

  // ── Setup helpers ────────────────────────────────────────────────

  /** Bind cancel/submit handlers on the comment form. */
  bindFormHandlers() {
    document.getElementById("form-cancel")!.addEventListener("click", () => {
      document.getElementById("comment-form")!.classList.add("hidden");
      this.pendingAction = null;
      this.editor.commands.focus();
    });
    document
      .getElementById("form-submit")!
      .addEventListener("click", () => this.submitComment());
  }

  /** Bind click handler on editor marks to highlight sidebar comment. */
  bindMarkClickHandler() {
    this.editor.view.dom.addEventListener("click", (e) => {
      const mark = (e.target as HTMLElement).closest(
        "mark[data-comment-id]",
      );
      if (mark) {
        const id = mark.getAttribute("data-comment-id");
        if (id) this.highlightSidebarComment(id);
      }
    });
  }
}

// ── Toolbar Helper ───────────────────────────────────────────────────

/** Dispatch a formatting action on the editor. Returns true if handled. */
export function handleFormatAction(editor: Editor, action: string): boolean {
  switch (action) {
    case "bold":
      editor.chain().focus().toggleBold().run();
      return true;
    case "italic":
      editor.chain().focus().toggleItalic().run();
      return true;
    case "strike":
      editor.chain().focus().toggleStrike().run();
      return true;
    case "code":
      editor.chain().focus().toggleCode().run();
      return true;
    case "heading1":
      editor.chain().focus().toggleHeading({ level: 1 }).run();
      return true;
    case "heading2":
      editor.chain().focus().toggleHeading({ level: 2 }).run();
      return true;
    case "heading3":
      editor.chain().focus().toggleHeading({ level: 3 }).run();
      return true;
    case "bulletList":
      editor.chain().focus().toggleBulletList().run();
      return true;
    case "orderedList":
      editor.chain().focus().toggleOrderedList().run();
      return true;
    case "blockquote":
      editor.chain().focus().toggleBlockquote().run();
      return true;
    case "codeBlock":
      editor.chain().focus().toggleCodeBlock().run();
      return true;
    case "hr":
      editor.chain().focus().setHorizontalRule().run();
      return true;
    default:
      return false;
  }
}

// ── Sidebar HTML Fragment ────────────────────────────────────────────

/** Returns the HTML for the comment form + list container. */
export function sidebarHtml(): string {
  return `
    <div id="comment-form" class="hidden">
      <div id="form-header"></div>
      <textarea id="comment-body" rows="3" placeholder="Write a comment…"></textarea>
      <div id="suggest-replacement" class="hidden">
        <label>Replace with:</label>
        <textarea id="suggest-body" rows="3"></textarea>
      </div>
      <div class="form-actions">
        <button id="form-cancel">Cancel</button>
        <button id="form-submit">Submit</button>
      </div>
    </div>
    <div id="comments-list"></div>`;
}

// ── Utilities ────────────────────────────────────────────────────────

export function generateId(): string {
  return (
    Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
  );
}

export function timeAgo(date: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "…" : s;
}
