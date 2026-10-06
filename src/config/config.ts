import dotenv from "dotenv";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";

dotenv.config();

export function parseVaultsConfig(
  vaultPath?: string,
  vaultsInput?: string | Record<string, string>,
  defaultVaultInput?: string
): { vaults: Record<string, string>; defaultVault: string } {
  const vaults: Record<string, string> = {};

  if (vaultsInput) {
    if (typeof vaultsInput === "object" && !Array.isArray(vaultsInput)) {
      Object.assign(vaults, vaultsInput);
    } else if (typeof vaultsInput === "string") {
      const trimmed = vaultsInput.trim();
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            Object.assign(vaults, parsed);
          }
        } catch {
          // not JSON, fallback to comma separated
        }
      }
      if (Object.keys(vaults).length === 0) {
        // format: name1=path1,name2=path2
        const parts = trimmed.split(",");
        for (const part of parts) {
          const eqIdx = part.indexOf("=");
          if (eqIdx > 0) {
            const k = part.substring(0, eqIdx).trim();
            const v = part.substring(eqIdx + 1).trim();
            if (k && v) {
              vaults[k] = v;
            }
          }
        }
      }
    }
  }

  if (vaultPath && vaultPath.trim()) {
    const singleVaultPath = vaultPath.trim();
    const vaultBase = path.basename(singleVaultPath) || "default";
    if (Object.keys(vaults).length === 0) {
      vaults[vaultBase] = singleVaultPath;
    } else if (!vaults[vaultBase] && !vaults["default"]) {
      vaults["default"] = singleVaultPath;
    }
  }

  const vaultNames = Object.keys(vaults);
  if (vaultNames.length === 0) {
    throw new Error("No vault configured. Specify OBSIDIAN_VAULT_PATH or OBSIDIAN_VAULTS.");
  }

  let defaultVault = defaultVaultInput?.trim() || "";
  if (!defaultVault || !vaults[defaultVault]) {
    defaultVault = vaults["default"] ? "default" : vaultNames[0];
  }

  return { vaults, defaultVault };
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_URL: z.string().url().optional(),

  // Vault configuration
  OBSIDIAN_VAULT_PATH: z.string().optional(),
  OBSIDIAN_VAULTS: z.union([z.record(z.string()), z.string()]).optional(),
  OBSIDIAN_DEFAULT_VAULT: z.string().optional(),
  OBSIDIAN_BIN_PATH: z.string().default("obsidian"),

  // Security
  AUTH_ENABLED: z
    .union([z.boolean(), z.string().transform((val) => val === "true" || val === "1")])
    .default(false),
  AUTH_TOKEN: z.string().optional(),
  BEARER_TOKEN_HASH: z.string().optional(),
  READ_ONLY: z
    .union([z.boolean(), z.string().transform((val) => val === "true" || val === "1")])
    .default(false),
  SCOPES: z.string().optional(),
  AUDIT_LOG_ENABLED: z
    .union([z.boolean(), z.string().transform((val) => val === "true" || val === "1")])
    .default(true),

  // Operational limits
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
  MAX_SEARCH_RESULTS: z.coerce.number().default(50),
  COMMAND_TIMEOUT_MS: z.coerce.number().default(15000),

  // Feature flags
  ENABLE_ADVANCED_CLI: z
    .union([z.boolean(), z.string().transform((val) => val === "true" || val === "1")])
    .default(false),
  ENABLE_DESTRUCTIVE_TOOLS: z
    .union([z.boolean(), z.string().transform((val) => val === "true" || val === "1")])
    .default(true),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).superRefine((data, ctx) => {
  if (!data.OBSIDIAN_VAULT_PATH && !data.OBSIDIAN_VAULTS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one vault must be configured via OBSIDIAN_VAULT_PATH or OBSIDIAN_VAULTS.",
      path: ["OBSIDIAN_VAULT_PATH"],
    });
  }

  if (data.NODE_ENV === "production" && data.MCP_TRANSPORT === "http" && !data.AUTH_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fatal security violation: Production HTTP transport cannot run with AUTH_ENABLED=false.",
      path: ["AUTH_ENABLED"],
    });
  }

  if (data.AUTH_TOKEN && !data.BEARER_TOKEN_HASH) {
    data.BEARER_TOKEN_HASH = importCryptoTokenHash(data.AUTH_TOKEN);
  }

  if (data.AUTH_ENABLED && !data.BEARER_TOKEN_HASH && !data.AUTH_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AUTH_ENABLED is true, but neither AUTH_TOKEN nor BEARER_TOKEN_HASH was provided.",
      path: ["AUTH_TOKEN"],
    });
  }
});

function importCryptoTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  if (overrides) {
    return ConfigSchema.parse({
      ...process.env,
      ...overrides,
    });
  }

  if (!cachedConfig) {
    cachedConfig = ConfigSchema.parse(process.env);
  }
  return cachedConfig;
}
