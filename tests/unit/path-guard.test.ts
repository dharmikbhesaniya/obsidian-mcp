import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { PathGuard } from "../../src/security/path-guard.js";
import { ErrorCode, ObsidianMcpError } from "../../src/schemas/errors.js";

describe("PathGuard", () => {
  let tempVaultDir: string;
  let guard: PathGuard;

  beforeEach(() => {
    tempVaultDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-mcp-test-vault-")));
    guard = new PathGuard(tempVaultDir);
  });

  afterEach(() => {
    fs.rmSync(tempVaultDir, { recursive: true, force: true });
  });

  it("should allow valid vault-relative paths", () => {
    const res = guard.resolveSafePath("notes/daily.md");
    expect(res.relativePath).toBe(path.join("notes", "daily.md"));
    expect(res.absolutePath).toBe(path.join(tempVaultDir, "notes", "daily.md"));
  });

  it("should reject leading slashes to enforce strictly vault-relative paths", () => {
    expect(() => guard.resolveSafePath("/notes/daily.md")).toThrowError(ObsidianMcpError);
    try {
      guard.resolveSafePath("/notes/daily.md");
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.PATH_INVALID);
    }
  });

  it("should reject directory traversal with ../", () => {
    expect(() => guard.resolveSafePath("../../../etc/passwd")).toThrowError(ObsidianMcpError);
    try {
      guard.resolveSafePath("../../../etc/passwd");
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.PATH_INVALID);
    }
  });

  it("should reject null byte injections", () => {
    expect(() => guard.resolveSafePath("notes/test\0.md")).toThrowError(ObsidianMcpError);
  });

  it("should reject symlink escapes pointing outside vault", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "outside-target-"));
    const outsideFile = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(outsideFile, "secret");

    const symlinkPath = path.join(tempVaultDir, "symlink-outside.txt");
    fs.symlinkSync(outsideFile, symlinkPath);

    expect(() => guard.resolveSafePath("symlink-outside.txt")).toThrowError(ObsidianMcpError);

    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
