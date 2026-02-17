import * as vscode from "vscode";
import { GitHubAuth } from "./github/auth";
import { GitHubApi } from "./github/api";
import { EditorPanel } from "./EditorPanel";
import { parseGitHubUrl } from "./shared/url";
import { validateBranchName } from "./shared/validation";

let activePanel: EditorPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const auth = new GitHubAuth();
  const api = new GitHubApi(auth);

  const openCmd = vscode.commands.registerCommand("graft.open", async () => {
    const url = await vscode.window.showInputBox({
      title: "Graft — Open Document",
      prompt: "Paste a GitHub URL (file or PR)",
      placeHolder: "https://github.com/owner/repo/blob/main/docs/file.md",
      validateInput: (v) => {
        return parseGitHubUrl(v) ? null : "Enter a valid GitHub file or PR URL";
      },
    });

    if (!url) return;
    await auth.ensureSession();

    const parsed = parseGitHubUrl(url)!;
    let ctx: {
      owner: string;
      repo: string;
      branch: string;
      filePath: string;
      contentRef?: string;
      readOnly?: boolean;
    };

    if (parsed.type === "file") {
      const { branch, path: filePath } = await api.resolveRefAndPath(
        parsed.owner,
        parsed.repo,
        parsed.refAndPath,
      );
      const defaultBranch = await api.getDefaultBranch(
        parsed.owner,
        parsed.repo,
      );
      const isDefault = branch === defaultBranch;
      ctx = {
        owner: parsed.owner,
        repo: parsed.repo,
        branch,
        filePath,
        readOnly: isDefault,
      };
      if (isDefault) {
        const action = await vscode.window.showInformationMessage(
          `"${branch}" is the default branch. Create a new branch to edit?`,
          "Create Branch",
          "Open Read-Only",
        );
        if (action === "Create Branch") {
          const branchName = await vscode.window.showInputBox({
            title: "New Branch Name",
            prompt: "Enter a name for the new branch",
            placeHolder: `graft/${filePath.replace(/\//g, "-").replace(/\.md$/, "")}`,
            value: `graft/${filePath.replace(/\//g, "-").replace(/\.md$/, "")}`,
            validateInput: validateBranchName,
          });
          if (!branchName) return;
          await api.createBranch(parsed.owner, parsed.repo, branchName, branch);
          ctx.branch = branchName;
          ctx.readOnly = false;
          vscode.window.showInformationMessage(`Created branch "${branchName}".`);
        }
      }
    } else {
      // PR — list .md files and pick one
      const prDetails = await api.getPR(
        parsed.owner,
        parsed.repo,
        parsed.number,
      );
      const files = await api.getPRFiles(
        parsed.owner,
        parsed.repo,
        parsed.number,
      );
      const mdFiles = files.filter((f) => f.filename.endsWith(".md"));

      if (mdFiles.length === 0) {
        vscode.window.showInformationMessage(
          "No markdown files found in this PR.",
        );
        return;
      }

      let filePath: string;
      if (mdFiles.length === 1) {
        filePath = mdFiles[0].filename;
      } else {
        const picked = await vscode.window.showQuickPick(
          mdFiles.map((f) => ({ label: f.filename, description: f.status })),
          { title: "Select a markdown file" },
        );
        if (!picked) return;
        filePath = picked.label;
      }

      ctx = {
        owner: parsed.owner,
        repo: parsed.repo,
        branch: prDetails.head.ref,
        filePath,
      };

      if (prDetails.merged) {
        ctx.contentRef =
          prDetails.merge_commit_sha ?? prDetails.base.sha;
        ctx.readOnly = true;
        vscode.window.showInformationMessage(
          "This PR is merged. Opening in read-only mode.",
        );
      }
    }

    activePanel?.dispose();
    activePanel = await EditorPanel.create(api, ctx, context.extensionUri);
    context.subscriptions.push(activePanel);
  });

  context.subscriptions.push(openCmd);
}

export function deactivate() {
  activePanel?.dispose();
}

// URL parsing is now in src/shared/url.ts
