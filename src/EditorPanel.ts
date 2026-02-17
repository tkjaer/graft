import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { GitHubApi } from "./github/api";
import type { DocComment } from "./types";

interface EditorContext {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  /** If set, read content at this ref (e.g. merge commit SHA) instead of branch */
  contentRef?: string;
  readOnly?: boolean;
}

export class EditorPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel;
  private fileSha = "";
  private commentsSha: string | undefined;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private api: GitHubApi,
    private ctx: EditorContext,
    extensionUri: vscode.Uri,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(extensionUri);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => this.dispose(),
      undefined,
      this.disposables,
    );
  }

  static async create(
    api: GitHubApi,
    ctx: EditorContext,
    extensionUri: vscode.Uri,
  ): Promise<EditorPanel> {
    const panel = vscode.window.createWebviewPanel(
      "graft.editor",
      `${path.basename(ctx.filePath)} — Graft`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );
    return new EditorPanel(panel, api, ctx, extensionUri);
  }

  private async onMessage(msg: any) {
    switch (msg.type) {
      case "ready":
        await this.initialize();
        break;
      case "save":
        await this.save(msg.markdown, msg.comments);
        break;
    }
  }

  private async initialize() {
    try {
      const ref = this.ctx.contentRef ?? this.ctx.branch;
      const file = await this.api.getFileContent(
        this.ctx.owner,
        this.ctx.repo,
        this.ctx.filePath,
        ref,
      );
      this.fileSha = file.sha;

      const commentsData = await this.api.getCommentsFile(
        this.ctx.owner,
        this.ctx.repo,
        this.ctx.branch,
        this.ctx.filePath,
      );
      if (commentsData) {
        this.commentsSha = commentsData.sha;
      }

      const user = await this.api.getCurrentUser();

      this.panel.webview.postMessage({
        type: "init",
        markdown: file.content,
        comments: commentsData?.comments ?? [],
        fileName: this.ctx.filePath,
        user: user.login,
        readOnly: this.ctx.readOnly ?? false,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Graft: ${err.message}`);
    }
  }

  private async save(markdown: string, comments: DocComment[]) {
    if (this.ctx.readOnly) return;

    if (typeof markdown !== "string" || !Array.isArray(comments)) {
      vscode.window.showErrorMessage("Graft: Invalid save payload");
      return;
    }

    try {
      // Commit the markdown file
      const result = await this.api.commitFile(
        this.ctx.owner,
        this.ctx.repo,
        this.ctx.filePath,
        markdown,
        this.fileSha,
        `Update ${this.ctx.filePath}`,
        this.ctx.branch,
      );
      this.fileSha = result.sha;

      // Save comments to the orphan branch
      if (comments.length > 0 || this.commentsSha) {
        const newSha = await this.api.saveCommentsFile(
          this.ctx.owner,
          this.ctx.repo,
          this.ctx.branch,
          this.ctx.filePath,
          comments,
          this.commentsSha,
        );
        this.commentsSha = newSha;
      }

      this.panel.webview.postMessage({ type: "saved" });
      vscode.window.setStatusBarMessage("Graft: Saved ✓", 3000);
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: "saveError",
        error: err.message,
      });
      vscode.window.showErrorMessage(`Graft: ${err.message}`);
    }
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview.css"),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      script-src 'nonce-${nonce}';
      style-src ${webview.cspSource} 'unsafe-inline';
      img-src ${webview.cspSource} https:;
      font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Graft</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.panel.dispose();
  }
}

function getNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}
