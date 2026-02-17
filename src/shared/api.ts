import { Octokit } from "@octokit/rest";
import type { DocComment } from "../types";

const COMMENTS_BRANCH = "graft-comments";

/** Runtime check that a parsed JSON value looks like a DocComment. */
function isValidComment(c: unknown): c is DocComment {
  if (typeof c !== "object" || c === null) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    (o.type === "comment" || o.type === "suggestion") &&
    typeof o.body === "string" &&
    typeof o.author === "string" &&
    typeof o.resolved === "boolean" &&
    Array.isArray(o.replies) &&
    typeof o.anchor === "object" &&
    o.anchor !== null
  );
}

export interface FileContent {
  content: string;
  sha: string;
  path: string;
}

export interface PRDetails {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  merge_commit_sha: string | null;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
}

export interface PRFile {
  filename: string;
  status: string;
}

/**
 * Abstract GitHub API client. Subclasses provide environment-specific
 * Octokit initialization and base64 encoding.
 */
export abstract class BaseGitHubApi {
  protected abstract getOctokit(): Promise<Octokit>;
  protected abstract encodeContent(content: string): string;
  protected abstract decodeContent(base64: string): string;

  // ── Repository ───────────────────────────────────────────────────

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const ok = await this.getOctokit();
    const { data } = await ok.repos.get({ owner, repo });
    return data.default_branch;
  }

  /**
   * Resolve an ambiguous `refAndPath` string (from a GitHub blob URL) into
   * a branch name and file path. Tries progressively longer branch names
   * via the refs API until one matches.
   */
  async resolveRefAndPath(
    owner: string,
    repo: string,
    refAndPath: string,
  ): Promise<{ branch: string; path: string }> {
    const parts = refAndPath.split("/");
    const ok = await this.getOctokit();

    // Try progressively longer prefixes as the branch name.
    // At least one segment must remain for the file path.
    for (let i = 1; i < parts.length; i++) {
      const candidateBranch = parts.slice(0, i).join("/");
      const candidatePath = parts.slice(i).join("/");
      try {
        await ok.git.getRef({ owner, repo, ref: `heads/${candidateBranch}` });
        return { branch: candidateBranch, path: candidatePath };
      } catch (err: any) {
        if (err.status === 404) continue;
        throw err;
      }
    }

    // Fallback: first segment is the branch (matches original behavior)
    return { branch: parts[0], path: parts.slice(1).join("/") };
  }

  async createBranch(
    owner: string,
    repo: string,
    newBranch: string,
    fromBranch: string,
  ): Promise<void> {
    const ok = await this.getOctokit();
    const { data: ref } = await ok.git.getRef({
      owner,
      repo,
      ref: `heads/${fromBranch}`,
    });
    await ok.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranch}`,
      sha: ref.object.sha,
    });
  }

  // ── File Content ─────────────────────────────────────────────────

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<FileContent> {
    const ok = await this.getOctokit();
    const { data } = await ok.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`${path} is not a file`);
    }
    return {
      content: this.decodeContent(data.content),
      sha: data.sha,
      path: data.path,
    };
  }

  async commitFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    sha: string,
    message: string,
    branch: string,
  ): Promise<{ sha: string }> {
    const ok = await this.getOctokit();
    const { data } = await ok.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: this.encodeContent(content),
      sha,
      branch,
    });
    return { sha: data.content?.sha ?? sha };
  }

  // ── PR ───────────────────────────────────────────────────────────

  async getPR(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PRDetails> {
    const ok = await this.getOctokit();
    const { data } = await ok.pulls.get({ owner, repo, pull_number: number });
    return {
      number: data.number,
      title: data.title,
      state: data.state,
      merged: data.merged,
      merge_commit_sha: data.merge_commit_sha ?? null,
      head: { ref: data.head.ref, sha: data.head.sha },
      base: { ref: data.base.ref, sha: data.base.sha },
    };
  }

  async getPRFiles(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PRFile[]> {
    const ok = await this.getOctokit();
    const { data } = await ok.pulls.listFiles({
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    });
    return data.map((f) => ({ filename: f.filename, status: f.status ?? "" }));
  }

  // ── Current User ─────────────────────────────────────────────────

  async getCurrentUser(): Promise<{ login: string }> {
    const ok = await this.getOctokit();
    const { data } = await ok.users.getAuthenticated();
    return { login: data.login };
  }

  // ── Comments (orphan branch) ─────────────────────────────────────

  async getCommentsFile(
    owner: string,
    repo: string,
    docBranch: string,
    docPath: string,
  ): Promise<{ comments: DocComment[]; sha: string } | null> {
    try {
      const commentPath = `${docBranch}/${docPath}.comments.json`;
      const file = await this.getFileContent(
        owner,
        repo,
        commentPath,
        COMMENTS_BRANCH,
      );
      const raw = JSON.parse(file.content);
      const comments = Array.isArray(raw) ? raw.filter(isValidComment) : [];
      return { comments, sha: file.sha };
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async saveCommentsFile(
    owner: string,
    repo: string,
    docBranch: string,
    docPath: string,
    comments: DocComment[],
    sha?: string,
  ): Promise<string> {
    await this.ensureCommentsBranch(owner, repo);

    const commentPath = `${docBranch}/${docPath}.comments.json`;
    const content = JSON.stringify(comments, null, 2);

    if (sha) {
      const result = await this.commitFile(
        owner,
        repo,
        commentPath,
        content,
        sha,
        `Update comments for ${docPath}`,
        COMMENTS_BRANCH,
      );
      return result.sha;
    }

    // No SHA — file might or might not exist
    try {
      const existing = await this.getFileContent(
        owner,
        repo,
        commentPath,
        COMMENTS_BRANCH,
      );
      const result = await this.commitFile(
        owner,
        repo,
        commentPath,
        content,
        existing.sha,
        `Update comments for ${docPath}`,
        COMMENTS_BRANCH,
      );
      return result.sha;
    } catch (err: any) {
      if (err.status === 404) {
        const ok = await this.getOctokit();
        const { data } = await ok.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: commentPath,
          message: `Add comments for ${docPath}`,
          content: this.encodeContent(content),
          branch: COMMENTS_BRANCH,
        });
        return data.content?.sha ?? "";
      }
      throw err;
    }
  }

  private async ensureCommentsBranch(
    owner: string,
    repo: string,
  ): Promise<void> {
    const ok = await this.getOctokit();
    try {
      await ok.git.getRef({ owner, repo, ref: `heads/${COMMENTS_BRANCH}` });
    } catch (err: any) {
      if (err.status === 404) {
        const { data: blob } = await ok.git.createBlob({
          owner,
          repo,
          content: this.encodeContent(
            "This branch stores Graft comment data.\n",
          ),
          encoding: "base64",
        });

        const { data: tree } = await ok.git.createTree({
          owner,
          repo,
          tree: [
            { path: ".graft", mode: "100644", type: "blob", sha: blob.sha },
          ],
        });

        const { data: commit } = await ok.git.createCommit({
          owner,
          repo,
          message: "Initialize Graft comments branch",
          tree: tree.sha,
          parents: [],
        });

        await ok.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${COMMENTS_BRANCH}`,
          sha: commit.sha,
        });
      } else {
        throw err;
      }
    }
  }
}
