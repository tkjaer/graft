/**
 * Version history panel.
 *
 * Shows the git log for the current document file. Users can click
 * a version to view it, or diff between two versions. Includes a
 * "What changed since I last looked" badge that uses localStorage
 * to track the last-viewed commit timestamp per document.
 */

import type { BaseGitHubApi } from "./api";

export interface CommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  isoDate: string;
}

/**
 * Fetch the git log (commit history) for a file.
 */
export async function fetchFileHistory(
  api: BaseGitHubApi,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  page = 1,
  perPage = 30,
): Promise<CommitEntry[]> {
  // Use the Octokit instance via the API — we need a method that
  // exposes listCommits. Since BaseGitHubApi doesn't have it, we
  // add it to the API surface.
  const commits = await api.getFileCommits(
    owner,
    repo,
    branch,
    filePath,
    page,
    perPage,
  );
  return commits;
}

/**
 * Get the last-viewed commit SHA for a document.
 * Uses localStorage keyed by owner/repo/branch/path.
 */
export function getLastViewed(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
): string | null {
  const key = `graft-lastviewed:${owner}/${repo}/${branch}/${filePath}`;
  return localStorage.getItem(key);
}

/**
 * Mark the current commit SHA as the last-viewed for a document.
 */
export function setLastViewed(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  sha: string,
): void {
  const key = `graft-lastviewed:${owner}/${repo}/${branch}/${filePath}`;
  localStorage.setItem(key, sha);
}

/**
 * Count how many commits are newer than the last-viewed commit.
 */
export function countNewCommits(
  commits: CommitEntry[],
  lastViewedSha: string | null,
): number {
  if (!lastViewedSha) return 0;
  const idx = commits.findIndex((c) => c.sha === lastViewedSha);
  if (idx < 0) return commits.length; // Last viewed commit not in this page
  return idx; // All commits before the last-viewed are "new"
}

/**
 * Simple inline diff between two strings (line-based).
 * Returns HTML with additions highlighted in green and deletions in red.
 */
export function simpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: string[] = [];

  // Simple LCS-based diff
  const lcs = computeLCS(oldLines, newLines);
  let oi = 0;
  let ni = 0;

  for (const line of lcs) {
    while (oi < oldLines.length && oldLines[oi] !== line) {
      result.push(
        `<div class="diff-line del">- ${escHtml(oldLines[oi])}</div>`,
      );
      oi++;
    }
    while (ni < newLines.length && newLines[ni] !== line) {
      result.push(
        `<div class="diff-line add">+ ${escHtml(newLines[ni])}</div>`,
      );
      ni++;
    }
    result.push(`<div class="diff-line ctx">  ${escHtml(line)}</div>`);
    oi++;
    ni++;
  }

  while (oi < oldLines.length) {
    result.push(
      `<div class="diff-line del">- ${escHtml(oldLines[oi])}</div>`,
    );
    oi++;
  }
  while (ni < newLines.length) {
    result.push(
      `<div class="diff-line add">+ ${escHtml(newLines[ni])}</div>`,
    );
    ni++;
  }

  return result.join("\n");
}

/**
 * Compute Longest Common Subsequence of two string arrays.
 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // For very large diffs, truncate to avoid O(n²) memory
  if (m * n > 1_000_000) {
    // Fall back to simple line-by-line comparison
    return a.filter((line) => b.includes(line));
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render the history panel HTML.
 */
export function renderHistoryPanel(
  commits: CommitEntry[],
  newCount: number,
  selectedSha?: string,
): string {
  if (commits.length === 0) {
    return '<div class="history-empty">No commit history found.</div>';
  }

  const badge =
    newCount > 0
      ? `<span class="history-badge">${newCount} new</span>`
      : "";

  return `
    <div class="history-header">
      <h3>Version History ${badge}</h3>
    </div>
    <div class="history-list">
      ${commits
        .map(
          (c, i) => `
        <div class="history-item${c.sha === selectedSha ? " selected" : ""}${i < newCount ? " new-commit" : ""}"
             data-sha="${c.sha}"
             data-action="view-version">
          <div class="history-item-header">
            <span class="history-author">${escHtml(c.author)}</span>
            <span class="history-date">${escHtml(c.date)}</span>
          </div>
          <div class="history-message">${escHtml(c.message)}</div>
          <div class="history-sha">${escHtml(c.shortSha)}</div>
        </div>`,
        )
        .join("")}
    </div>`;
}
