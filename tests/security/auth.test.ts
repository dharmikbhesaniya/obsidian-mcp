import { describe, it, expect } from "vitest";
import { AuthManager, getCurrentAuthContext } from "../../src/security/auth.js";
import { Scope } from "../../src/config/scopes.js";
import { RateLimiter } from "../../src/security/rate-limit.js";
import { ErrorCode, ObsidianMcpError } from "../../src/schemas/errors.js";

describe("Security & Auth Manager", () => {
  const secretToken = "my-secret-vps-bearer-token-12345";
  const tokenHash = AuthManager.hashToken(secretToken);

  const mockConfig = {
    NODE_ENV: "production" as const,
    MCP_TRANSPORT: "http" as const,
    PORT: 3000,
    HOST: "127.0.0.1",
    OBSIDIAN_VAULT_PATH: "/fake/vault",
    OBSIDIAN_BIN_PATH: "obsidian",
    AUTH_ENABLED: true,
    BEARER_TOKEN_HASH: tokenHash,
    RATE_LIMIT_PER_MINUTE: 60,
    MAX_SEARCH_RESULTS: 50,
    COMMAND_TIMEOUT_MS: 15000,
    ENABLE_ADVANCED_CLI: false,
    ENABLE_DESTRUCTIVE_TOOLS: true,
    LOG_LEVEL: "info" as const,
  };

  const authManager = new AuthManager(mockConfig);

  it("should authenticate valid bearer token", () => {
    const context = authManager.authenticateHeader(`Bearer ${secretToken}`);
    expect(context.authenticated).toBe(true);
    expect(context.scopes).toContain(Scope.VAULT_READ);
    expect(context.scopes).toContain(Scope.VAULT_WRITE);
  });

  it("should reject missing or invalid bearer token", () => {
    expect(() => authManager.authenticateHeader("")).toThrow(ObsidianMcpError);
    expect(() => authManager.authenticateHeader("Bearer wrong-token")).toThrow(ObsidianMcpError);
    try {
      authManager.authenticateHeader("Bearer wrong-token");
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.AUTH_REQUIRED);
    }
  });

  it("should enforce required scope", () => {
    const authContext = {
      clientId: "read-only-agent",
      scopes: [Scope.VAULT_READ],
      authenticated: true,
    };

    expect(() =>
      authManager.enforceScope(authContext, Scope.VAULT_READ, "obsidian_read_note")
    ).not.toThrow();

    expect(() =>
      authManager.enforceScope(authContext, Scope.VAULT_DELETE, "obsidian_delete_note")
    ).toThrow(ObsidianMcpError);
  });

  it("should fail closed when getCurrentAuthContext is called without context", () => {
    expect(() => getCurrentAuthContext()).toThrow(ObsidianMcpError);
    try {
      getCurrentAuthContext();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.AUTH_REQUIRED);
    }
  });
});
