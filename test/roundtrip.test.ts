// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { BlockImage } from "../src/shared/editor";

describe("markdown round-trip: image + text", () => {
  let editor: Editor;

  function createEditor(content: string): Editor {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new Editor({
      element: el,
      extensions: [
        StarterKit,
        BlockImage,
        Markdown.configure({
          html: true,
          tightLists: true,
          bulletListMarker: "-",
        }),
      ],
      content,
    });
  }

  afterEach(() => {
    editor?.destroy();
  });

  it("should preserve paragraph break between image and text", () => {
    const md = '![Screenshot](https://example.com/img.png)Built for teams that already collaborate in a repo.';
    editor = createEditor(md);

    const out = (editor.storage as any).markdown.getMarkdown();

    // Image and text should be on separate lines
    expect(out).toContain("![Screenshot](https://example.com/img.png)");
    expect(out).toContain("Built for teams");
    expect(out).not.toMatch(/img\.png\)Built/);
  });

  it("should preserve paragraph break when linebreaks are added", () => {
    const md = '![Screenshot](https://example.com/img.png)\n\nBuilt for teams that already collaborate in a repo.';
    editor = createEditor(md);

    const out = (editor.storage as any).markdown.getMarkdown();

    expect(out).not.toMatch(/img\.png\)Built/);
  });

  it("should survive full round-trip via setContent", () => {
    const md1 = '![Screenshot](https://example.com/img.png)Built for teams that already collaborate in a repo.';
    editor = createEditor(md1);

    // Add linebreaks via setContent (simulating source pane edit)
    const md2 = '![Screenshot](https://example.com/img.png)\n\nBuilt for teams that already collaborate in a repo.';
    editor.commands.setContent(md2);

    const out2 = (editor.storage as any).markdown.getMarkdown();

    // Round-trip again
    editor.commands.setContent(out2);
    const out3 = (editor.storage as any).markdown.getMarkdown();

    expect(out3).not.toMatch(/img\.png\)Built/);
    expect(out3).toContain("![Screenshot](https://example.com/img.png)");
    expect(out3).toContain("Built for teams");
  });
});
