import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppConfig } from "./config/config.js";
import { PathGuard } from "./security/path-guard.js";
import { AuthManager, AuthContext } from "./security/auth.js";
import { RateLimiter } from "./security/rate-limit.js";
import { AuditLogger } from "./security/audit.js";
import { ObsidianCliAdapter } from "./adapters/obsidian/cli.adapter.js";
import { VaultService } from "./services/vault.service.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export function createMcpServer(config: AppConfig, getAuthContext?: () => AuthContext) {
  const server = new McpServer({
    name: "obsidian-mcp",
    version: "1.0.0",
  });

  const pathGuard = new PathGuard(config.OBSIDIAN_VAULT_PATH);
  const cliAdapter = new ObsidianCliAdapter(config.OBSIDIAN_BIN_PATH, config.COMMAND_TIMEOUT_MS);
  const vaultService = new VaultService(pathGuard, cliAdapter);
  const authManager = new AuthManager(config);
  const rateLimiter = new RateLimiter(config.RATE_LIMIT_PER_MINUTE);
  const auditLogger = new AuditLogger(config.AUDIT_LOG_ENABLED);

  registerTools(server, vaultService, authManager, rateLimiter, auditLogger, config, getAuthContext);
  registerResources(server, vaultService);
  registerPrompts(server);

  return {
    server,
    vaultService,
    cliAdapter,
    pathGuard,
    authManager,
  };
}
