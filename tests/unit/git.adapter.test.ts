import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { GitCliAdapter, sanitizeGitOutput } from "../../src/adapters/git/git.adapter.js";
import { ObsidianMcpError, ErrorCode } from "../../src/schemas/errors.js";

describe("GitCliAdapter Unit Tests", () => {
  const adapter = new GitCliAdapter({
    binaryPath: "git",
    timeoutMs: 5000,
  });

  describe("sanitizeGitOutput", () => {
    it("should redact embedded basic authentication tokens in URLs", () => {
      const raw = "fatal: Authentication failed for 'https://ghp_secretToken12345@github.com/org/repo.git'";
      const sanitized = sanitizeGitOutput(raw);
      expect(sanitized).toBe("fatal: Authentication failed for 'https://***@github.com/org/repo.git'");
    });

    it("should redact username and password credentials in URLs", () => {
      const raw = "Fetch URL: https://developer:SuperSecretPass@gitlab.com/project.git";
      const sanitized = sanitizeGitOutput(raw);
      expect(sanitized).toBe("Fetch URL: https://***@gitlab.com/project.git");
    });

    it("should leave public non-credentialed URLs unchanged", () => {
      const raw = "origin https://github.com/owner/vault.git (fetch)";
      expect(sanitizeGitOutput(raw)).toBe(raw);
    });
  });

  describe("validateArgs & Security Denylist", () => {
    it("should reject subcommands that begin with dashes", () => {
      expect(() => adapter.validateArgs("-v", [])).toThrowError(ObsidianMcpError);
      expect(() => adapter.validateArgs("--version", [])).toThrowError(ObsidianMcpError);
    });

    it("should reject dangerous --upload-pack flag", () => {
      expect(() => adapter.validateArgs("fetch", ["--upload-pack=malicious"])).toThrowError(ObsidianMcpError);
    });

    it("should reject arbitrary -c configuration override flags", () => {
      expect(() => adapter.validateArgs("status", ["-c", "core.editor=malicious"])).toThrowError(ObsidianMcpError);
      expect(() => adapter.validateArgs("status", ["-c core.fsmonitor=malicious"])).toThrowError(ObsidianMcpError);
    });

    it("should reject --work-tree and --git-dir escape attempts", () => {
      expect(() => adapter.validateArgs("status", ["--work-tree=/etc"])).toThrowError(ObsidianMcpError);
      expect(() => adapter.validateArgs("status", ["--git-dir=/root/.git"])).toThrowError(ObsidianMcpError);
    });

    it("should permit standard safe arguments", () => {
      expect(() => adapter.validateArgs("status", ["--porcelain=v1", "-b"])).not.toThrow();
      expect(() => adapter.validateArgs("diff", ["--cached", "--", "Notes/Daily.md"])).not.toThrow();
      expect(() => adapter.validateArgs("log", ["-n", "10"])).not.toThrow();
    });
  });

  describe("Directory Verification", () => {
    it("should throw NOT_FOUND if vault directory does not exist on disk", async () => {
      const fakeDir = path.join(os.tmpdir(), "non-existent-vault-dir-" + Date.now());
      await expect(adapter.execute(fakeDir, "status")).rejects.toThrowError(
        /does not exist on disk/i
      );
    });

    it("should throw GIT_NOT_INITIALIZED when executing in a non-git directory", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-vault-"));
      try {
        await expect(adapter.execute(tempDir, "status")).rejects.toThrowError(
          /not an initialized Git repository/i
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
