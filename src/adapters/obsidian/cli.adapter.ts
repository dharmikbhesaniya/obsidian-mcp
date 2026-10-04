import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ErrorCode, ObsidianMcpError } from "../../schemas/errors.js";

const execFileAsync = promisify(execFile);

export interface CliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ObsidianCliAdapter {
  private readonly binaryPath: string;
  private readonly timeoutMs: number;

  constructor(binaryPath: string = "obsidian", timeoutMs: number = 15000) {
    this.binaryPath = binaryPath;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Executes a command via the official Obsidian CLI.
   */
  public async execute(subcommand: string, args: string[] = []): Promise<CliExecutionResult> {
    const fullArgs = [subcommand, ...args];

    try {
      const { stdout, stderr } = await execFileAsync(this.binaryPath, fullArgs, {
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: {
          ...process.env,
          // Support headless Linux display if configured
          DISPLAY: process.env.DISPLAY || ":5",
        },
      });

      const out = stdout ? stdout.trim() : "";
      const err = stderr ? stderr.trim() : "";

      // Critical silent failure guard: check if output contains Error: even if exit code is 0
      if (out.startsWith("Error:") || err.startsWith("Error:")) {
        const errorMsg = out.startsWith("Error:") ? out : err;
        throw new ObsidianMcpError(
          ErrorCode.OBSIDIAN_UNAVAILABLE,
          `Obsidian CLI returned failure: ${errorMsg}`,
          500,
          { command: subcommand, args }
        );
      }

      return {
        stdout: out,
        stderr: err,
        exitCode: 0,
      };
    } catch (err: any) {
      if (err instanceof ObsidianMcpError) {
        throw err;
      }

      if (err.killed || err.code === "ETIMEDOUT") {
        throw new ObsidianMcpError(
          ErrorCode.OBSIDIAN_UNAVAILABLE,
          `Obsidian CLI command timed out after ${this.timeoutMs}ms`,
          504,
          { command: subcommand }
        );
      }

      if (err.code === "ENOENT") {
        throw new ObsidianMcpError(
          ErrorCode.OBSIDIAN_UNAVAILABLE,
          `Obsidian CLI binary '${this.binaryPath}' not found in PATH or environment`,
          503,
          { binaryPath: this.binaryPath }
        );
      }

      throw new ObsidianMcpError(
        ErrorCode.OBSIDIAN_UNAVAILABLE,
        err.message || "Failed to execute Obsidian CLI command",
        500,
        { command: subcommand }
      );
    }
  }

  /**
   * Pings Obsidian CLI to verify IPC reachability.
   */
  public async checkReachability(): Promise<boolean> {
    try {
      const res = await this.execute("version");
      return res.stdout.length > 0;
    } catch {
      return false;
    }
  }
}
