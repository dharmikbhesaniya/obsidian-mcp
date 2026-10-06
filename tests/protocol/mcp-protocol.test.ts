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
      NODE_ENV: "test",
      MCP_TRANSPORT: "stdio",
      OBSIDIAN_VAULT_PATH: tempVaultDir,
      OBSIDIAN_BIN_PATH: "mock-obsidian",
      AUTH_ENABLED: false,
      READ_ONLY: false,
      AUDIT_LOG_ENABLED: false,
      RATE_LIMIT_PER_MINUTE: 100,
      MAX_SEARCH_RESULTS: 50,
      COMMAND_TIMEOUT_MS: 5000,
      ENABLE_ADVANCED_CLI: false,
      ENABLE_DESTRUCTIVE_TOOLS: true,
      PORT: 3000,
      HOST: "127.0.0.1",
      LOG_LEVEL: "info",
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
    expect(vaultMeta.status).toBe("degraded");
    expect(vaultMeta.vaultAccessible).toBe(true);
    expect(vaultMeta.obsidianCli).toBe("unavailable");
    expect(vaultMeta.totalFiles).toBe(0);

    await vaultService.createNote("index.md", "# Welcome to Knowledge Base");
    const note = await vaultService.readNote("index.md");
    expect(note.content).toContain("Welcome to Knowledge Base");

    const updatedVaultMeta = await vaultService.getVault();
    expect(updatedVaultMeta.totalFiles).toBe(1);
  });

  it("should conditionally register tools based on feature flags", () => {
    // 1. Default config (ENABLE_ADVANCED_CLI not true, ENABLE_DESTRUCTIVE_TOOLS !== false)
    const { server: serverDefault } = createMcpServer(testConfig);
    const defaultToolNames = Object.keys((serverDefault as any)._registeredTools || {});
    expect(defaultToolNames).toContain("obsidian_delete_note");
    expect(defaultToolNames).toContain("obsidian_move_note");
    expect(defaultToolNames).not.toContain("obsidian_cli");

    // 2. ENABLE_ADVANCED_CLI: true
    const { server: serverWithCli } = createMcpServer({
      ...testConfig,
      ENABLE_ADVANCED_CLI: true,
    });
    const cliToolNames = Object.keys((serverWithCli as any)._registeredTools || {});
    expect(cliToolNames).toContain("obsidian_cli");

    // 3. ENABLE_DESTRUCTIVE_TOOLS: false
    const { server: serverSafe } = createMcpServer({
      ...testConfig,
      ENABLE_DESTRUCTIVE_TOOLS: false,
    });
    const safeToolNames = Object.keys((serverSafe as any)._registeredTools || {});
    expect(safeToolNames).not.toContain("obsidian_delete_note");
    expect(safeToolNames).not.toContain("obsidian_move_note");
  });
});
