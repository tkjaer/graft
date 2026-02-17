import { Octokit } from "@octokit/rest";
import { BaseGitHubApi } from "../shared/api";

export class WebGitHubApi extends BaseGitHubApi {
  private octokit: Octokit;

  constructor(token: string) {
    super();
    this.octokit = new Octokit({ auth: token });
  }

  protected async getOctokit(): Promise<Octokit> {
    return this.octokit;
  }

  protected encodeContent(content: string): string {
    return btoa(
      new TextEncoder()
        .encode(content)
        .reduce((s, b) => s + String.fromCharCode(b), ""),
    );
  }

  protected decodeContent(base64: string): string {
    const binaryStr = atob(base64.replace(/\n/g, ""));
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
}
