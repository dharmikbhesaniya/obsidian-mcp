import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { ErrorCode, ObsidianMcpError } from "../schemas/errors.js";
import { Scope, ScopeType, hasRequiredScope } from "../config/scopes.js";
import { AppConfig } from "../config/config.js";

export interface AuthContext {
  clientId: string;
  scopes: ScopeType[];
  authenticated: boolean;
}

export const authStorage = new AsyncLocalStorage<AuthContext>();

export function getCurrentAuthContext(): AuthContext {
  const ctx = authStorage.getStore();
  if (ctx) return ctx;
  throw new ObsidianMcpError(
    ErrorCode.AUTH_REQUIRED,
    "Unauthenticated request context: no authorization context established.",
    401
  );
}

export class AuthManager {
  private readonly authEnabled: boolean;
  private readonly expectedHash?: string;
  private readonly rawToken?: string;
  private readonly readOnly: boolean;

  constructor(config: AppConfig) {
    this.authEnabled = config.AUTH_ENABLED;
    this.readOnly = Boolean(config.READ_ONLY);

    const raw = config.AUTH_TOKEN || (config as any).BEARER_TOKEN;
    this.rawToken = raw ? raw.trim() : undefined;

    if (config.BEARER_TOKEN_HASH && config.BEARER_TOKEN_HASH.trim().length > 0) {
      const trimmedHash = config.BEARER_TOKEN_HASH.trim();
      const isSha256 = /^[a-f0-9]{64}$/i.test(trimmedHash);
      if (isSha256) {
        this.expectedHash = trimmedHash;
      } else {
        // Plaintext token was supplied in BEARER_TOKEN_HASH
        this.rawToken = this.rawToken || trimmedHash;
        this.expectedHash = AuthManager.hashToken(trimmedHash);
      }
    } else if (this.rawToken) {
      this.expectedHash = AuthManager.hashToken(this.rawToken);
    }
  }

  /**
   * Hashes a raw token string with SHA-256.
   */
  public static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Validates a Bearer authorization header.
   */
  public authenticateHeader(authHeader?: string): AuthContext {
    if (!this.authEnabled) {
      // In development / local stdio mode with auth disabled, grant full scopes unless read-only
      return {
        clientId: "local-user",
        scopes: this.readOnly
          ? [Scope.VAULT_READ]
          : [
              Scope.VAULT_READ,
              Scope.VAULT_WRITE,
              Scope.VAULT_DELETE,
              Scope.VAULT_ADMIN,
              Scope.VAULT_DEVELOPER,
            ],
        authenticated: true,
      };
    }

    if (!authHeader) {
      throw new ObsidianMcpError(
        ErrorCode.AUTH_REQUIRED,
        "Missing or malformed Authorization header. Expected 'Bearer <token>'.",
        401
      );
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new ObsidianMcpError(
        ErrorCode.AUTH_REQUIRED,
        "Missing or malformed Authorization header. Expected 'Bearer <token>'.",
        401
      );
    }

    const rawToken = match[1].trim();
    if (!rawToken) {
      throw new ObsidianMcpError(ErrorCode.AUTH_REQUIRED, "Empty bearer token provided", 401);
    }

    if (!this.expectedHash) {
      throw new ObsidianMcpError(
        ErrorCode.INTERNAL_ERROR,
        "Server configuration error: BEARER_TOKEN_HASH is not configured.",
        500
      );
    }

    const providedHash = AuthManager.hashToken(rawToken);
    const expectedBuffer = Buffer.from(this.expectedHash, "utf-8");
    const providedBuffer = Buffer.from(providedHash, "utf-8");

    let isAuthenticated = false;
    if (
      expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      isAuthenticated = true;
    } else if (this.rawToken) {
      const rawExpectedBuffer = Buffer.from(this.rawToken, "utf-8");
      const rawProvidedBuffer = Buffer.from(rawToken, "utf-8");
      if (
        rawExpectedBuffer.length === rawProvidedBuffer.length &&
        crypto.timingSafeEqual(rawExpectedBuffer, rawProvidedBuffer)
      ) {
        isAuthenticated = true;
      }
    }

    if (!isAuthenticated) {
      throw new ObsidianMcpError(ErrorCode.AUTH_REQUIRED, "Invalid access token credentials", 401);
    }

    // Deterministic credential identifier for rate limiting and session isolation
    const credentialId = `client_${crypto.createHash("sha256").update(providedHash).digest("hex").slice(0, 12)}`;

    const scopes = this.readOnly
      ? [Scope.VAULT_READ]
      : [Scope.VAULT_READ, Scope.VAULT_WRITE, Scope.VAULT_DELETE];

    return {
      clientId: credentialId,
      scopes,
      authenticated: true,
    };
  }

  /**
   * Enforces that the request context has the required scope for a tool.
   */
  public enforceScope(authContext: AuthContext, requiredScope: ScopeType, toolName: string): void {
    if (!hasRequiredScope(authContext.scopes, requiredScope)) {
      throw new ObsidianMcpError(
        ErrorCode.FORBIDDEN,
        `Token lacks required scope '${requiredScope}' to invoke tool '${toolName}'.`,
        403,
        { requiredScope, tool: toolName }
      );
    }
  }
}
