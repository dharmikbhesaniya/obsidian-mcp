import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { ErrorCode, ObsidianMcpError } from "../../schemas/errors.js";

const execFileAsync = promisify(execFile);

export interface GitExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitAdapterOptions {
  binaryPath?: string;
  timeoutMs?: number;
  defaultAuthorName?: string;
  defaultAuthorEmail?: string;
}

// Banned flags and argument prefixes that could execute arbitrary commands or alter repository scope
const FORBIDDEN_ARG_PATTERNS = [
  /^--upload-pack/i,
  /^--receive-pack/i,
  /^-u$/i,
  /^--output/i,
  /^-c$/i,
  /^-c\s*core\./i,
  /^--config/i,
  /^--work-tree/i,
  /^--git-dir/i,
  /^--exec-path/i,
];

export function sanitizeGitOutput(text: string): string {
  if (!text) return "";
  // Redact embedded basic auth / tokens in URLs: https://user:pass@host or https://token@host
  return text.replace(/https?:\/\/[^@\s/]+@/g, "https://***@");
}

export class GitCliAdapter {
  private readonly binaryPath: string;
  private readonly timeoutMs: number;
  private readonly defaultAuthorName?: string;
  private readonly defaultAuthorEmail?: string;

  constructor(options: GitAdapterOptions = {}) {
    this.binaryPath = options.binaryPath || "git";
    this.timeoutMs = options.timeoutMs || 30000;
    this.defaultAuthorName = options.defaultAuthorName;
    this.defaultAuthorEmail = options.defaultAuthorEmail;
  }

  /**
   * Validates arguments against security denylists to prevent sandbox escapes and command injection.
   */
  public validateArgs(subcommand: string, args: string[]): void {
    if (subcommand.startsWith("-")) {
      throw new ObsidianMcpError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid Git subcommand '${subcommand}'. Subcommands cannot start with dashes.`,
        400
      );
    }

    for (const arg of args) {
      for (const pattern of FORBIDDEN_ARG_PATTERNS) {
        if (pattern.test(arg)) {
          throw new ObsidianMcpError(
            ErrorCode.FORBIDDEN,
            `Git argument '${arg}' is blocked by security policy for boundary isolation.`,
            403
          );
        }
      }
    }
  }

  /**
   * Executes a Git command strictly within the target vault root directory.
   */
  public async execute(
    vaultRoot: string,
    subcommand: string,
    args: string[] = [],
    envOverrides: Record<string, string> = {}
  ): Promise<GitExecutionResult> {
    const resolvedRoot = path.resolve(vaultRoot);
    if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
      throw new ObsidianMcpError(
        ErrorCode.NOT_FOUND,
        `Vault root directory '${resolvedRoot}' does not exist on disk.`,
        404
      );
    }

    this.validateArgs(subcommand, args);

    // Ceiling directory prevents git from traversing up to parent directories (e.g. /vault or host root)
    const ceilingDir = path.dirname(resolvedRoot);

    const fullArgs = [subcommand, ...args];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CEILING_DIRECTORIES: ceilingDir,
      ...envOverrides,
    };

    if (this.defaultAuthorName && !env.GIT_AUTHOR_NAME) {
      env.GIT_AUTHOR_NAME = this.defaultAuthorName;
      env.GIT_COMMITTER_NAME = this.defaultAuthorName;
    }
    if (this.defaultAuthorEmail && !env.GIT_AUTHOR_EMAIL) {
      env.GIT_AUTHOR_EMAIL = this.defaultAuthorEmail;
      env.GIT_COMMITTER_EMAIL = this.defaultAuthorEmail;
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.binaryPath, fullArgs, {
        cwd: resolvedRoot,
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env,
      });

      return {
        stdout: sanitizeGitOutput(stdout ? stdout.trim() : ""),
        stderr: sanitizeGitOutput(stderr ? stderr.trim() : ""),
        exitCode: 0,
      };
    } catch (err: any) {
      const sanitizedOut = sanitizeGitOutput(err.stdout ? String(err.stdout).trim() : "");
      const sanitizedErr = sanitizeGitOutput(err.stderr ? String(err.stderr).trim() : "");
      const rawMessage = sanitizedErr || sanitizedOut || err.message || "Git execution failed";

      if (rawMessage.includes("not a git repository")) {
        throw new ObsidianMcpError(
          ErrorCode.GIT_NOT_INITIALIZED,
          `The target directory is not an initialized Git repository (.git not found in vault root).`,
          400,
          { vaultRoot: resolvedRoot, subcommand }
        );
      }

      if (err.killed || err.code === "ETIMEDOUT") {
        throw new ObsidianMcpError(
          ErrorCode.GIT_ERROR,
          `Git command '${subcommand}' timed out after ${this.timeoutMs}ms.`,
          504,
          { subcommand, args }
        );
      }

      if (err.code === "ENOENT") {
        throw new ObsidianMcpError(
          ErrorCode.GIT_ERROR,
          `Git executable '${this.binaryPath}' not found in PATH or environment.`,
          503,
          { binaryPath: this.binaryPath }
        );
      }

      throw new ObsidianMcpError(
        ErrorCode.GIT_ERROR,
        `Git command failed: ${rawMessage}`,
        400,
        { subcommand, args, stderr: sanitizedErr, stdout: sanitizedOut }
      );
    }
  }

  /**
   * Checks whether the directory is inside an active Git work tree.
   */
  public async isGitRepo(vaultRoot: string): Promise<boolean> {
    try {
      const res = await this.execute(vaultRoot, "rev-parse", ["--is-inside-work-tree"]);
      return res.stdout === "true";
    } catch {
      return false;
    }
  }
}

