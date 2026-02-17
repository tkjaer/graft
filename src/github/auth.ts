import * as vscode from "vscode";

export class GitHubAuth {
  private token: string | undefined;

  async ensureSession(): Promise<void> {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: true,
    });
    this.token = session.accessToken;
  }

  async requireToken(): Promise<string> {
    if (!this.token) await this.ensureSession();
    if (!this.token) throw new Error("GitHub authentication required");
    return this.token;
  }
}
