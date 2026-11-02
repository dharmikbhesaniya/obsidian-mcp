import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createMcpServer } from "../../src/server.js";
import { ObsidianMcpError, ErrorCode } from "../../src/schemas/errors.js";

describe("Git Tools & Sandboxed Execution Integration", () => {
  let tempBaseDir: string;
  let gitVaultDir: string;
  let readOnlyVaultDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-git-test-"));
    gitVaultDir = path.join(tempBaseDir, "primary-git-vault");
    readOnlyVaultDir = path.join(tempBaseDir, "immutable-archive-vault");

    fs.mkdirSync(gitVaultDir, { recursive: true });
    fs.mkdirSync(readOnlyVaultDir, { recursive: true });

    // Initialize git repository in gitVaultDir
    execFileSync("git", ["init", "-b", "main"], { cwd: gitVaultDir });
    execFileSync("git", ["config", "user.name", "Test Agent"], { cwd: gitVaultDir });
    execFileSync("git", ["config", "user.email", "agent@test.local"], { cwd: gitVaultDir });

    // Initial commit
    fs.writeFileSync(path.join(gitVaultDir, "README.md"), "# Knowledge Vault\nInitial document.");
    execFileSync("git", ["add", "-A"], { cwd: gitVaultDir });
    execFileSync("git", ["commit", "-m", "Initial repository setup"], { cwd: gitVaultDir });

    // Initialize git in read-only vault as well
    execFileSync("git", ["init", "-b", "main"], { cwd: readOnlyVaultDir });
    execFileSync("git", ["config", "user.name", "Archive Bot"], { cwd: readOnlyVaultDir });
    execFileSync("git", ["config", "user.email", "archive@test.local"], { cwd: readOnlyVaultDir });
    fs.writeFileSync(path.join(readOnlyVaultDir, "Archive.md"), "# Archive\nImmutable notes.");
    execFileSync("git", ["add", "-A"], { cwd: readOnlyVaultDir });
    execFileSync("git", ["commit", "-m", "Archive initialization"], { cwd: readOnlyVaultDir });
  });

  afterEach(() => {
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  it("should return clean status when repository has no pending changes", async () => {
    const { gitService } = createMcpServer({
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULTS: `primary=${gitVaultDir}:rw,archive=${readOnlyVaultDir}:ro`,
      OBSIDIAN_DEFAULT_VAULT: "primary",
      AUTH_ENABLED: false,
    });

    const status = await gitService.status("primary");
    expect(status.branch).toBe("main");
    expect(status.isClean).toBe(true);
    expect(status.stagedCount).toBe(0);
    expect(status.modifiedCount).toBe(0);
    expect(status.untrackedCount).toBe(0);
  });

  it("should detect modified and untracked files accurately", async () => {
    const { gitService } = createMcpServer({
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULTS: `primary=${gitVaultDir}:rw`,
      OBSIDIAN_DEFAULT_VAULT: "primary",
      AUTH_ENABLED: false,
    });

    // Create untracked file and modify existing file
    fs.writeFileSync(path.join(gitVaultDir, "NewNote.md"), "# New Note Content");
    fs.appendFileSync(path.join(gitVaultDir, "README.md"), "\nAppended line.");

    const status = await gitService.status("primary");
    expect(status.isClean).toBe(false);
    expect(status.untracked).toContain("NewNote.md");
    expect(status.modified).toContain("README.md");
  });

  it("should stage and commit changes strictly within the vault", async () => {
    const { gitService } = createMcpServer({
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULTS: `primary=${gitVaultDir}:rw`,
      OBSIDIAN_DEFAULT_VAULT: "primary",
      AUTH_ENABLED: false,
    });

    fs.writeFileSync(path.join(gitVaultDir, "Research.md"), "# Deep Research Findings");

    // Stage file
    const addRes = await gitService.add(["Research.md"], false, "primary");
    expect(addRes.stagedCount).toBe(1);
    expect(addRes.stagedFiles).toContain("Research.md");

    // Commit change
    const commitRes = await gitService.commit("feat: add research findings", undefined, undefined, "primary");
    expect(commitRes.committed).toBe(true);
    expect(commitRes.message).toBe("feat: add research findings");

    // Verify via git log
    const logRes = await gitService.log(5, undefined, "primary");
    expect(logRes.commits.length).toBeGreaterThanOrEqual(2);
    expect(logRes.commits[0].message).toBe("feat: add research findings");
  });

  it("should return diff for staged and unstaged changes", async () => {
    const { gitService } = createMcpServer({
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULTS: `primary=${gitVaultDir}:rw`,
      OBSIDIAN_DEFAULT_VAULT: "primary",
      AUTH_ENABLED: false,
    });

    fs.appendFileSync(path.join(gitVaultDir, "README.md"), "\nSecond paragraph update.");

    const diffUnstaged = await gitService.diff("README.md", false, "primary");
    expect(diffUnstaged.hasChanges).toBe(true);
    expect(diffUnstaged.diff).toContain("+Second paragraph update.");

    // Stage the file and check staged diff
    await gitService.add(["README.md"], false, "primary");
    const diffStaged = await gitService.diff("README.md", true, "primary");
    expect(diffStaged.hasChanges).toBe(true);
    expect(diffStaged.diff).toContain("+Second paragraph update.");
  });

  it("should permit read-only git operations on read-only vaults while rejecting mutations with 403", async () => {
    const { gitService } = createMcpServer({
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULTS: `primary=${gitVaultDir}:rw,archive=${readOnlyVaultDir}:ro`,
      OBSIDIAN_DEFAULT_VAULT: "primary",
      AUTH_ENABLED: false,
    });

    // Read operations should succeed on read-only vault
    const status = await gitService.status("archive");
    expect(status.branch).toBe("main");

    const logRes = await gitService.log(5, undefined, "archive");
    expect(logRes.commits.length).toBe(1);

    // Mutation operations on read-only vault MUST throw 403 FORBIDDEN
    await expect(gitService.add(["Archive.md"], false, "archive")).rejects.toThrowError(
      /configured as read-only/i
    );

    await expect(gitService.commit("illegal mutation", undefined, undefined, "archive")).rejects.toThrowError(
      /configured as read-only/i
    );

    await expect(gitService.push("origin", "main", false, "archive")).rejects.toThrowError(
      /configured as read-only/i
    );
  });

  it("should block path traversal attempts outside vault root", async () => {
    const { gitService } = createMcpServer({
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULTS: `primary=${gitVaultDir}:rw`,
      OBSIDIAN_DEFAULT_VAULT: "primary",
      AUTH_ENABLED: false,
    });

    // Attempting to stage files outside the vault using relative traversal
    await expect(gitService.add(["../../etc/passwd"], false, "primary")).rejects.toThrowError(
      ObsidianMcpError
    );

    await expect(gitService.diff("../outside.txt", false, "primary")).rejects.toThrowError(
      ObsidianMcpError
    );
  });

  it("should resolve colloquial vault aliases for Git operations", async () => {
    const { gitService } = createMcpServer({
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULTS: `dharmik-professional-obsidian-vault=${gitVaultDir}:rw`,
      OBSIDIAN_VAULT_ALIASES: "daily=dharmik-professional-obsidian-vault,work=dharmik-professional-obsidian-vault",
      OBSIDIAN_DEFAULT_VAULT: "dharmik-professional-obsidian-vault",
      AUTH_ENABLED: false,
    });

    // Colloquial alias "daily" and "work" should route to the vault
    const statusDaily = await gitService.status("daily");
    expect(statusDaily.vault).toBe("dharmik-professional-obsidian-vault");

    const statusWork = await gitService.status("work");
    expect(statusWork.vault).toBe("dharmik-professional-obsidian-vault");

    // Inferred alias "professional" should route automatically
    const statusPro = await gitService.status("professional");
    expect(statusPro.vault).toBe("dharmik-professional-obsidian-vault");
  });

  it("should execute allowlisted subcommands via exec within the vault", async () => {
    const { gitService } = createMcpServer({
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULTS: `primary=${gitVaultDir}:rw`,
      OBSIDIAN_DEFAULT_VAULT: "primary",
      AUTH_ENABLED: false,
    });

    const branchRes = await gitService.exec("branch", ["--list"], "primary");
    expect(branchRes.stdout).toContain("main");
  });
});

