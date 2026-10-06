import crypto from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppConfig } from "../config/config.js";
import { createMcpServer } from "../server.js";
import { AuthContext, AuthManager } from "../security/auth.js";
import { Scope } from "../config/scopes.js";

export async function runStdioServer(config: AppConfig) {
  // If AUTH_ENABLED is set for stdio, verify that an auth token is provided in the process environment
  if (config.AUTH_ENABLED) {
    const providedToken = process.env.MCP_AUTH_TOKEN || process.env.AUTH_TOKEN;
    if (!providedToken) {
      console.error(
        "FATAL: AUTH_ENABLED=true in stdio mode, but no AUTH_TOKEN / MCP_AUTH_TOKEN was provided in environment."
      );
      process.exit(1);
    }
    const providedHash = AuthManager.hashToken(providedToken.trim());
    const expectedHash = config.BEARER_TOKEN_HASH;
    if (
      !expectedHash ||
      providedHash.length !== expectedHash.length ||
      !crypto.timingSafeEqual(Buffer.from(providedHash, "utf-8"), Buffer.from(expectedHash, "utf-8"))
    ) {
      console.error(
        "FATAL: Provided AUTH_TOKEN / MCP_AUTH_TOKEN does not match configured credentials."
      );
      process.exit(1);
    }
  }

  // Determine granted scopes: Read-only restriction if READ_ONLY=true
  const scopes = config.READ_ONLY
    ? [Scope.VAULT_READ]
    : [
        Scope.VAULT_READ,
        Scope.VAULT_WRITE,
        Scope.VAULT_DELETE,
        Scope.VAULT_ADMIN,
        Scope.VAULT_DEVELOPER,
      ];

  const localAuth: AuthContext = {
    clientId: "local-stdio",
    scopes,
    authenticated: true,
  };

  const { server } = createMcpServer(config, () => localAuth);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("Obsidian MCP Server running over stdio transport.");
}
