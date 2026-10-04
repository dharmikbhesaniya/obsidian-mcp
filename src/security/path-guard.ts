import path from "node:path";
import fs from "node:fs";
import { ErrorCode, ObsidianMcpError } from "../schemas/errors.js";

/**
 * PathGuard isolates all file operations strictly inside the configured vault root.
 */
export class PathGuard {
  private readonly vaultRoot: string;

  constructor(vaultRoot: string) {
    if (!vaultRoot) {
      throw new Error("PathGuard requires a non-empty vaultRoot");
    }
    const resolved = path.resolve(vaultRoot);
    this.vaultRoot = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  }

  /**
   * Resolves and validates a vault-relative path.
   * Throws ObsidianMcpError(PATH_INVALID) if the path is invalid or traverses outside the vault.
   */
  public resolveSafePath(inputPath: string): { relativePath: string; absolutePath: string } {
    if (!inputPath || typeof inputPath !== "string") {
      throw new ObsidianMcpError(ErrorCode.PATH_INVALID, "Path parameter must be a non-empty string", 400);
    }

    // Reject null byte injection
    if (inputPath.includes("\0")) {
      throw new ObsidianMcpError(ErrorCode.PATH_INVALID, "Null byte injection detected in path", 400);
    }

    // Strip leading slashes to enforce vault-relative interpretation
    const cleaned = inputPath.replace(/^[\/\\]+/, "");

    // Resolve absolute path against vault root
    const resolved = path.resolve(this.vaultRoot, cleaned);

    // Verify boundary: resolved path must start with vaultRoot + separator (or be exactly vaultRoot)
    const isInsideVault =
      resolved === this.vaultRoot || resolved.startsWith(this.vaultRoot + path.sep);

    if (!isInsideVault) {
      throw new ObsidianMcpError(
        ErrorCode.PATH_INVALID,
        `Path traversal detected. Path '${inputPath}' resolves outside permitted vault boundary.`,
        400,
        { inputPath }
      );
    }

    // Check for symlink traversal if file or parent exists
    try {
      if (fs.existsSync(resolved)) {
        const real = fs.realpathSync(resolved);
        const realIsInside =
          real === this.vaultRoot || real.startsWith(this.vaultRoot + path.sep);
        if (!realIsInside) {
          throw new ObsidianMcpError(
            ErrorCode.PATH_INVALID,
            `Symlink escape detected. Path points outside vault root.`,
            400,
            { inputPath }
          );
        }
      }
    } catch (err: any) {
      if (err instanceof ObsidianMcpError) throw err;
      // If path does not exist, proceed
    }

    const relative = path.relative(this.vaultRoot, resolved);
    return {
      relativePath: relative,
      absolutePath: resolved,
    };
  }

  /**
   * Returns the canonical vault root.
   */
  public getVaultRoot(): string {
    return this.vaultRoot;
  }
}
