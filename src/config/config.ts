import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_URL: z.string().url().optional(),

  // Vault configuration
  OBSIDIAN_VAULT_PATH: z.string().min(1, "OBSIDIAN_VAULT_PATH is required"),
  OBSIDIAN_BIN_PATH: z.string().default("obsidian"),

  // Security
  AUTH_ENABLED: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  BEARER_TOKEN_HASH: z.string().optional(),

  // Operational limits
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
  MAX_SEARCH_RESULTS: z.coerce.number().default(50),
  COMMAND_TIMEOUT_MS: z.coerce.number().default(15000),

  // Feature flags
  ENABLE_ADVANCED_CLI: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  ENABLE_DESTRUCTIVE_TOOLS: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("true"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

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
