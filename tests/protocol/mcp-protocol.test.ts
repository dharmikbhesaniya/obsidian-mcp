import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createMcpServer } from "../../src/server.js";
import { AppConfig } from "../../src/config/config.js";

describe("MCP Protocol & Capability Registration", () => {
  let tempVaultDir: string;
  let testConfig: AppConfig;

  beforeEach(() => {
    tempVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-protocol-test-"));
    testConfig = {
      OBSIDIAN_VAULT_PATH: tempVaultDir,
      OBSIDIAN_BIN_PATH: "mock-obsidian",
      AUTH_ENABLED: false,
      RATE_LIMIT_PER_MINUTE: 100,
      PORT: 3000,
      HOST: "127.0.0.1",
      LOG_LEVEL: "info",
      COMMAND_TIMEOUT_MS: 5000,
      AUDIT_LOG_ENABLED: false,
    };
  });

  afterEach(() => {
    fs.rmSync(tempVaultDir, { recursive: true, force: true });
  });

  it("should initialize McpServer and register all expected domains", () => {
    const { server, vaultService, pathGuard, authManager } = createMcpServer(testConfig);
    expect(server).toBeDefined();
    expect(vaultService).toBeDefined();
    expect(pathGuard).toBeDefined();
    expect(authManager).toBeDefined();
  });

  it("should verify vault operations via created server instance", async () => {
    const { vaultService } = createMcpServer(testConfig);

    const vaultMeta = await vaultService.getVault();
    expect(vaultMeta.status).toBe("connected");
    expect(vaultMeta.totalFiles).toBe(0);

    await vaultService.createNote("index.md", "# Welcome to Knowledge Base");
    const note = await vaultService.readNote("index.md");
    expect(note.content).toContain("Welcome to Knowledge Base");

    const updatedVaultMeta = await vaultService.getVault();
    expect(updatedVaultMeta.totalFiles).toBe(1);
  });
});
