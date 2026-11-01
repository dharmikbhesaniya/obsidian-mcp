import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppConfig, AppConfigInput, loadConfig, parseVaultsConfig } from "./config/config.js";
import { AuthManager, AuthContext } from "./security/auth.js";
import { RateLimiter } from "./security/rate-limit.js";
import { AuditLogger } from "./security/audit.js";
import { ObsidianCliAdapter } from "./adapters/obsidian/cli.adapter.js";
import { VaultService } from "./services/vault.service.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export function createMcpServer(
  configInput: AppConfig | Partial<AppConfigInput> | Partial<AppConfig>,
  getAuthContext?: () => AuthContext
) {
  const config: AppConfig =
    typeof configInput === "object" &&
    configInput !== null &&
    "OBSIDIAN_ENABLE_AUTO_DISCOVERY" in configInput &&
    "OBSIDIAN_AUTO_DISCOVER_READ_ONLY" in configInput &&
    "PORT" in configInput
      ? (configInput as AppConfig)
      : loadConfig(configInput as Partial<AppConfigInput>);

  const server = new McpServer({
    name: "obsidian-mcp",
    version: "1.0.0",
  });

  const autoDiscoverReadOnly = Boolean(
    config.OBSIDIAN_AUTO_DISCOVER_READ_ONLY ||
    config.OBSIDIAN_AUTO_DISCOVERY_MODE === "read-only"
  );

  const parsed = parseVaultsConfig(
    config.OBSIDIAN_VAULT_PATH,
    config.OBSIDIAN_VAULTS,
    config.OBSIDIAN_DEFAULT_VAULT,
    config.OBSIDIAN_READ_ONLY_VAULTS,
    config.OBSIDIAN_VAULT_SCOPES,
    autoDiscoverReadOnly,
    config.OBSIDIAN_ENABLE_AUTO_DISCOVERY
  );
  const cliAdapter = new ObsidianCliAdapter(config.OBSIDIAN_BIN_PATH, config.COMMAND_TIMEOUT_MS);
  const vaultService = new VaultService(
    parsed.vaults,
    cliAdapter,
    undefined,
    parsed.defaultVault,
    parsed.vaultDefinitions,
    parsed.scanRoots,
    autoDiscoverReadOnly,
    config.OBSIDIAN_ENABLE_AUTO_DISCOVERY
  );
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
    pathGuard: vaultService.getPathGuard(),
    authManager,
  };
}
