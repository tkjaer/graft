import { Octokit } from "@octokit/rest";
import { GitHubAuth } from "./auth";
import { BaseGitHubApi } from "../shared/api";

export class GitHubApi extends BaseGitHubApi {
  private _octokit: Octokit | undefined;

  constructor(private auth: GitHubAuth) {
    super();
  }

  protected async getOctokit(): Promise<Octokit> {
    if (this._octokit) return this._octokit;
    const token = await this.auth.requireToken();
    this._octokit = new Octokit({ auth: token });
    return this._octokit;
  }

  protected encodeContent(content: string): string {
    return Buffer.from(content).toString("base64");
  }

  protected decodeContent(base64: string): string {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
}
