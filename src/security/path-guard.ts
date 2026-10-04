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
  public resolveSafePath(inputPath: string, allowReserved: boolean = false): { relativePath: string; absolutePath: string } {
    if (!inputPath || typeof inputPath !== "string") {
      throw new ObsidianMcpError(ErrorCode.PATH_INVALID, "Path parameter must be a non-empty string", 400);
    }

    // Reject null byte injection
    if (inputPath.includes("\0")) {
      throw new ObsidianMcpError(ErrorCode.PATH_INVALID, "Null byte injection detected in path", 400);
    }

    // Reject leading slashes to enforce strict vault-relative paths
    if (inputPath.startsWith("/") || inputPath.startsWith("\\")) {
      throw new ObsidianMcpError(
        ErrorCode.PATH_INVALID,
        `Path '${inputPath}' must be strictly vault-relative without leading slash or root indicator.`,
        400,
        { inputPath }
      );
    }

    const cleaned = inputPath;

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

    // Check for symlink traversal by verifying the nearest existing ancestor
    try {
      let currentCheck = resolved;
      while (currentCheck !== path.dirname(currentCheck) && !fs.existsSync(currentCheck)) {
        currentCheck = path.dirname(currentCheck);
      }

      if (fs.existsSync(currentCheck)) {
        const realAncestor = fs.realpathSync(currentCheck);
        const ancestorIsInside =
          realAncestor === this.vaultRoot || realAncestor.startsWith(this.vaultRoot + path.sep);
        if (!ancestorIsInside) {
          throw new ObsidianMcpError(
            ErrorCode.PATH_INVALID,
            `Symlink escape detected. Ancestor directory resolves outside vault root.`,
            400,
            { inputPath, nearestAncestor: currentCheck }
          );
        }
      }
    } catch (err: any) {
      if (err instanceof ObsidianMcpError) throw err;
      // If filesystem check fails unexpectedly, bubble up error
      throw new ObsidianMcpError(
        ErrorCode.PATH_INVALID,
        `Failed to verify path safety: ${err.message}`,
        400,
        { inputPath }
      );
    }

    const relative = path.relative(this.vaultRoot, resolved);

    // Hardblock access to reserved internal directories (.obsidian, .obsidian-mcp, .git, .trash)
    if (!allowReserved) {
      const normalizedSegments = relative.split(path.sep);
      const isReserved = normalizedSegments.some(
        (seg) =>
          seg === ".obsidian" ||
          seg === ".obsidian-mcp" ||
          seg === ".git" ||
          seg === ".trash"
      );
      if (isReserved) {
        throw new ObsidianMcpError(
          ErrorCode.FORBIDDEN,
          `Access to reserved internal directory '${inputPath}' is restricted.`,
          403,
          { inputPath }
        );
      }
    }

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
