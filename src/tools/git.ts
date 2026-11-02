import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GitService } from "../services/git.service.js";
import * as GitSchemas from "../schemas/git.js";

export function registerGitTools(
  server: McpServer,
  gitService: GitService,
  wrapHandler: (toolName: string, fn: (args: any) => Promise<any>) => any
) {
  server.registerTool(
    "obsidian_git_status",
    {
      description: "Inspects Git repository status (branch, tracking, staged, modified, and untracked files) strictly within the vault boundary",
      inputSchema: GitSchemas.GitStatusSchema.shape,
    },
    wrapHandler("obsidian_git_status", (args) => gitService.status(args.vault))
  );

  server.registerTool(
    "obsidian_git_diff",
    {
      description: "Returns unified Git diff of unstaged or staged modifications in the vault or for a specific note",
      inputSchema: GitSchemas.GitDiffSchema.shape,
    },
    wrapHandler("obsidian_git_diff", (args) => gitService.diff(args.path, args.staged, args.vault))
  );

  server.registerTool(
    "obsidian_git_log",
    {
      description: "Returns commit history (hashes, authors, timestamps, and commit messages) for the vault or specific note",
      inputSchema: GitSchemas.GitLogSchema.shape,
    },
    wrapHandler("obsidian_git_log", (args) => gitService.log(args.maxCount, args.path, args.vault))
  );

  server.registerTool(
    "obsidian_git_add",
    {
      description: "Stages modified, added, or deleted files for the next Git commit within the vault",
      inputSchema: GitSchemas.GitAddSchema.shape,
    },
    wrapHandler("obsidian_git_add", (args) => gitService.add(args.paths, args.all, args.vault))
  );

  server.registerTool(
    "obsidian_git_commit",
    {
      description: "Creates a Git commit with a descriptive message and optional author attribution",
      inputSchema: GitSchemas.GitCommitSchema.shape,
    },
    wrapHandler("obsidian_git_commit", (args) =>
      gitService.commit(args.message, args.paths, args.author, args.vault)
    )
  );

  server.registerTool(
    "obsidian_git_push",
    {
      description: "Pushes committed vault changes to an upstream remote repository",
      inputSchema: GitSchemas.GitPushSchema.shape,
    },
    wrapHandler("obsidian_git_push", (args) =>
      gitService.push(args.remote, args.branch, args.setUpstream, args.vault)
    )
  );

  server.registerTool(
    "obsidian_git_pull",
    {
      description: "Pulls and merges changes from an upstream remote repository into the vault",
      inputSchema: GitSchemas.GitPullSchema.shape,
    },
    wrapHandler("obsidian_git_pull", (args) =>
      gitService.pull(args.remote, args.branch, args.rebase, args.vault)
    )
  );

  server.registerTool(
    "obsidian_git_exec",
    {
      description: "Executes an allowlisted Git subcommand strictly inside the vault boundary (requires vault:developer scope)",
      inputSchema: GitSchemas.GitExecSchema.shape,
    },
    wrapHandler("obsidian_git_exec", (args) =>
      gitService.exec(args.subcommand, args.args, args.vault)
    )
  );
}
