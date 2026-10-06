import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { VaultService } from "../../src/services/vault.service.js";
import { ObsidianCliAdapter } from "../../src/adapters/obsidian/cli.adapter.js";
import { parseVaultsConfig } from "../../src/config/config.js";
import { ObsidianMcpError, ErrorCode } from "../../src/schemas/errors.js";
import { Scope } from "../../src/config/scopes.js";
import { createMcpServer } from "../../src/server.js";

describe("Multi-Vault Architecture & Isolation", () => {
  let tempBaseDir: string;
  let personalVaultDir: string;
  let workVaultDir: string;
  let cliAdapter: ObsidianCliAdapter;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-multi-test-"));
    personalVaultDir = path.join(tempBaseDir, "personal-vault");
    workVaultDir = path.join(tempBaseDir, "work-vault");

    fs.mkdirSync(personalVaultDir, { recursive: true });
    fs.mkdirSync(workVaultDir, { recursive: true });

    // Seed notes in both vaults
    fs.writeFileSync(path.join(personalVaultDir, "Journal.md"), "# Personal Journal\nMy thoughts.");
    fs.writeFileSync(path.join(workVaultDir, "Project-Alpha.md"), "# Project Alpha\nConfidential work specs.");

    cliAdapter = new ObsidianCliAdapter("non-existent-obsidian-binary", 1000);
  });

  afterEach(() => {
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  describe("parseVaultsConfig", () => {
    it("should parse single vault path into a default vault", () => {
      const parsed = parseVaultsConfig("/path/to/my-vault");
      expect(parsed.vaults).toEqual({ "my-vault": "/path/to/my-vault" });
      expect(parsed.defaultVault).toBe("my-vault");
    });

    it("should parse JSON dictionary format", () => {
      const input = JSON.stringify({
        personal: "/path/to/personal",
        work: "/path/to/work",
      });
      const parsed = parseVaultsConfig(undefined, input, "work");
      expect(parsed.vaults).toEqual({
        personal: "/path/to/personal",
        work: "/path/to/work",
      });
      expect(parsed.defaultVault).toBe("work");
    });

    it("should parse comma-separated key-value pairs", () => {
      const input = "personal=/path/to/personal,work=/path/to/work";
      const parsed = parseVaultsConfig(undefined, input);
      expect(parsed.vaults).toEqual({
        personal: "/path/to/personal",
        work: "/path/to/work",
      });
      expect(parsed.defaultVault).toBe("personal");
    });

    it("should parse :ro and :rw suffixes in comma-separated pairs", () => {
      const input = "personal=/path/to/personal:ro,work=/path/to/work:rw";
      const parsed = parseVaultsConfig(undefined, input);
      expect(parsed.vaults).toEqual({
        personal: "/path/to/personal",
        work: "/path/to/work",
      });
      expect(parsed.vaultDefinitions.personal.readOnly).toBe(true);
      expect(parsed.vaultDefinitions.personal.scopes).toEqual([Scope.VAULT_READ]);
      expect(parsed.vaultDefinitions.work.readOnly).toBe(false);
    });

    it("should parse OBSIDIAN_READ_ONLY_VAULTS parameter", () => {
      const input = "personal=/path/to/personal,work=/path/to/work";
      const parsed = parseVaultsConfig(undefined, input, "work", "personal");
      expect(parsed.vaultDefinitions.personal.readOnly).toBe(true);
      expect(parsed.vaultDefinitions.work.readOnly).toBe(false);
    });

    it("should parse JSON dictionary format with readOnly and scopes", () => {
      const input = JSON.stringify({
        personal: { path: "/path/to/personal", readOnly: true },
        work: { path: "/path/to/work", scopes: ["vault:read", "vault:write"] },
      });
      const parsed = parseVaultsConfig(undefined, input);
      expect(parsed.vaults).toEqual({
        personal: "/path/to/personal",
        work: "/path/to/work",
      });
      expect(parsed.vaultDefinitions.personal.readOnly).toBe(true);
      expect(parsed.vaultDefinitions.work.readOnly).toBe(false);
      expect(parsed.vaultDefinitions.work.scopes).toEqual(["vault:read", "vault:write"]);
    });

    it("should parse object input directly", () => {
      const parsed = parseVaultsConfig(undefined, {
        research: "/path/to/research",
      });
      expect(parsed.vaults).toEqual({
        research: "/path/to/research",
      });
      expect(parsed.defaultVault).toBe("research");
    });
  });

  describe("VaultService Multi-Vault Operations", () => {
    it("should list all configured vaults with accurate file counts", async () => {
      const service = new VaultService(
        {
          personal: personalVaultDir,
          work: workVaultDir,
        },
        cliAdapter,
        undefined,
        "work"
      );

      const res = await service.listVaults();
      expect(res.defaultVault).toBe("work");
      expect(res.totalVaults).toBe(2);

      const names = res.vaults.map((v) => v.name);
      expect(names).toContain("personal");
      expect(names).toContain("work");

      const workVault = res.vaults.find((v) => v.name === "work");
      expect(workVault?.isDefault).toBe(true);
      expect(workVault?.totalFiles).toBe(1);

      const personalVault = res.vaults.find((v) => v.name === "personal");
      expect(personalVault?.isDefault).toBe(false);
      expect(personalVault?.totalFiles).toBe(1);
    });

    it("should default to active default vault when vault parameter is omitted", async () => {
      const service = new VaultService(
        {
          personal: personalVaultDir,
          work: workVaultDir,
        },
        cliAdapter,
        undefined,
        "work"
      );

      // Default vault is "work" -> reads Project-Alpha.md
      const note = await service.readNote("Project-Alpha.md");
      expect(note.content).toContain("# Project Alpha");

      // Default vault does NOT have Journal.md
      await expect(service.readNote("Journal.md")).rejects.toThrowError(ObsidianMcpError);
    });

    it("should access specific vault when vault parameter is provided", async () => {
      const service = new VaultService(
        {
          personal: personalVaultDir,
          work: workVaultDir,
        },
        cliAdapter,
        undefined,
        "work"
      );

      // Explicitly target personal vault
      const personalNote = await service.readNote("Journal.md", false, "personal");
      expect(personalNote.content).toContain("# Personal Journal");
      expect(personalNote.obsidianUri).toContain("vault=personal");

      // Explicitly target work vault
      const workNote = await service.readNote("Project-Alpha.md", false, "work");
      expect(workNote.content).toContain("# Project Alpha");
      expect(workNote.obsidianUri).toContain("vault=work");
    });

    it("should strictly isolate mutations between separate vaults", async () => {
      const service = new VaultService(
        {
          personal: personalVaultDir,
          work: workVaultDir,
        },
        cliAdapter
      );

      // Create a note in personal vault
      await service.createNote("Secret.md", "Secret personal notes", undefined, false, undefined, "personal");

      // Verify it exists in personal
      const inPersonal = await service.readNote("Secret.md", false, "personal");
      expect(inPersonal.content).toBe("Secret personal notes");

      // Verify it does NOT exist in work vault
      await expect(service.readNote("Secret.md", false, "work")).rejects.toThrowError(ObsidianMcpError);

      // Search in work vault should not find personal notes
      const searchWork = await service.search("Secret", 10, "work");
      expect(searchWork.matches).toHaveLength(0);

      // Search in personal vault should find the note
      const searchPersonal = await service.search("Secret", 10, "personal");
      expect(searchPersonal.matches.some((m) => m.path === "Secret.md")).toBe(true);
    });

    it("should prevent cross-vault path traversal and crossing attempts", async () => {
      const service = new VaultService(
        {
          personal: personalVaultDir,
          work: workVaultDir,
        },
        cliAdapter
      );

      // Attempting to use relative traversal from personal to read work note
      await expect(
        service.readNote("../work-vault/Project-Alpha.md", false, "personal")
      ).rejects.toThrowError(/Path traversal detected/);

      // Attempting to write into work vault via personal vault path traversal
      await expect(
        service.createNote("../work-vault/Hacked.md", "Cross vault payload", undefined, false, undefined, "personal")
      ).rejects.toThrowError(/Path traversal detected/);

      // Verify work vault remained untouched
      expect(fs.existsSync(path.join(workVaultDir, "Hacked.md"))).toBe(false);
    });

    it("should throw 404 with helpful error message when non-existent vault is requested", async () => {
      const service = new VaultService(
        {
          personal: personalVaultDir,
          work: workVaultDir,
        },
        cliAdapter
      );

      await expect(service.readNote("Journal.md", false, "finance")).rejects.toThrowError(
        /Vault 'finance' not found\. Available vaults: \[.*personal.*work.*\]/
      );
    });

    it("should safely trash deleted notes into that specific vault's trash directory", async () => {
      const service = new VaultService(
        {
          personal: personalVaultDir,
          work: workVaultDir,
        },
        cliAdapter
      );

      await service.deleteNote("Journal.md", false, undefined, "personal");

      // Verify it was moved to personal vault's .obsidian-mcp/trash
      const trashDir = path.join(personalVaultDir, ".obsidian-mcp", "trash");
      expect(fs.existsSync(trashDir)).toBe(true);

      // Work vault's trash should not exist or be empty
      const workTrash = path.join(workVaultDir, ".obsidian-mcp", "trash");
      expect(fs.existsSync(workTrash)).toBe(false);
    });

    it("should enforce per-vault read-only access while allowing read-write on other vaults", async () => {
      const service = new VaultService(
        {
          personal: { path: personalVaultDir, readOnly: true },
          work: { path: workVaultDir, readOnly: false },
        },
        cliAdapter,
        undefined,
        "work"
      );

      // 1. Reading from read-only vault succeeds
      const readRes = await service.readNote("Journal.md", false, "personal");
      expect(readRes.content).toContain("Personal Journal");

      // 2. enforceVaultScope allows read on personal, blocks write/delete
      expect(() =>
        service.enforceVaultScope("personal", Scope.VAULT_READ, "obsidian_read_note")
      ).not.toThrow();

      expect(() =>
        service.enforceVaultScope("personal", Scope.VAULT_WRITE, "obsidian_create_note")
      ).toThrow(ObsidianMcpError);

      try {
        service.enforceVaultScope("personal", Scope.VAULT_WRITE, "obsidian_create_note");
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.FORBIDDEN);
        expect(err.message).toContain("read-only");
      }

      // 3. enforceVaultScope allows write on work vault
      expect(() =>
        service.enforceVaultScope("work", Scope.VAULT_WRITE, "obsidian_create_note")
      ).not.toThrow();

      // 4. Writing note in work vault succeeds
      const created = await service.createNote(
        "Sprint.md",
        "# Work Sprint\nTasks for week.",
        undefined,
        false,
        undefined,
        "work"
      );
      expect(created.path).toBe("Sprint.md");
      expect(fs.existsSync(path.join(workVaultDir, "Sprint.md"))).toBe(true);

      // 5. Vault metadata reflects per-vault readOnly status
      const listRes = await service.listVaults();
      const personalMeta = listRes.vaults.find((v) => v.name === "personal");
      const workMeta = listRes.vaults.find((v) => v.name === "work");
      expect(personalMeta?.readOnly).toBe(true);
      expect(personalMeta?.scopes).toEqual([Scope.VAULT_READ]);
      expect(workMeta?.readOnly).toBe(false);

      const vaultInfo = await service.getVault("personal");
      expect(vaultInfo.readOnly).toBe(true);
    });
  });

  describe("Server Multi-Vault Registration & Protocol", () => {
    it("should initialize server with multi-vault config and expose obsidian_list_vaults", () => {
      const { server, vaultService } = createMcpServer({
        NODE_ENV: "test",
        MCP_TRANSPORT: "stdio",
        PORT: 3000,
        HOST: "127.0.0.1",
        OBSIDIAN_VAULTS: {
          personal: personalVaultDir,
          work: workVaultDir,
        },
        OBSIDIAN_DEFAULT_VAULT: "work",
        OBSIDIAN_BIN_PATH: "obsidian",
        AUTH_ENABLED: false,
        READ_ONLY: false,
        AUDIT_LOG_ENABLED: false,
        RATE_LIMIT_PER_MINUTE: 1000,
        MAX_SEARCH_RESULTS: 50,
        COMMAND_TIMEOUT_MS: 5000,
        ENABLE_ADVANCED_CLI: false,
        ENABLE_DESTRUCTIVE_TOOLS: true,
        LOG_LEVEL: "info",
      });

      expect(server).toBeDefined();
      expect(vaultService).toBeDefined();
    });

    it("should reject tool mutation on read-only vault configured via :ro string", () => {
      const { vaultService } = createMcpServer({
        NODE_ENV: "test",
        MCP_TRANSPORT: "stdio",
        PORT: 3000,
        HOST: "127.0.0.1",
        OBSIDIAN_VAULTS: `personal=${personalVaultDir}:ro,work=${workVaultDir}:rw`,
        OBSIDIAN_DEFAULT_VAULT: "work",
        OBSIDIAN_BIN_PATH: "obsidian",
        AUTH_ENABLED: false,
        READ_ONLY: false,
        AUDIT_LOG_ENABLED: false,
        RATE_LIMIT_PER_MINUTE: 1000,
        MAX_SEARCH_RESULTS: 50,
        COMMAND_TIMEOUT_MS: 5000,
        ENABLE_ADVANCED_CLI: false,
        ENABLE_DESTRUCTIVE_TOOLS: true,
        LOG_LEVEL: "info",
      });

      expect(() =>
        vaultService.enforceVaultScope("personal", Scope.VAULT_WRITE, "obsidian_create_note")
      ).toThrowError(/read-only/);

      expect(() =>
        vaultService.enforceVaultScope("work", Scope.VAULT_WRITE, "obsidian_create_note")
      ).not.toThrow();
    });
  });
});
