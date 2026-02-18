/**
 * Suggesting mode extension for Tiptap.
 *
 * When suggesting mode is active, edits are tracked as suggestion marks
 * (insertions in green, deletions in red strikethrough) instead of
 * modifying the document directly. Other users can accept or reject
 * individual suggestions.
 *
 * This is similar to Google Docs' "Suggesting" mode or Word's
 * "Track Changes".
 */

import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// ── Suggestion Marks ─────────────────────────────────────────────────

/**
 * Mark for suggested insertions (green highlight).
 * Text with this mark was added by a suggestion.
 */
export const SuggestionInsertMark = Mark.create({
  name: "suggestionInsert",

  addAttributes() {
    return {
      author: { default: null },
      createdAt: { default: null },
      suggestionId: { default: null },
    };
  },

  excludes: "",

  parseHTML() {
    return [{ tag: 'ins[data-suggestion-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "ins",
      mergeAttributes(HTMLAttributes, {
        "data-suggestion-id": HTMLAttributes.suggestionId,
        class: "suggestion-insert",
        title: `Suggested by ${HTMLAttributes.author || "unknown"}`,
      }),
      0,
    ];
  },
});

/**
 * Mark for suggested deletions (red strikethrough).
 * Text with this mark is proposed for removal.
 */
export const SuggestionDeleteMark = Mark.create({
  name: "suggestionDelete",

  addAttributes() {
    return {
      author: { default: null },
      createdAt: { default: null },
      suggestionId: { default: null },
    };
  },

  excludes: "",

  parseHTML() {
    return [{ tag: 'del[data-suggestion-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "del",
      mergeAttributes(HTMLAttributes, {
        "data-suggestion-id": HTMLAttributes.suggestionId,
        class: "suggestion-delete",
        title: `Deletion suggested by ${HTMLAttributes.author || "unknown"}`,
      }),
      0,
    ];
  },
});

// ── Suggesting Mode Extension ────────────────────────────────────────

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestingMode: {
      /** Toggle suggesting mode on/off */
      toggleSuggestingMode: () => ReturnType;
      /** Accept a suggestion by ID */
      acceptSuggestion: (suggestionId: string) => ReturnType;
      /** Reject a suggestion by ID */
      rejectSuggestion: (suggestionId: string) => ReturnType;
      /** Accept all suggestions */
      acceptAllSuggestions: () => ReturnType;
      /** Reject all suggestions */
      rejectAllSuggestions: () => ReturnType;
    };
  }
}

let suggestingModeActive = false;
let suggestingUser = "You";

function generateSuggestionId(): string {
  return (
    "sg-" +
    Math.random().toString(36).substring(2, 8) +
    Date.now().toString(36)
  );
}

/**
 * Find all ranges with a given suggestion mark attribute.
 */
function findSuggestionRanges(
  view: EditorView,
  markName: string,
  suggestionId: string,
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  const markType = view.state.schema.marks[markName];
  if (!markType) return ranges;

  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find(
      (m) => m.type === markType && m.attrs.suggestionId === suggestionId,
    );
    if (mark) {
      // Try to merge with the last range
      const last = ranges[ranges.length - 1];
      if (last && last.to === pos) {
        last.to = pos + node.nodeSize;
      } else {
        ranges.push({ from: pos, to: pos + node.nodeSize });
      }
    }
  });

  return ranges;
}

export const SuggestingMode = Extension.create({
  name: "suggestingMode",

  addExtensions() {
    return [SuggestionInsertMark, SuggestionDeleteMark];
  },

  addCommands() {
    return {
      toggleSuggestingMode:
        () =>
        () => {
          suggestingModeActive = !suggestingModeActive;
          return true;
        },

      acceptSuggestion:
        (suggestionId: string) =>
        ({ view }) => {
          const doc = view.state.doc;
          const tr = view.state.tr;
          const insertType = view.state.schema.marks.suggestionInsert;
          const deleteType = view.state.schema.marks.suggestionDelete;

          // Process deletions first (remove the deleted text)
          const deleteRanges = findSuggestionRanges(
            view,
            "suggestionDelete",
            suggestionId,
          );
          // Process in reverse order to preserve positions
          for (let i = deleteRanges.length - 1; i >= 0; i--) {
            const range = deleteRanges[i];
            tr.delete(range.from, range.to);
          }

          // Then remove insertion marks (keep the text, just remove the mark)
          const insertRanges = findSuggestionRanges(
            view,
            "suggestionInsert",
            suggestionId,
          );
          for (const range of insertRanges) {
            tr.removeMark(range.from, range.to, insertType);
          }

          view.dispatch(tr);
          return true;
        },

      rejectSuggestion:
        (suggestionId: string) =>
        ({ view }) => {
          const tr = view.state.tr;
          const insertType = view.state.schema.marks.suggestionInsert;
          const deleteType = view.state.schema.marks.suggestionDelete;

          // Remove inserted text (reject the addition)
          const insertRanges = findSuggestionRanges(
            view,
            "suggestionInsert",
            suggestionId,
          );
          for (let i = insertRanges.length - 1; i >= 0; i--) {
            const range = insertRanges[i];
            tr.delete(range.from, range.to);
          }

          // Remove deletion marks (keep the text that was proposed for deletion)
          const deleteRanges = findSuggestionRanges(
            view,
            "suggestionDelete",
            suggestionId,
          );
          for (const range of deleteRanges) {
            tr.removeMark(range.from, range.to, deleteType);
          }

          view.dispatch(tr);
          return true;
        },

      acceptAllSuggestions:
        () =>
        ({ view }) => {
          const tr = view.state.tr;
          const insertType = view.state.schema.marks.suggestionInsert;
          const deleteType = view.state.schema.marks.suggestionDelete;

          // Collect all delete ranges
          const deleteRanges: Array<{ from: number; to: number }> = [];
          view.state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            if (node.marks.some((m) => m.type === deleteType)) {
              const last = deleteRanges[deleteRanges.length - 1];
              if (last && last.to === pos) {
                last.to = pos + node.nodeSize;
              } else {
                deleteRanges.push({ from: pos, to: pos + node.nodeSize });
              }
            }
          });

          // Delete in reverse order
          for (let i = deleteRanges.length - 1; i >= 0; i--) {
            tr.delete(deleteRanges[i].from, deleteRanges[i].to);
          }

          // Remove all insert marks
          tr.removeMark(0, tr.doc.content.size, insertType);

          view.dispatch(tr);
          return true;
        },

      rejectAllSuggestions:
        () =>
        ({ view }) => {
          const tr = view.state.tr;
          const insertType = view.state.schema.marks.suggestionInsert;
          const deleteType = view.state.schema.marks.suggestionDelete;

          // Collect all insert ranges
          const insertRanges: Array<{ from: number; to: number }> = [];
          view.state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            if (node.marks.some((m) => m.type === insertType)) {
              const last = insertRanges[insertRanges.length - 1];
              if (last && last.to === pos) {
                last.to = pos + node.nodeSize;
              } else {
                insertRanges.push({ from: pos, to: pos + node.nodeSize });
              }
            }
          });

          // Delete inserted text in reverse order
          for (let i = insertRanges.length - 1; i >= 0; i--) {
            tr.delete(insertRanges[i].from, insertRanges[i].to);
          }

          // Remove all delete marks (keep the text)
          tr.removeMark(0, tr.doc.content.size, deleteType);

          view.dispatch(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("suggestingMode"),

        props: {
          handleTextInput(view, from, to, text) {
            if (!suggestingModeActive) return false;

            const tr = view.state.tr;
            const suggestionId = generateSuggestionId();
            const markAttrs = {
              author: suggestingUser,
              createdAt: new Date().toISOString(),
              suggestionId,
            };

            // If there's a selection (from !== to), mark the selected text for deletion
            if (from !== to) {
              tr.addMark(
                from,
                to,
                view.state.schema.marks.suggestionDelete.create(markAttrs),
              );
            }

            // Insert the new text with an insert mark
            const insertMark =
              view.state.schema.marks.suggestionInsert.create(markAttrs);
            tr.insert(
              to,
              view.state.schema.text(text, [insertMark]),
            );

            view.dispatch(tr);
            return true;
          },

          handleKeyDown(view, event) {
            if (!suggestingModeActive) return false;

            // Handle backspace in suggesting mode
            if (event.key === "Backspace") {
              const { from, to } = view.state.selection;

              if (from === to && from > 0) {
                // Single cursor — mark the character before cursor for deletion
                const tr = view.state.tr;
                const suggestionId = generateSuggestionId();
                tr.addMark(
                  from - 1,
                  from,
                  view.state.schema.marks.suggestionDelete.create({
                    author: suggestingUser,
                    createdAt: new Date().toISOString(),
                    suggestionId,
                  }),
                );
                view.dispatch(tr);
                return true;
              } else if (from !== to) {
                // Selection — mark entire selection for deletion
                const tr = view.state.tr;
                const suggestionId = generateSuggestionId();
                tr.addMark(
                  from,
                  to,
                  view.state.schema.marks.suggestionDelete.create({
                    author: suggestingUser,
                    createdAt: new Date().toISOString(),
                    suggestionId,
                  }),
                );
                view.dispatch(tr);
                return true;
              }
            }

            // Handle Delete key
            if (event.key === "Delete") {
              const { from, to } = view.state.selection;

              if (from === to && from < view.state.doc.content.size) {
                const tr = view.state.tr;
                const suggestionId = generateSuggestionId();
                tr.addMark(
                  from,
                  from + 1,
                  view.state.schema.marks.suggestionDelete.create({
                    author: suggestingUser,
                    createdAt: new Date().toISOString(),
                    suggestionId,
                  }),
                );
                view.dispatch(tr);
                return true;
              } else if (from !== to) {
                const tr = view.state.tr;
                const suggestionId = generateSuggestionId();
                tr.addMark(
                  from,
                  to,
                  view.state.schema.marks.suggestionDelete.create({
                    author: suggestingUser,
                    createdAt: new Date().toISOString(),
                    suggestionId,
                  }),
                );
                view.dispatch(tr);
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});

/**
 * Set the current user for suggesting mode attribution.
 */
export function setSuggestingUser(name: string): void {
  suggestingUser = name;
}

/**
 * Check if suggesting mode is currently active.
 */
export function isSuggestingModeActive(): boolean {
  return suggestingModeActive;
}
