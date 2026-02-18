import * as Y from "yjs";
import { Octokit } from "@octokit/rest";

const COMMENTS_BRANCH = "graft-comments";
const SAVE_DEBOUNCE_MS = parseInt(
  process.env.SAVE_DEBOUNCE_MS || "60000",
  10,
);

interface SaveState {
  fileSha: string;
  commentsSha: string | null;
  savedContent: string;
  timer: ReturnType<typeof setTimeout> | null;
  saving: boolean;
}

const saveStates = new Map<string, SaveState>();

/**
 * GitHub persistence layer for Y.Docs.
 * Loads markdown from GitHub into Y.Doc on first connect,
 * saves Y.Doc → markdown → commit on debounced idle + last disconnect.
 */
export class GraftPersistence {
  private getOctokit(token?: string): Octokit {
    return new Octokit({ auth: token || process.env.GITHUB_TOKEN });
  }

  private encodeContent(content: string): string {
    return Buffer.from(content).toString("base64");
  }

  /**
   * Called when a Y.Doc is first created for a room.
   * Loads the markdown content from GitHub and initializes the Y.Doc.
   */
  async loadDocument(
    roomName: string,
    doc: Y.Doc,
  ): Promise<void> {
    const { owner, repo, branch, path } = parseRoomId(roomName);
    const octokit = this.getOctokit();

    try {
      // Load file content
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      if (Array.isArray(data) || data.type !== "file") {
        throw new Error(`${path} is not a file`);
      }

      const content = Buffer.from(data.content, "base64").toString("utf-8");

      // Initialize Y.Doc with the markdown content
      // The Tiptap collaboration extension will parse this into ProseMirror nodes
      const meta = doc.getMap("meta");
      meta.set("sha", data.sha);
      meta.set("savedContent", content);
      meta.set("owner", owner);
      meta.set("repo", repo);
      meta.set("branch", branch);
      meta.set("path", path);
      meta.set("lastSaved", Date.now());

      // Store initial markdown in a Y.Text for the source pane / initial load
      const markdownText = doc.getText("markdown");
      markdownText.insert(0, content);

      // Initialize save state
      saveStates.set(roomName, {
        fileSha: data.sha,
        commentsSha: null,
        savedContent: content,
        timer: null,
        saving: false,
      });

      // Load comments
      await this.loadComments(roomName, doc, owner, repo, branch, path);

      console.log(
        `[persistence] Loaded ${path} from ${owner}/${repo}@${branch} (${content.length} bytes)`,
      );
    } catch (err: any) {
      if (err.status === 404) {
        console.log(
          `[persistence] File not found: ${path} on ${owner}/${repo}@${branch}`,
        );
        // Initialize empty doc
        const meta = doc.getMap("meta");
        meta.set("sha", "");
        meta.set("savedContent", "");
        meta.set("owner", owner);
        meta.set("repo", repo);
        meta.set("branch", branch);
        meta.set("path", path);

        saveStates.set(roomName, {
          fileSha: "",
          commentsSha: null,
          savedContent: "",
          timer: null,
          saving: false,
        });
      } else {
        throw err;
      }
    }
  }

  private async loadComments(
    roomName: string,
    doc: Y.Doc,
    owner: string,
    repo: string,
    branch: string,
    path: string,
  ): Promise<void> {
    const octokit = this.getOctokit();
    const commentsMap = doc.getMap("comments");

    try {
      const commentPath = `${branch}/${path}.comments.json`;
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: commentPath,
        ref: COMMENTS_BRANCH,
      });

      if (Array.isArray(data) || data.type !== "file") return;

      const content = Buffer.from(data.content, "base64").toString("utf-8");
      const comments = JSON.parse(content);

      if (Array.isArray(comments)) {
        for (const comment of comments) {
          if (comment.id) {
            commentsMap.set(comment.id, comment);
          }
        }
      }

      const state = saveStates.get(roomName);
      if (state) {
        state.commentsSha = data.sha;
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.error(`[persistence] Error loading comments for ${path}:`, err);
      }
    }
  }

  /**
   * Schedule a debounced save for a document.
   * Called whenever the Y.Doc is updated.
   */
  scheduleSave(roomName: string, doc: Y.Doc): void {
    const state = saveStates.get(roomName);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      this.saveDocument(roomName, doc).catch((err) =>
        console.error(`[persistence] Save error for ${roomName}:`, err),
      );
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Flush a document immediately (used during shutdown / last disconnect).
   */
  async flushDocument(roomName: string, doc: Y.Doc): Promise<void> {
    const state = saveStates.get(roomName);
    if (!state) return;

    // Clear any pending debounce timer
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    await this.saveDocument(roomName, doc);
  }

  /**
   * Save document content + comments to GitHub.
   */
  private async saveDocument(roomName: string, doc: Y.Doc): Promise<void> {
    const state = saveStates.get(roomName);
    if (!state || state.saving) return;

    state.saving = true;

    try {
      const meta = doc.getMap("meta");
      const owner = meta.get("owner") as string;
      const repo = meta.get("repo") as string;
      const branch = meta.get("branch") as string;
      const path = meta.get("path") as string;

      if (!owner || !repo || !branch || !path) {
        console.error(`[persistence] Missing metadata for ${roomName}`);
        return;
      }

      // Get current markdown content from the Y.Doc
      // The markdown text is kept in sync by the collaboration layer
      const markdownText = doc.getText("markdown");
      const currentContent = markdownText.toString();

      // Skip save if content hasn't changed
      if (currentContent === state.savedContent) {
        return;
      }

      const octokit = this.getOctokit();

      // Save document content
      try {
        const { data } = await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: `Update ${path} via Graft`,
          content: this.encodeContent(currentContent),
          sha: state.fileSha,
          branch,
        });

        state.fileSha = data.content?.sha ?? state.fileSha;
        state.savedContent = currentContent;
        meta.set("sha", state.fileSha);
        meta.set("savedContent", currentContent);
        meta.set("lastSaved", Date.now());

        console.log(`[persistence] Saved ${path} to ${owner}/${repo}@${branch}`);
      } catch (err: any) {
        if (err.status === 409) {
          console.warn(
            `[persistence] Conflict saving ${path}, will retry with merge`,
          );
          await this.handleConflict(roomName, doc, state);
        } else {
          throw err;
        }
      }

      // Save comments
      await this.saveComments(roomName, doc);
    } finally {
      state.saving = false;
    }
  }

  /**
   * Handle a 409 conflict by performing a 3-way merge.
   */
  private async handleConflict(
    roomName: string,
    doc: Y.Doc,
    state: SaveState,
  ): Promise<void> {
    const meta = doc.getMap("meta");
    const owner = meta.get("owner") as string;
    const repo = meta.get("repo") as string;
    const branch = meta.get("branch") as string;
    const path = meta.get("path") as string;
    const octokit = this.getOctokit();

    // Fetch the latest version from GitHub ("theirs")
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (Array.isArray(data) || data.type !== "file") {
      throw new Error("Conflict resolution failed: not a file");
    }

    const theirs = Buffer.from(data.content, "base64").toString("utf-8");
    const base = state.savedContent;
    const markdownText = doc.getText("markdown");
    const ours = markdownText.toString();

    // 3-way merge
    const { merge } = await import("node-diff3");
    const result = merge(ours, base, theirs);

    if (!result.conflict) {
      // Clean merge — save the merged result
      const merged = result.result.join("");

      const { data: saveData } =
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: `Update ${path} via Graft (merged)`,
          content: this.encodeContent(merged),
          sha: data.sha,
          branch,
        });

      state.fileSha = saveData.content?.sha ?? state.fileSha;
      state.savedContent = merged;
      meta.set("sha", state.fileSha);
      meta.set("savedContent", merged);

      // Update the Y.Doc with the merged content
      doc.transact(() => {
        markdownText.delete(0, markdownText.length);
        markdownText.insert(0, merged);
      });

      console.log(`[persistence] Auto-merged ${path} after conflict`);
    } else {
      // Conflict — log and let the next save attempt retry
      console.error(
        `[persistence] Merge conflict in ${path} — manual resolution needed`,
      );
      // Update the SHA so the next save attempt uses the latest
      state.fileSha = data.sha;
    }
  }

  /**
   * Save comments to the orphan branch.
   */
  private async saveComments(
    roomName: string,
    doc: Y.Doc,
  ): Promise<void> {
    const state = saveStates.get(roomName);
    if (!state) return;

    const meta = doc.getMap("meta");
    const owner = meta.get("owner") as string;
    const repo = meta.get("repo") as string;
    const branch = meta.get("branch") as string;
    const path = meta.get("path") as string;
    const commentsMap = doc.getMap("comments");

    // Convert Y.Map to array
    const comments: unknown[] = [];
    commentsMap.forEach((value, key) => {
      comments.push(value);
    });

    if (comments.length === 0 && !state.commentsSha) {
      return; // No comments to save and no existing file
    }

    const octokit = this.getOctokit();
    const commentPath = `${branch}/${path}.comments.json`;
    const content = JSON.stringify(comments, null, 2);

    try {
      await this.ensureCommentsBranch(octokit, owner, repo);

      if (state.commentsSha) {
        const { data } = await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: commentPath,
          message: `Update comments for ${path}`,
          content: this.encodeContent(content),
          sha: state.commentsSha,
          branch: COMMENTS_BRANCH,
        });
        state.commentsSha = data.content?.sha ?? state.commentsSha;
      } else {
        // Check if file exists
        try {
          const { data: existing } = await octokit.repos.getContent({
            owner,
            repo,
            path: commentPath,
            ref: COMMENTS_BRANCH,
          });
          if (!Array.isArray(existing) && existing.type === "file") {
            const { data } = await octokit.repos.createOrUpdateFileContents({
              owner,
              repo,
              path: commentPath,
              message: `Update comments for ${path}`,
              content: this.encodeContent(content),
              sha: existing.sha,
              branch: COMMENTS_BRANCH,
            });
            state.commentsSha = data.content?.sha ?? null;
          }
        } catch (err: any) {
          if (err.status === 404) {
            const { data } = await octokit.repos.createOrUpdateFileContents({
              owner,
              repo,
              path: commentPath,
              message: `Add comments for ${path}`,
              content: this.encodeContent(content),
              branch: COMMENTS_BRANCH,
            });
            state.commentsSha = data.content?.sha ?? null;
          } else {
            throw err;
          }
        }
      }
    } catch (err: any) {
      console.error(
        `[persistence] Error saving comments for ${path}:`,
        err.message,
      );
    }
  }

  private async ensureCommentsBranch(
    octokit: Octokit,
    owner: string,
    repo: string,
  ): Promise<void> {
    try {
      await octokit.request("GET /repos/{owner}/{repo}/git/ref/{+ref}", {
        owner,
        repo,
        ref: `heads/${COMMENTS_BRANCH}`,
      });
    } catch (err: any) {
      if (err.status === 404) {
        const { data: blob } = await octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(
            "This branch stores Graft comment data.\n",
          ).toString("base64"),
          encoding: "base64",
        });

        const { data: tree } = await octokit.git.createTree({
          owner,
          repo,
          tree: [
            { path: ".graft", mode: "100644", type: "blob", sha: blob.sha },
          ],
        });

        const { data: commit } = await octokit.git.createCommit({
          owner,
          repo,
          message: "Initialize Graft comments branch",
          tree: tree.sha,
          parents: [],
        });

        await octokit.git.createRef({
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

  /**
   * Called when the last user disconnects from a room.
   * Flushes and cleans up.
   */
  async onRoomEmpty(roomName: string, doc: Y.Doc): Promise<void> {
    await this.flushDocument(roomName, doc);
    saveStates.delete(roomName);
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function parseRoomId(roomId: string): {
  owner: string;
  repo: string;
  branch: string;
  path: string;
} {
  const parts = roomId.split("/");
  if (parts.length < 4) {
    throw new Error(`Invalid room ID: ${roomId}`);
  }
  return {
    owner: parts[0],
    repo: parts[1],
    branch: parts[2],
    path: parts.slice(3).join("/"),
  };
}
