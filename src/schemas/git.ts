import { z } from "zod";
import { VaultRelativePathSchema } from "./common.js";
import { VaultNameSchema } from "./tools.js";

export const GitStatusSchema = z.object({
  vault: VaultNameSchema,
});

export const GitDiffSchema = z.object({
  path: VaultRelativePathSchema.optional().describe("Optional path relative to vault root to diff a specific note or folder"),
  staged: z.boolean().default(false).describe("If true, shows diff of staged changes against HEAD. Defaults to unstaged working tree diff."),
  vault: VaultNameSchema,
});

export const GitLogSchema = z.object({
  maxCount: z.number().int().min(1).max(100).default(10).describe("Maximum number of commit history entries to retrieve (default: 10, max: 100)"),
  path: VaultRelativePathSchema.optional().describe("Optional path relative to vault root to inspect history of a specific note"),
  vault: VaultNameSchema,
});

export const GitAddSchema = z.object({
  paths: z.array(VaultRelativePathSchema).optional().describe("Specific note or folder paths relative to vault root to stage"),
  all: z.boolean().default(false).describe("If true, stages all modifications, additions, and deletions in the vault (`git add -A`)"),
  vault: VaultNameSchema,
});

export const GitCommitSchema = z.object({
  message: z.string().min(1, "Commit message cannot be empty").describe("Descriptive commit message documenting changes"),
  paths: z.array(VaultRelativePathSchema).optional().describe("Optional specific paths to stage before committing"),
  author: z.string().optional().describe("Optional author override in 'Name <email@example.com>' format"),
  vault: VaultNameSchema,
});

export const GitPushSchema = z.object({
  remote: z.string().default("origin").describe("Name of the remote repository to push to (default: 'origin')"),
  branch: z.string().optional().describe("Branch name to push (defaults to currently checked-out branch)"),
  setUpstream: z.boolean().default(false).describe("If true, sets upstream tracking reference (`-u`)"),
  vault: VaultNameSchema,
});

export const GitPullSchema = z.object({
  remote: z.string().default("origin").describe("Name of the remote repository to pull from (default: 'origin')"),
  branch: z.string().optional().describe("Branch name to pull (defaults to upstream tracked branch)"),
  rebase: z.boolean().default(false).describe("If true, performs rebase pull (`--rebase`)"),
  vault: VaultNameSchema,
});

export const GitExecAllowedSubcommands = [
  "status",
  "diff",
  "log",
  "add",
  "commit",
  "push",
  "pull",
  "branch",
  "checkout",
  "stash",
  "fetch",
  "reset",
  "show",
  "tag",
  "rev-parse",
] as const;

export const GitExecSchema = z.object({
  subcommand: z.enum(GitExecAllowedSubcommands).describe("Allowlisted Git subcommand to execute inside vault boundary"),
  args: z.array(z.string()).default([]).describe("Additional arguments passed to the Git subcommand"),
  vault: VaultNameSchema,
});

