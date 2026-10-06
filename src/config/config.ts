import dotenv from "dotenv";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { Scope, ScopeType, parseScopes } from "./scopes.js";

dotenv.config();

export interface VaultDefinition {
  name: string;
  path: string;
  readOnly: boolean;
  scopes?: ScopeType[];
}

export function parseVaultsConfig(
  vaultPath?: string,
  vaultsInput?: string | Record<string, any>,
  defaultVaultInput?: string,
  readOnlyVaultsInput?: string,
  vaultScopesInput?: string | Record<string, any>
): {
  vaults: Record<string, string>;
  vaultDefinitions: Record<string, VaultDefinition>;
  defaultVault: string;
} {
  const vaults: Record<string, string> = {};
  const vaultDefinitions: Record<string, VaultDefinition> = {};

  const readOnlySet = new Set<string>();
  if (readOnlyVaultsInput) {
    for (const item of readOnlyVaultsInput.split(",")) {
      const trimmed = item.trim();
      if (trimmed) readOnlySet.add(trimmed);
    }
  }

  const explicitScopesMap = new Map<string, ScopeType[]>();
  if (vaultScopesInput) {
    if (typeof vaultScopesInput === "object") {
      for (const [k, v] of Object.entries(vaultScopesInput)) {
        explicitScopesMap.set(k.trim(), Array.isArray(v) ? (v as ScopeType[]) : parseScopes(String(v)));
      }
    } else if (typeof vaultScopesInput === "string") {
      const parts = vaultScopesInput.split(";");
      for (const part of parts) {
        const eqIdx = part.indexOf("=");
        if (eqIdx > 0) {
          const k = part.substring(0, eqIdx).trim();
          const v = part.substring(eqIdx + 1).trim();
          explicitScopesMap.set(k, parseScopes(v));
        }
      }
    }
  }

  const parsePathAndMode = (name: string, rawVal: any): VaultDefinition => {
    if (typeof rawVal === "object" && rawVal !== null) {
      const vPath = String(rawVal.path || "").trim();
      const ro = Boolean(
        rawVal.readOnly === true ||
          rawVal.readonly === true ||
          rawVal.mode === "ro" ||
          readOnlySet.has(name)
      );
      let sc: ScopeType[] | undefined;
      if (explicitScopesMap.has(name)) {
        sc = explicitScopesMap.get(name);
      } else if (Array.isArray(rawVal.scopes)) {
        sc = rawVal.scopes;
      } else if (typeof rawVal.scopes === "string") {
        sc = parseScopes(rawVal.scopes);
      } else if (ro) {
        sc = [Scope.VAULT_READ];
      }
      return {
        name,
        path: vPath,
        readOnly: ro,
        scopes: sc,
      };
    }

    let str = String(rawVal).trim();
    let isReadOnly = readOnlySet.has(name);
    let customScopes: ScopeType[] | undefined = explicitScopesMap.get(name);

    if (!customScopes) {
      const bracketMatch = str.match(/^(.*?)\s*\[(.*?)\]$/);
      if (bracketMatch) {
        str = bracketMatch[1].trim();
        customScopes = parseScopes(bracketMatch[2]);
        isReadOnly = !customScopes.includes(Scope.VAULT_WRITE) && !customScopes.includes(Scope.VAULT_ADMIN);
      } else {
        const roRegex = /(?::|\s*\()(ro|read-only|read_only)\)?$/i;
        const rwRegex = /(?::|\s*\()(rw|read-write|read_write|write)\)?$/i;
        if (roRegex.test(str)) {
          str = str.replace(roRegex, "").trim();
          isReadOnly = true;
          customScopes = [Scope.VAULT_READ];
        } else if (rwRegex.test(str)) {
          str = str.replace(rwRegex, "").trim();
          isReadOnly = false;
        }
      }
    }

    if (isReadOnly && (!customScopes || customScopes.length === 0)) {
      customScopes = [Scope.VAULT_READ];
    }

    return {
      name,
      path: str,
      readOnly: isReadOnly,
      scopes: customScopes,
    };
  };

  if (vaultsInput) {
    if (typeof vaultsInput === "object" && !Array.isArray(vaultsInput)) {
      for (const [k, v] of Object.entries(vaultsInput)) {
        const def = parsePathAndMode(k, v);
        vaults[k] = def.path;
        vaultDefinitions[k] = def;
      }
    } else if (typeof vaultsInput === "string") {
      const trimmed = vaultsInput.trim();
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed)) {
              const def = parsePathAndMode(k, v);
              vaults[k] = def.path;
              vaultDefinitions[k] = def;
            }
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
              const def = parsePathAndMode(k, v);
              vaults[k] = def.path;
              vaultDefinitions[k] = def;
            }
          }
        }
      }
    }
  }

  if (vaultPath && vaultPath.trim()) {
    const singleVaultPath = vaultPath.trim();
    const vaultBase = path.basename(singleVaultPath) || "default";
    const def = parsePathAndMode(vaultBase, singleVaultPath);
    if (Object.keys(vaults).length === 0) {
      vaults[vaultBase] = def.path;
      vaultDefinitions[vaultBase] = def;
    } else if (!vaults[vaultBase] && !vaults["default"]) {
      vaults["default"] = def.path;
      vaultDefinitions["default"] = { ...def, name: "default" };
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

  return { vaults, vaultDefinitions, defaultVault };
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_URL: z.string().url().optional(),

  // Vault configuration
  OBSIDIAN_VAULT_PATH: z.string().optional(),
  OBSIDIAN_VAULTS: z.union([z.record(z.any()), z.string()]).optional(),
  OBSIDIAN_DEFAULT_VAULT: z.string().optional(),
  OBSIDIAN_READ_ONLY_VAULTS: z.string().optional(),
  OBSIDIAN_VAULT_SCOPES: z.union([z.record(z.any()), z.string()]).optional(),
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
