import { describe, it, expect } from "vitest";
import { parseGitHubUrl } from "../src/shared/url";

describe("parseGitHubUrl", () => {
  it("parses a file URL", () => {
    const result = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/docs/file.md",
    );
    expect(result).toEqual({
      type: "file",
      owner: "owner",
      repo: "repo",
      refAndPath: "main/docs/file.md",
    });
  });

  it("parses a PR URL", () => {
    const result = parseGitHubUrl(
      "https://github.com/owner/repo/pull/42",
    );
    expect(result).toEqual({
      type: "pr",
      owner: "owner",
      repo: "repo",
      number: 42,
    });
  });

  it("handles file at repo root", () => {
    const result = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/README.md",
    );
    expect(result).toEqual({
      type: "file",
      owner: "owner",
      repo: "repo",
      refAndPath: "main/README.md",
    });
  });

  it("handles nested file paths", () => {
    const result = parseGitHubUrl(
      "https://github.com/acme/docs/blob/feature/a/b/c/deep.md",
    );
    expect(result).toEqual({
      type: "file",
      owner: "acme",
      repo: "docs",
      refAndPath: "feature/a/b/c/deep.md",
    });
  });

  it("returns null for invalid URLs", () => {
    expect(parseGitHubUrl("not a url")).toBeNull();
    expect(parseGitHubUrl("https://google.com")).toBeNull();
    expect(parseGitHubUrl("https://github.com/owner/repo")).toBeNull();
    expect(parseGitHubUrl("")).toBeNull();
  });

  it("trims whitespace", () => {
    const result = parseGitHubUrl(
      "  https://github.com/owner/repo/pull/7  ",
    );
    expect(result).toEqual({
      type: "pr",
      owner: "owner",
      repo: "repo",
      number: 7,
    });
  });

  it("handles PR URL with trailing segments", () => {
    const result = parseGitHubUrl(
      "https://github.com/owner/repo/pull/99/files",
    );
    expect(result).toEqual({
      type: "pr",
      owner: "owner",
      repo: "repo",
      number: 99,
    });
  });
});
