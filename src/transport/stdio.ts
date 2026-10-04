import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppConfig } from "../config/config.js";
import { createMcpServer } from "../server.js";
import { AuthContext } from "../security/auth.js";
import { Scope } from "../config/scopes.js";

export async function runStdioServer(config: AppConfig) {
  // In local stdio mode, default user has full administrative privileges
  const localAuth: AuthContext = {
    clientId: "local-stdio",
    scopes: [
      Scope.VAULT_READ,
      Scope.VAULT_WRITE,
      Scope.VAULT_DELETE,
      Scope.VAULT_ADMIN,
      Scope.VAULT_DEVELOPER,
    ],
    authenticated: true,
  };

  const { server } = createMcpServer(config, () => localAuth);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("Obsidian MCP Server running over stdio transport.");
}
