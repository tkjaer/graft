import { describe, it, expect } from "vitest";
import { createAnchorFromText, resolveAnchorInText } from "../src/shared/anchoring";

describe("createAnchorFromText", () => {
  it("captures the selected text", () => {
    const anchor = createAnchorFromText("hello world", "world");
    expect(anchor.text).toBe("world");
  });

  it("captures prefix context", () => {
    const anchor = createAnchorFromText("some prefix text hello world", "world");
    expect(anchor.prefix).toBe("some prefix text hello ");
  });

  it("captures suffix context", () => {
    const anchor = createAnchorFromText("hello world some suffix", "world");
    expect(anchor.suffix).toBe(" some suffix");
  });

  it("limits prefix to ~50 chars", () => {
    const long = "x".repeat(100) + "TARGET";
    const anchor = createAnchorFromText(long, "TARGET");
    expect(anchor.prefix.length).toBe(50);
  });

  it("limits suffix to ~50 chars", () => {
    const long = "TARGET" + "x".repeat(100);
    const anchor = createAnchorFromText(long, "TARGET");
    expect(anchor.suffix.length).toBe(50);
  });

  it("handles text not found gracefully", () => {
    const anchor = createAnchorFromText("hello", "missing");
    expect(anchor.text).toBe("missing");
    expect(anchor.prefix).toBe("");
    expect(anchor.suffix).toBe("");
  });

  it("handles anchor at start of document", () => {
    const anchor = createAnchorFromText("hello world", "hello");
    expect(anchor.prefix).toBe("");
    expect(anchor.suffix).toBe(" world");
  });

  it("handles anchor at end of document", () => {
    const anchor = createAnchorFromText("hello world", "world");
    expect(anchor.suffix).toBe("");
  });
});

describe("resolveAnchorInText", () => {
  it("finds exact match", () => {
    const anchor = createAnchorFromText("hello world", "world");
    const result = resolveAnchorInText("hello world", anchor);
    expect(result).toEqual({ from: 6, to: 11 });
  });

  it("returns null when text is missing", () => {
    const anchor = createAnchorFromText("hello world", "world");
    const result = resolveAnchorInText("goodbye", anchor);
    expect(result).toBeNull();
  });

  it("disambiguates with prefix when text appears multiple times", () => {
    const doc = "aaa foo bbb foo ccc";
    const anchor = createAnchorFromText(doc, "foo");
    // First "foo" is at index 4, createAnchorFromText finds the first one
    expect(anchor.prefix).toBe("aaa ");

    const result = resolveAnchorInText(doc, anchor);
    expect(result).toEqual({ from: 4, to: 7 });
  });

  it("picks correct instance using prefix context", () => {
    const doc = "aaa foo bbb foo ccc";
    // Manually create an anchor pointing to the second "foo"
    const anchor = { text: "foo", prefix: "aaa foo bbb ", suffix: " ccc" };

    const result = resolveAnchorInText(doc, anchor);
    expect(result).toEqual({ from: 12, to: 15 });
  });

  it("survives minor edits around the anchor", () => {
    const original = "The quick brown fox jumps over the lazy dog";
    const anchor = createAnchorFromText(original, "fox");

    // Simulate an edit: insert text before the anchor
    const edited = "The very quick brown fox jumps over the lazy dog";
    const result = resolveAnchorInText(edited, anchor);
    expect(result).not.toBeNull();
    expect(edited.slice(result!.from, result!.to)).toBe("fox");
  });

  it("works with single character anchor", () => {
    const anchor = createAnchorFromText("a b c", "b");
    const result = resolveAnchorInText("a b c", anchor);
    expect(result).toEqual({ from: 2, to: 3 });
  });

  it("works when anchor text is the entire document", () => {
    const doc = "entire document";
    const anchor = createAnchorFromText(doc, doc);
    const result = resolveAnchorInText(doc, anchor);
    expect(result).toEqual({ from: 0, to: doc.length });
  });
});
