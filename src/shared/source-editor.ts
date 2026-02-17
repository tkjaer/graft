/**
 * CodeMirror-based markdown source editor with vim bindings.
 * Used as the "source pane" alongside the Tiptap WYSIWYG editor.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { vim } from "@replit/codemirror-vim";

export interface SourceEditor {
  view: EditorView;
  setContent(text: string): void;
  getContent(): string;
  destroy(): void;
}

/**
 * Create a CodeMirror editor with vim bindings, line numbers,
 * and markdown syntax highlighting.
 */
export function createSourceEditor(
  parent: HTMLElement,
  initialContent: string,
  onChange: (content: string) => void,
): SourceEditor {
  const vimMode = new Compartment();

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initialContent,
      extensions: [
        vimMode.of(vim()),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        // Minimal theme — inherits from CSS variables
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "13px",
          },
          ".cm-content": {
            fontFamily: '"SF Mono", "Fira Code", monospace',
            padding: "16px 0",
          },
          ".cm-gutters": {
            border: "none",
          },
          ".cm-scroller": {
            overflow: "auto",
          },
        }),
      ],
    }),
  });

  return {
    view,
    setContent(text: string) {
      const current = view.state.doc.toString();
      if (current !== text) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: text },
        });
      }
    },
    getContent() {
      return view.state.doc.toString();
    },
    destroy() {
      view.destroy();
    },
  };
}
