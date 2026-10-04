import express, { Request, Response } from "express";
import fs from "node:fs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppConfig } from "../config/config.js";
import { createMcpServer } from "../server.js";
import { AuthContext, authStorage } from "../security/auth.js";

export interface SseSessionRecord {
  server: McpServer;
  transport: SSEServerTransport;
  auth: AuthContext;
  createdAt: number;
  lastActive: number;
}

export async function createHttpApp(config: AppConfig) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Shared subsystem instances for health and authentication
  const { pathGuard, cliAdapter, authManager } = createMcpServer(config);

  // 1. Native Streamable HTTP Transport (/mcp) - Stateless Mode
  const { server: streamableServer } = createMcpServer(config);
  const streamableTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await streamableServer.connect(streamableTransport);

  // 2. Legacy SSE Transport Sessions (/sse, /messages)
  const MAX_CONCURRENT_SESSIONS = 50;
  const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const sseSessions = new Map<string, SseSessionRecord>();

  // Periodic idle session cleanup for legacy SSE sessions
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, record] of sseSessions.entries()) {
      if (now - record.lastActive > SESSION_IDLE_TIMEOUT_MS) {
        try {
          record.transport.close();
        } catch {
          // Ignore close error
        }
        sseSessions.delete(id);
      }
    }
  }, 60 * 1000);

  // Operational Health Checks
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      mcp: "running",
      activeSessions: sseSessions.size,
      sseSessions: sseSessions.size,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", async (_req: Request, res: Response) => {
    const vaultExists = fs.existsSync(pathGuard.getVaultRoot());
    const obsidianReachable = await cliAdapter.checkReachability();

    const isReady = vaultExists;
    res.status(isReady ? 200 : 503).json({
      status: isReady ? (obsidianReachable ? "ready" : "degraded") : "unready",
      vaultAccessible: vaultExists,
      obsidianConnected: obsidianReachable,
      obsidianCli: obsidianReachable ? "connected" : "unavailable",
      timestamp: new Date().toISOString(),
    });
  });

  // Extract AuthContext safely; throws AUTH_REQUIRED if missing or invalid
  const extractAuth = (req: Request): AuthContext => {
    return authManager.authenticateHeader(req.headers.authorization);
  };

  // Canonical MCP Streamable HTTP endpoint
  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const auth = extractAuth(req);

      await authStorage.run(auth, async () => {
        await streamableTransport.handleRequest(req, res, req.body);
      });
    } catch (err: any) {
      res.status(err.statusCode || 401).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
  });

  // Legacy /sse Transport Handshake for older agents
  app.get("/sse", async (req: Request, res: Response) => {
    try {
      const auth = extractAuth(req);

      if (sseSessions.size >= MAX_CONCURRENT_SESSIONS) {
        res.status(503).json({ error: "Max concurrent SSE sessions exceeded" });
        return;
      }

      await authStorage.run(auth, async () => {
        const { server: sessionServer } = createMcpServer(config);
        const transport = new SSEServerTransport("/messages", res);
        const record: SseSessionRecord = {
          server: sessionServer,
          transport,
          auth,
          createdAt: Date.now(),
          lastActive: Date.now(),
        };
        sseSessions.set(transport.sessionId, record);

        transport.onclose = () => {
          sseSessions.delete(transport.sessionId);
        };

        await sessionServer.connect(transport);
      });
    } catch (err: any) {
      res.status(err.statusCode || 401).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
  });

  // Message Handler for legacy /sse sessions
  const handleMessages = async (req: Request, res: Response) => {
    try {
      const auth = extractAuth(req);
      const sessionId = String(req.query.sessionId || req.headers["x-session-id"] || "");
      const session = sseSessions.get(sessionId);

      if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
        return;
      }

      // Security: Bind SSE session to authenticated client ID
      if (session.auth.clientId !== auth.clientId) {
        res.status(403).json({
          error: "Forbidden: SSE session was initiated by a different client",
          sessionClient: session.auth.clientId,
          requestClient: auth.clientId,
        });
        return;
      }

      await authStorage.run(auth, async () => {
        session.lastActive = Date.now();
        await session.transport.handlePostMessage(req, res);
      });
    } catch (err: any) {
      res.status(err.statusCode || 401).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
  };

  app.post("/messages", handleMessages);

  return {
    app,
    sseSessions,
    streamableTransport,
    cleanupInterval,
  };
}

export async function runHttpServer(config: AppConfig) {
  const { app, sseSessions, streamableTransport, cleanupInterval } = await createHttpApp(config);

  const httpServer = app.listen(config.PORT, config.HOST, () => {
    console.log(
      `Obsidian MCP Server listening on http://${config.HOST}:${config.PORT} (Streamable HTTP /mcp, Legacy /sse)`
    );
  });

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Gracefully shutting down Obsidian MCP server...`);
    clearInterval(cleanupInterval);

    try {
      await streamableTransport.close();
    } catch {
      // Ignore close error
    }

    for (const [_id, record] of sseSessions.entries()) {
      try {
        await record.transport.close();
      } catch {
        // Ignore session close error
      }
    }
    sseSessions.clear();

    httpServer.close(() => {
      console.log("HTTP server stopped cleanly.");
      process.exit(0);
    });

    // Force exit if hanging
    setTimeout(() => {
      console.error("Graceful shutdown timed out, terminating process.");
      process.exit(1);
    }, 5000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return { httpServer, shutdown };
}
