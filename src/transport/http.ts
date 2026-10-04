import express, { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { AppConfig } from "../config/config.js";
import { createMcpServer } from "../server.js";
import { AuthContext, authStorage } from "../security/auth.js";
import fs from "node:fs";

interface SessionRecord {
  transport: SSEServerTransport;
  auth: AuthContext;
  createdAt: number;
  lastActive: number;
}

export async function runHttpServer(config: AppConfig) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const { server, cliAdapter, pathGuard, authManager } = createMcpServer(config);

  const MAX_CONCURRENT_SESSIONS = 50;
  const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const sessions = new Map<string, SessionRecord>();

  // Periodic idle session cleanup
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, record] of sessions.entries()) {
      if (now - record.lastActive > SESSION_IDLE_TIMEOUT_MS) {
        try {
          record.transport.close();
        } catch {
          // Ignore close error
        }
        sessions.delete(id);
      }
    }
  }, 60 * 1000);

  // Operational Health Checks
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      mcp: "running",
      activeSessions: sessions.size,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", async (_req: Request, res: Response) => {
    const vaultExists = fs.existsSync(pathGuard.getVaultRoot());
    const obsidianReachable = await cliAdapter.checkReachability();

    const isReady = vaultExists;
    res.status(isReady ? 200 : 503).json({
      status: isReady ? "ready" : "unready",
      vaultAccessible: vaultExists,
      obsidianConnected: obsidianReachable,
      timestamp: new Date().toISOString(),
    });
  });

  // Extract AuthContext safely without global state
  const extractAuth = (req: Request): AuthContext => {
    return authManager.authenticateHeader(req.headers.authorization);
  };

  // 1. Modern Streamable HTTP /mcp endpoint
  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const auth = extractAuth(req);

      await authStorage.run(auth, async () => {
        if (req.method === "GET") {
          // SSE Handshake for Streamable HTTP clients
          if (sessions.size >= MAX_CONCURRENT_SESSIONS) {
            res.status(503).json({ error: "Max concurrent MCP sessions exceeded" });
            return;
          }

          const transport = new SSEServerTransport("/mcp/messages", res);
          const record: SessionRecord = {
            transport,
            auth,
            createdAt: Date.now(),
            lastActive: Date.now(),
          };
          sessions.set(transport.sessionId, record);

          transport.onclose = () => {
            sessions.delete(transport.sessionId);
          };

          await server.connect(transport);
        } else if (req.method === "POST") {
          // Direct JSON-RPC or message posting
          const sessionId = String(req.query.sessionId || req.headers["x-session-id"] || "");
          const session = sessions.get(sessionId);

          if (!session) {
            res.status(404).json({ error: "Session not found or expired. Initialize via GET /mcp or GET /sse first." });
            return;
          }

          session.lastActive = Date.now();
          await session.transport.handlePostMessage(req, res);
        } else {
          res.status(405).json({ error: `Method ${req.method} not allowed` });
        }
      });
    } catch (err: any) {
      res.status(err.statusCode || 401).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
  });

  // 2. Legacy /sse Transport Handshake
  app.get("/sse", async (req: Request, res: Response) => {
    try {
      const auth = extractAuth(req);

      await authStorage.run(auth, async () => {
        if (sessions.size >= MAX_CONCURRENT_SESSIONS) {
          res.status(503).json({ error: "Max concurrent MCP sessions exceeded" });
          return;
        }

        const transport = new SSEServerTransport("/messages", res);
        const record: SessionRecord = {
          transport,
          auth,
          createdAt: Date.now(),
          lastActive: Date.now(),
        };
        sessions.set(transport.sessionId, record);

        transport.onclose = () => {
          sessions.delete(transport.sessionId);
        };

        await server.connect(transport);
      });
    } catch (err: any) {
      res.status(err.statusCode || 401).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
  });

  // 3. Messages handler for /sse sessions
  const handleMessages = async (req: Request, res: Response) => {
    try {
      const auth = extractAuth(req);
      const sessionId = String(req.query.sessionId || req.headers["x-session-id"] || "");
      const session = sessions.get(sessionId);

      if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
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
  app.post("/mcp/messages", handleMessages);

  const httpServer = app.listen(config.PORT, config.HOST, () => {
    console.log(
      `Obsidian MCP Server listening on http://${config.HOST}:${config.PORT} (Transports: Streamable HTTP /mcp, Legacy /sse)`
    );
  });

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Gracefully shutting down Obsidian MCP server...`);
    clearInterval(cleanupInterval);

    for (const [id, record] of sessions.entries()) {
      try {
        await record.transport.close();
      } catch {
        // Ignore session close error
      }
    }
    sessions.clear();

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
}
