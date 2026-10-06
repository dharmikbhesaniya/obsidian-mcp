import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { createHttpApp } from "../../src/transport/http.js";
import { AppConfig, loadConfig } from "../../src/config/config.js";

// In-memory request dispatcher for sandbox-safe HTTP route testing
function dispatchRequest(
  app: any,
  options: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
  }
): Promise<{ status: number; body: any; headers: Record<string, any> }> {
  return new Promise((resolve) => {
    const req = new EventEmitter() as any;
    req.method = options.method || "GET";
    req.url = options.url;
    req.headers = Object.fromEntries(
      Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    req.body = options.body;
    req.query = {};
    const [, queryString] = options.url.split("?");
    if (queryString) {
      req.query = Object.fromEntries(new URLSearchParams(queryString).entries());
    }

    const res = new EventEmitter() as any;
    res.statusCode = 200;
    res._headers = {};
    res._body = "";

    res.setHeader = (name: string, value: any) => {
      res._headers[name.toLowerCase()] = value;
    };
    res.getHeader = (name: string) => res._headers[name.toLowerCase()];
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data: any) => {
      res._body = JSON.stringify(data);
      res.emit("finish");
      return res;
    };
    res.send = (data: any) => {
      res._body = data;
      res.emit("finish");
      return res;
    };
    res.end = (data?: any) => {
      if (data) res._body = (res._body || "") + data;
      res.emit("finish");
      return res;
    };

    res.on("finish", () => {
      let parsedBody = res._body;
      try {
        parsedBody = JSON.parse(res._body);
      } catch {
        // Keep raw text
      }
      resolve({ status: res.statusCode, body: parsedBody, headers: res._headers });
    });

    app(req, res);
  });
}

describe("HTTP Transport Integration", () => {
  let tempVaultDir: string;
  let cleanupIntervalId: NodeJS.Timeout;

  const validTokenA = crypto.randomBytes(16).toString("hex");
  const validTokenB = crypto.randomBytes(16).toString("hex");
  const tokenAHash = crypto.createHash("sha256").update(validTokenA).digest("hex");
  const tokenBHash = crypto.createHash("sha256").update(validTokenB).digest("hex");

  beforeEach(() => {
    tempVaultDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-transport-test-")));
  });

  afterEach(() => {
    if (cleanupIntervalId) {
      clearInterval(cleanupIntervalId);
    }
    fs.rmSync(tempVaultDir, { recursive: true, force: true });
  });

  const setupApp = async (configOverrides: Partial<AppConfig> = {}) => {
    const config: AppConfig = {
      NODE_ENV: "test",
      MCP_TRANSPORT: "http",
      PORT: 3000,
      HOST: "127.0.0.1",
      OBSIDIAN_VAULT_PATH: tempVaultDir,
      OBSIDIAN_BIN_PATH: "mock-obsidian",
      AUTH_ENABLED: false,
      READ_ONLY: false,
      AUDIT_LOG_ENABLED: false,
      RATE_LIMIT_PER_MINUTE: 1000,
      MAX_SEARCH_RESULTS: 50,
      COMMAND_TIMEOUT_MS: 5000,
      ENABLE_ADVANCED_CLI: false,
      ENABLE_DESTRUCTIVE_TOOLS: true,
      LOG_LEVEL: "error",
      ...configOverrides,
    };

    const { app, sseSessions, cleanupInterval } = await createHttpApp(config);
    cleanupIntervalId = cleanupInterval;
    return { app, sseSessions, config };
  };

  it("should respond to /health and /ready health checks", async () => {
    const { app } = await setupApp();

    const health = await dispatchRequest(app, { url: "/health" });
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(health.body.mcp).toBe("running");

    const ready = await dispatchRequest(app, { url: "/ready" });
    expect(ready.status).toBe(200);
    expect(ready.body.vaultAccessible).toBe(true);
    expect(ready.body.status).toBe("degraded"); // mock-obsidian is unavailable
    expect(ready.body.obsidianCli).toBe("unavailable");
  });

  it("should enforce authentication on /mcp when AUTH_ENABLED=true", async () => {
    const { app } = await setupApp({
      AUTH_ENABLED: true,
      BEARER_TOKEN_HASH: tokenAHash,
    });

    // 1. Missing Authorization header -> 401
    const unauth = await dispatchRequest(app, {
      method: "POST",
      url: "/mcp",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(unauth.status).toBe(401);

    // 2. Invalid bearer token -> 401
    const invalid = await dispatchRequest(app, {
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer invalid-token" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(invalid.status).toBe(401);
  });

  it("should bind SSE sessions to the initiating client and reject cross-client spoofing", async () => {
    const { app, sseSessions } = await setupApp({
      AUTH_ENABLED: true,
      BEARER_TOKEN_HASH: tokenAHash,
    });

    // Manually register an active SSE session belonging to Client A
    const sessionId = "session-client-a-123";
    sseSessions.set(sessionId, {
      server: {} as any,
      transport: {
        handlePostMessage: async () => {},
        close: () => {},
      } as any,
      auth: {
        clientId: "client-a-identity",
        scopes: [],
        authenticated: true,
      },
      createdAt: Date.now(),
      lastActive: Date.now(),
    });

    // 1. Sending messages without session ID -> 404
    const noSession = await dispatchRequest(app, {
      method: "POST",
      url: "/messages?sessionId=non-existent",
      headers: { authorization: `Bearer ${validTokenA}` },
      body: { jsonrpc: "2.0", id: 1 },
    });
    expect(noSession.status).toBe(404);

    // 2. Client with different identity attempts to send message to Client A's session -> 403 Forbidden
    const crossClientAttempt = await dispatchRequest(app, {
      method: "POST",
      url: `/messages?sessionId=${sessionId}`,
      headers: { authorization: `Bearer ${validTokenA}` }, // Authenticates as token hash identity
      body: { jsonrpc: "2.0", id: 2 },
    });
    // auth.clientId for tokenA is its hash or "token-client", which does not match "client-a-identity"
    expect(crossClientAttempt.status).toBe(403);
    expect(crossClientAttempt.body.error).toContain("Forbidden");
  });

  it("should fail startup when NODE_ENV=production, MCP_TRANSPORT=http, and AUTH_ENABLED=false", () => {
    expect(() => {
      loadConfig({
        NODE_ENV: "production",
        MCP_TRANSPORT: "http",
        AUTH_ENABLED: false,
        OBSIDIAN_VAULT_PATH: tempVaultDir,
      });
    }).toThrowError(/Fatal security violation/);
  });
});
