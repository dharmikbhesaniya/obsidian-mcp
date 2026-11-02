import path from "node:path";
import { VaultService, VaultInstance } from "./vault.service.js";
import { GitCliAdapter } from "../adapters/git/git.adapter.js";
import { ErrorCode, ObsidianMcpError } from "../schemas/errors.js";

const MUTATING_SUBCOMMANDS = new Set([
  "add",
  "commit",
  "push",
  "pull",
  "checkout",
  "merge",
  "reset",
  "rebase",
  "tag",
  "rm",
]);

export interface GitCommitEntry {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export class GitService {
  private readonly vaultService: VaultService;
  private readonly gitAdapter: GitCliAdapter;

  constructor(vaultService: VaultService, gitAdapter: GitCliAdapter) {
    this.vaultService = vaultService;
    this.gitAdapter = gitAdapter;
  }

  private resolveVault(vaultName?: string): VaultInstance {
    return this.vaultService.resolveVault(vaultName);
  }

  private assertWritable(vault: VaultInstance, toolName: string): void {
    if (vault.readOnly) {
      throw new ObsidianMcpError(
        ErrorCode.FORBIDDEN,
        `Vault '${vault.name}' is configured as read-only. Tool '${toolName}' is not permitted to modify this vault.`,
        403,
        { vault: vault.name, tool: toolName }
      );
    }
  }

  /**
   * Returns current branch, tracking information, staged, unstaged, and untracked files.
   */
  public async status(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const res = await this.gitAdapter.execute(vault.root, "status", ["--porcelain=v1", "-b"]);

    const lines = res.stdout.split("\n").filter((l) => l.trim().length > 0);
    let branch = "HEAD";
    let tracking: string | undefined;
    let ahead = 0;
    let behind = 0;

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      if (line.startsWith("##")) {
        // e.g. ## main...origin/main [ahead 1, behind 2] or ## Initial commit on main
        const header = line.slice(3).trim();
        const branchMatch = header.match(/^([^\s.]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.*)\])?/);
        if (branchMatch) {
          branch = branchMatch[1];
          tracking = branchMatch[2];
          const syncInfo = branchMatch[3] || "";
          const aheadMatch = syncInfo.match(/ahead\s+(\d+)/);
          const behindMatch = syncInfo.match(/behind\s+(\d+)/);
          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
          if (behindMatch) behind = parseInt(behindMatch[1], 10);
        }
      } else {
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.slice(3).trim();

        if (indexStatus !== " " && indexStatus !== "?") {
          staged.push(filePath);
        }
        if (workTreeStatus === "M" || workTreeStatus === "D") {
          modified.push(filePath);
        } else if (indexStatus === "?" && workTreeStatus === "?") {
          untracked.push(filePath);
        }
      }
    }

    const isClean = staged.length === 0 && modified.length === 0 && untracked.length === 0;

    return {
      vault: vault.name,
      vaultRoot: vault.root,
      branch,
      tracking,
      ahead,
      behind,
      isClean,
      stagedCount: staged.length,
      modifiedCount: modified.length,
      untrackedCount: untracked.length,
      staged,
      modified,
      untracked,
      summary: `Vault '${vault.name}' on branch '${branch}'. ${isClean ? "Working tree clean." : `${staged.length} staged, ${modified.length} modified, ${untracked.length} untracked.`}`,
    };
  }

  /**
   * Returns unified diff for a note or entire vault repository.
   */
  public async diff(targetPath?: string, staged: boolean = false, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const args: string[] = [];

    if (staged) {
      args.push("--cached");
    }

    if (targetPath) {
      const safe = vault.pathGuard.resolveSafePath(targetPath);
      args.push("--", safe.relativePath);
    }

    const res = await this.gitAdapter.execute(vault.root, "diff", args);
    const diffOutput = res.stdout;

    return {
      vault: vault.name,
      staged,
      path: targetPath || "all",
      hasChanges: diffOutput.length > 0,
      diff: diffOutput,
      summary: diffOutput.length > 0
        ? `Found changes in vault '${vault.name}' (${staged ? "staged" : "unstaged"}).`
        : `No ${staged ? "staged" : "unstaged"} differences found in vault '${vault.name}'.`,
    };
  }

  /**
   * Retrieves structured commit history.
   */
  public async log(maxCount: number = 10, targetPath?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const args: string[] = [
      "-n",
      String(Math.min(Math.max(maxCount, 1), 100)),
      "--pretty=format:%H%x00%an%x00%ae%x00%ad%x00%s",
    ];

    if (targetPath) {
      const safe = vault.pathGuard.resolveSafePath(targetPath);
      args.push("--", safe.relativePath);
    }

    const res = await this.gitAdapter.execute(vault.root, "log", args);
    const lines = res.stdout.split("\n").filter((l) => l.trim().length > 0);

    const commits: GitCommitEntry[] = [];
    for (const line of lines) {
      const parts = line.split("\x00");
      if (parts.length >= 5) {
        commits.push({
          hash: parts[0],
          author: parts[1],
          email: parts[2],
          date: parts[3],
          message: parts[4],
        });
      }
    }

    return {
      vault: vault.name,
      totalReturned: commits.length,
      path: targetPath,
      commits,
      summary: `Retrieved ${commits.length} commit(s) from vault '${vault.name}'.`,
    };
  }

  /**
   * Stages files for the next commit.
   */
  public async add(paths?: string[], all: boolean = false, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    this.assertWritable(vault, "obsidian_git_add");

    const args: string[] = [];
    if (all) {
      args.push("-A");
    } else if (paths && paths.length > 0) {
      args.push("--");
      for (const p of paths) {
        const safe = vault.pathGuard.resolveSafePath(p);
        args.push(safe.relativePath);
      }
    } else {
      throw new ObsidianMcpError(
        ErrorCode.VALIDATION_ERROR,
        "Specify 'paths' to stage or set 'all: true' to stage all modifications.",
        400
      );
    }

    await this.gitAdapter.execute(vault.root, "add", args);
    const statusRes = await this.status(vaultName);

    return {
      vault: vault.name,
      stagedCount: statusRes.stagedCount,
      stagedFiles: statusRes.staged,
      summary: `Successfully staged ${statusRes.stagedCount} file(s) in vault '${vault.name}'.`,
    };
  }

  /**
   * Commits staged changes.
   */
  public async commit(message: string, paths?: string[], author?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    this.assertWritable(vault, "obsidian_git_commit");

    if (paths && paths.length > 0) {
      await this.add(paths, false, vaultName);
    }

    const args = ["-m", message];
    if (author) {
      args.push(`--author=${author}`);
    }

    const res = await this.gitAdapter.execute(vault.root, "commit", args);
    const statusRes = await this.status(vaultName);

    return {
      vault: vault.name,
      committed: true,
      branch: statusRes.branch,
      message,
      output: res.stdout,
      summary: `Committed changes to vault '${vault.name}' on branch '${statusRes.branch}': "${message}".`,
    };
  }

  /**
   * Pushes committed changes to a remote repository.
   */
  public async push(remote: string = "origin", branch?: string, setUpstream: boolean = false, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    this.assertWritable(vault, "obsidian_git_push");

    const args: string[] = [];
    if (setUpstream) {
      args.push("-u");
    }
    args.push(remote);
    if (branch) {
      args.push(branch);
    }

    const res = await this.gitAdapter.execute(vault.root, "push", args);

    return {
      vault: vault.name,
      remote,
      branch: branch || "current",
      pushed: true,
      output: res.stderr || res.stdout || "Success",
      summary: `Pushed changes to ${remote}${branch ? `/${branch}` : ""} for vault '${vault.name}'.`,
    };
  }

  /**
   * Pulls changes from an upstream remote repository.
   */
  public async pull(remote: string = "origin", branch?: string, rebase: boolean = false, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    this.assertWritable(vault, "obsidian_git_pull");

    const args: string[] = [];
    if (rebase) {
      args.push("--rebase");
    }
    args.push(remote);
    if (branch) {
      args.push(branch);
    }

    const res = await this.gitAdapter.execute(vault.root, "pull", args);

    return {
      vault: vault.name,
      remote,
      branch: branch || "tracked",
      pulled: true,
      output: res.stdout || res.stderr || "Success",
      summary: `Pulled changes from ${remote}${branch ? `/${branch}` : ""} into vault '${vault.name}'.`,
    };
  }

  /**
   * Executes a guarded allowlisted Git subcommand strictly inside vault root.
   */
  public async exec(subcommand: string, args: string[] = [], vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    if (MUTATING_SUBCOMMANDS.has(subcommand.toLowerCase())) {
      this.assertWritable(vault, `obsidian_git_exec(${subcommand})`);
    }

    const res = await this.gitAdapter.execute(vault.root, subcommand, args);

    return {
      vault: vault.name,
      subcommand,
      args,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      summary: `Executed 'git ${subcommand}' in vault '${vault.name}'.`,
    };
  }
}
