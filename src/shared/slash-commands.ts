/**
 * Slash commands extension for Tiptap.
 *
 * Type `/` to open a floating command palette with commonly used
 * block types: headings, lists, code blocks, images, dividers, tables.
 *
 * Uses a lightweight custom implementation (no @tiptap/suggestion
 * dependency) — listens for `/` at the start of a line or after
 * whitespace, shows a filtered dropdown, and executes the selected
 * command.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export interface SlashCommand {
  title: string;
  description: string;
  icon: string;
  command: (view: EditorView) => void;
}

const DEFAULT_COMMANDS: SlashCommand[] = [
  {
    title: "Heading 1",
    description: "Large heading",
    icon: "H1",
    command: (view) => {
      deleteSlashText(view);
      const { state, dispatch } = view;
      const { $from } = state.selection;
      const blockRange = $from.blockRange();
      if (blockRange) {
        view.dispatch(
          state.tr.setBlockType(
            blockRange.start,
            blockRange.end,
            state.schema.nodes.heading,
            { level: 1 },
          ),
        );
      }
    },
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    icon: "H2",
    command: (view) => {
      deleteSlashText(view);
      const { state } = view;
      const { $from } = state.selection;
      const blockRange = $from.blockRange();
      if (blockRange) {
        view.dispatch(
          state.tr.setBlockType(
            blockRange.start,
            blockRange.end,
            state.schema.nodes.heading,
            { level: 2 },
          ),
        );
      }
    },
  },
  {
    title: "Heading 3",
    description: "Small heading",
    icon: "H3",
    command: (view) => {
      deleteSlashText(view);
      const { state } = view;
      const { $from } = state.selection;
      const blockRange = $from.blockRange();
      if (blockRange) {
        view.dispatch(
          state.tr.setBlockType(
            blockRange.start,
            blockRange.end,
            state.schema.nodes.heading,
            { level: 3 },
          ),
        );
      }
    },
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: "•",
    command: (view) => {
      deleteSlashText(view);
      const { state } = view;
      const listItem = state.schema.nodes.listItem;
      const bulletList = state.schema.nodes.bulletList;
      if (bulletList && listItem) {
        const { $from } = state.selection;
        const tr = state.tr.replaceWith(
          $from.before($from.depth),
          $from.after($from.depth),
          bulletList.create(
            null,
            listItem.create(null, state.schema.nodes.paragraph.create()),
          ),
        );
        view.dispatch(tr);
      }
    },
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: "1.",
    command: (view) => {
      deleteSlashText(view);
      const { state } = view;
      const listItem = state.schema.nodes.listItem;
      const orderedList = state.schema.nodes.orderedList;
      if (orderedList && listItem) {
        const { $from } = state.selection;
        const tr = state.tr.replaceWith(
          $from.before($from.depth),
          $from.after($from.depth),
          orderedList.create(
            null,
            listItem.create(null, state.schema.nodes.paragraph.create()),
          ),
        );
        view.dispatch(tr);
      }
    },
  },
  {
    title: "Code Block",
    description: "Fenced code block",
    icon: "{ }",
    command: (view) => {
      deleteSlashText(view);
      const { state } = view;
      const { $from } = state.selection;
      const blockRange = $from.blockRange();
      if (blockRange && state.schema.nodes.codeBlock) {
        view.dispatch(
          state.tr.setBlockType(
            blockRange.start,
            blockRange.end,
            state.schema.nodes.codeBlock,
          ),
        );
      }
    },
  },
  {
    title: "Blockquote",
    description: "Quote block",
    icon: "❝",
    command: (view) => {
      deleteSlashText(view);
      const { state } = view;
      const { $from } = state.selection;
      if (state.schema.nodes.blockquote) {
        const tr = state.tr.replaceWith(
          $from.before($from.depth),
          $from.after($from.depth),
          state.schema.nodes.blockquote.create(
            null,
            state.schema.nodes.paragraph.create(),
          ),
        );
        view.dispatch(tr);
      }
    },
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: "―",
    command: (view) => {
      deleteSlashText(view);
      const { state } = view;
      if (state.schema.nodes.horizontalRule) {
        const { $from } = state.selection;
        const tr = state.tr.replaceWith(
          $from.before($from.depth),
          $from.after($from.depth),
          state.schema.nodes.horizontalRule.create(),
        );
        view.dispatch(tr);
      }
    },
  },
  {
    title: "Table",
    description: "Insert a table",
    icon: "⊞",
    command: (view) => {
      deleteSlashText(view);
      const { state } = view;
      const { table, tableRow, tableHeader, tableCell } = state.schema.nodes;
      if (table && tableRow && tableHeader && tableCell) {
        const { $from } = state.selection;
        const headerRow = tableRow.create(null, [
          tableHeader.create(null, state.schema.nodes.paragraph.create()),
          tableHeader.create(null, state.schema.nodes.paragraph.create()),
          tableHeader.create(null, state.schema.nodes.paragraph.create()),
        ]);
        const bodyRow = tableRow.create(null, [
          tableCell.create(null, state.schema.nodes.paragraph.create()),
          tableCell.create(null, state.schema.nodes.paragraph.create()),
          tableCell.create(null, state.schema.nodes.paragraph.create()),
        ]);
        const tableNode = table.create(null, [headerRow, bodyRow]);
        const tr = state.tr.replaceWith(
          $from.before($from.depth),
          $from.after($from.depth),
          tableNode,
        );
        view.dispatch(tr);
      }
    },
  },
];

/**
 * Delete the slash command text (e.g., "/head") from the editor.
 */
function deleteSlashText(view: EditorView): void {
  const { state } = view;
  const { $from } = state.selection;
  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "\ufffc",
  );

  const slashIdx = textBefore.lastIndexOf("/");
  if (slashIdx >= 0) {
    const from = $from.start() + slashIdx;
    const to = $from.pos;
    view.dispatch(state.tr.delete(from, to));
  }
}

// ── Dropdown UI ──────────────────────────────────────────────────────

let dropdownEl: HTMLElement | null = null;
let activeIndex = 0;
let filteredCommands: SlashCommand[] = [];
let currentView: EditorView | null = null;

function createDropdown(): HTMLElement {
  const el = document.createElement("div");
  el.className = "slash-commands-dropdown";
  el.style.cssText =
    "position:fixed;z-index:9999;background:var(--bg,var(--vscode-editor-background,#fff));color:var(--fg,var(--vscode-editor-foreground,#1f2328));border:1px solid var(--border,var(--vscode-editorWidget-border,#d0d7de));border-radius:8px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,.25);max-height:300px;overflow-y:auto;min-width:220px;";
  document.body.appendChild(el);
  return el;
}

function showDropdown(view: EditorView, filter: string): void {
  currentView = view;

  const query = filter.toLowerCase();
  filteredCommands = DEFAULT_COMMANDS.filter(
    (c) =>
      c.title.toLowerCase().includes(query) ||
      c.description.toLowerCase().includes(query),
  );

  if (filteredCommands.length === 0) {
    hideDropdown();
    return;
  }

  if (!dropdownEl) {
    dropdownEl = createDropdown();
  }

  activeIndex = Math.min(activeIndex, filteredCommands.length - 1);

  dropdownEl.innerHTML = filteredCommands
    .map(
      (c, i) =>
        `<div class="slash-cmd-item${i === activeIndex ? " active" : ""}" data-index="${i}" style="padding:6px 10px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:8px;${i === activeIndex ? "background:var(--hover-bg,var(--vscode-list-hoverBackground,rgba(128,128,128,.15)));" : ""}">
          <span style="width:28px;text-align:center;font-weight:600;opacity:.7;font-size:13px;color:var(--text-muted,var(--vscode-descriptionForeground,#656d76));">${c.icon}</span>
          <div>
            <div style="font-size:14px;font-weight:500;">${c.title}</div>
            <div style="font-size:12px;color:var(--text-muted,var(--vscode-descriptionForeground,#656d76));">${c.description}</div>
          </div>
        </div>`,
    )
    .join("");

  // Position near cursor, clamped to viewport
  const coords = view.coordsAtPos(view.state.selection.from);
  let left = coords.left;
  let top = coords.bottom + 4;

  dropdownEl.style.left = "0px";
  dropdownEl.style.top = "0px";
  dropdownEl.style.display = "block";

  const rect = dropdownEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Clamp horizontal: don't overflow right edge
  if (left + rect.width > vw - 8) {
    left = Math.max(8, vw - rect.width - 8);
  }
  // Clamp vertical: if it overflows bottom, show above the cursor instead
  if (top + rect.height > vh - 8) {
    top = coords.top - rect.height - 4;
  }
  // Final safety clamp
  top = Math.max(8, top);
  left = Math.max(8, left);

  dropdownEl.style.left = `${left}px`;
  dropdownEl.style.top = `${top}px`;

  // Click handler
  dropdownEl.querySelectorAll(".slash-cmd-item").forEach((item) => {
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const idx = parseInt((item as HTMLElement).dataset.index || "0", 10);
      executeCommand(idx);
    });
  });
}

function hideDropdown(): void {
  if (dropdownEl) {
    dropdownEl.style.display = "none";
  }
  activeIndex = 0;
  filteredCommands = [];
  currentView = null;
}

function executeCommand(index: number): void {
  if (!currentView || !filteredCommands[index]) return;
  const cmd = filteredCommands[index];
  const view = currentView;
  hideDropdown();
  cmd.command(view);
  view.focus();
}

// ── Extension ────────────────────────────────────────────────────────

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addProseMirrorPlugins() {
    let slashActive = false;

    return [
      new Plugin({
        key: new PluginKey("slashCommands"),

        props: {
          handleTextInput(view, from, to, text) {
            // Detect `/` typed at start of line or after whitespace
            if (text === "/") {
              const { $from } = view.state.selection;
              const textBefore = $from.parent.textBetween(
                0,
                $from.parentOffset,
                undefined,
                "\ufffc",
              );

              // Only trigger at start of line or after whitespace
              if (
                textBefore.length === 0 ||
                /\s$/.test(textBefore)
              ) {
                slashActive = true;
                // Show dropdown after the `/` is inserted
                setTimeout(() => {
                  showDropdown(view, "");
                }, 0);
              }
              return false; // Let the `/` be inserted normally
            }

            // If slash is active, update the filter
            if (slashActive) {
              setTimeout(() => {
                const { $from } = view.state.selection;
                const textBefore = $from.parent.textBetween(
                  0,
                  $from.parentOffset,
                  undefined,
                  "\ufffc",
                );
                const slashIdx = textBefore.lastIndexOf("/");
                if (slashIdx >= 0) {
                  const filter = textBefore.slice(slashIdx + 1);
                  showDropdown(view, filter);
                } else {
                  slashActive = false;
                  hideDropdown();
                }
              }, 0);
            }

            return false;
          },

          handleKeyDown(view, event) {
            if (!slashActive || filteredCommands.length === 0) {
              // Escape always dismisses
              if (event.key === "Escape" && slashActive) {
                slashActive = false;
                hideDropdown();
                return true;
              }
              return false;
            }

            switch (event.key) {
              case "ArrowDown":
                event.preventDefault();
                activeIndex =
                  (activeIndex + 1) % filteredCommands.length;
                showDropdown(view, getSlashFilter(view) ?? "");
                return true;

              case "ArrowUp":
                event.preventDefault();
                activeIndex =
                  (activeIndex - 1 + filteredCommands.length) %
                  filteredCommands.length;
                showDropdown(view, getSlashFilter(view) ?? "");
                return true;

              case "Enter":
                event.preventDefault();
                executeCommand(activeIndex);
                slashActive = false;
                return true;

              case "Escape":
                slashActive = false;
                hideDropdown();
                return true;

              case "Backspace": {
                // If we'd delete the `/`, dismiss
                const filter = getSlashFilter(view);
                if (!filter || filter.length === 0) {
                  slashActive = false;
                  hideDropdown();
                }
                // Let backspace proceed normally, then update
                setTimeout(() => {
                  if (!slashActive) return;
                  const f = getSlashFilter(view);
                  if (f === null) {
                    slashActive = false;
                    hideDropdown();
                  } else {
                    showDropdown(view, f);
                  }
                }, 0);
                return false;
              }

              default:
                return false;
            }
          },
        },

        view() {
          return {
            update(view, prevState) {
              // Dismiss if selection moved to a different block
              if (
                slashActive &&
                view.state.selection.from !==
                  prevState.selection.from
              ) {
                const filter = getSlashFilter(view);
                if (filter === null) {
                  slashActive = false;
                  hideDropdown();
                }
              }
            },
            destroy() {
              hideDropdown();
              if (dropdownEl) {
                dropdownEl.remove();
                dropdownEl = null;
              }
            },
          };
        },
      }),
    ];
  },
});

function getSlashFilter(view: EditorView): string | null {
  const { $from } = view.state.selection;
  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "\ufffc",
  );
  const slashIdx = textBefore.lastIndexOf("/");
  if (slashIdx < 0) return null;
  return textBefore.slice(slashIdx + 1);
}
