/**
 * Parse a GitHub URL into structured data.
 * Supports file URLs and PR URLs.
 *
 * For file URLs, branch and path are returned as a combined `refAndPath`
 * string because branch names can contain `/` (e.g. `feature/docs`).
 * Use the API's `resolveRefAndPath()` to split them.
 */
export type ParsedGitHubUrl =
  | {
      type: "file";
      owner: string;
      repo: string;
      refAndPath: string;
    }
  | { type: "pr"; owner: string; repo: string; number: number };

export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  const trimmed = url.trim();

  // PR: github.com/owner/repo/pull/42
  const prMatch = trimmed.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
  );
  if (prMatch) {
    return {
      type: "pr",
      owner: prMatch[1],
      repo: prMatch[2],
      number: parseInt(prMatch[3], 10),
    };
  }

  // File: github.com/owner/repo/blob/branch-or-ref/path/to/file.md
  // Captures everything after blob/ as one string since branch names can contain /
  const fileMatch = trimmed.match(
    /github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)/,
  );
  if (fileMatch) {
    return {
      type: "file",
      owner: fileMatch[1],
      repo: fileMatch[2],
      refAndPath: fileMatch[3],
    };
  }

  return null;
}
