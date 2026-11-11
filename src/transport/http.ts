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

export interface HttpSessionRecord {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  auth: AuthContext;
  createdAt: number;
  lastActive: number;
}

export async function createHttpApp(config: AppConfig) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Enable CORS for browser-based AI agents, web frontends, and inspectors
  app.use((req: Request, res: Response, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, x-session-id"
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, x-session-id");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Shared subsystem instances for health and authentication
  const { pathGuard, cliAdapter, authManager } = createMcpServer(config);

  // 1. Stateful HTTP and SSE Transport Sessions
  const MAX_CONCURRENT_SESSIONS = 50;
  const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const sseSessions = new Map<string, SseSessionRecord>();
  const httpSessions = new Map<string, HttpSessionRecord>();

  // Periodic idle session cleanup for sessions
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
    for (const [id, record] of httpSessions.entries()) {
      if (now - record.lastActive > SESSION_IDLE_TIMEOUT_MS) {
        try {
          record.transport.close();
        } catch {
          // Ignore close error
        }
        httpSessions.delete(id);
      }
    }
  }, 60 * 1000);
  cleanupInterval.unref();

  // Extract AuthContext safely; supports Authorization header, query parameter, or /s/:token path
  const getPathToken = (req: Request): string | undefined => {
    const pToken = req.params?.token;
    if (typeof pToken === "string" && pToken.trim().length > 0) return pToken.trim();
    if (Array.isArray(pToken) && pToken.length > 0 && typeof pToken[0] === "string") return pToken[0].trim();
    if (typeof req.path === "string") {
      const match = req.path.match(/^\/s\/([a-zA-Z0-9_\-\.]+)/);
      if (match) return match[1];
    }
    return undefined;
  };

  const extractAuth = (req: Request): AuthContext => {
    const header = req.headers.authorization;
    const pathToken = getPathToken(req);
    const queryToken =
      (typeof req.query.token === "string" && req.query.token) ||
      (typeof req.query.auth_token === "string" && req.query.auth_token) ||
      (typeof req.query.bearer_token === "string" && req.query.bearer_token) ||
      pathToken ||
      undefined;
    const authHeader = header || (queryToken ? `Bearer ${queryToken}` : undefined);
    return authManager.authenticateHeader(authHeader);
  };

  // Operational Health Checks (available at root and under /s/:token)
  const handleHealth = (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      mcp: "running",
      activeSessions: sseSessions.size + httpSessions.size,
      sseSessions: sseSessions.size,
      httpSessions: httpSessions.size,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  };

  const handleReady = async (_req: Request, res: Response) => {
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
  };

  app.get(["/health", "/s/:token/health"], handleHealth);
  app.get(["/ready", "/s/:token/ready"], handleReady);

  // Legacy /sse Transport Handshake for older agents and SSE-based clients
  const handleSse = async (req: Request, res: Response) => {
    try {
      const auth = extractAuth(req);

      if (sseSessions.size >= MAX_CONCURRENT_SESSIONS) {
        res.status(503).json({ error: "Max concurrent SSE sessions exceeded" });
        return;
      }

      await authStorage.run(auth, async () => {
        const { server: sessionServer } = createMcpServer(config);
        const pathToken = getPathToken(req);
        const queryToken =
          (typeof req.query.token === "string" && req.query.token) ||
          (typeof req.query.auth_token === "string" && req.query.auth_token) ||
          (typeof req.query.bearer_token === "string" && req.query.bearer_token) ||
          "";

        let messagesEndpoint: string;
        if (pathToken) {
          messagesEndpoint = `/s/${encodeURIComponent(pathToken)}/messages`;
        } else if (queryToken) {
          messagesEndpoint = `/messages?token=${encodeURIComponent(queryToken)}`;
        } else {
          messagesEndpoint = "/messages";
        }

        const transport = new SSEServerTransport(messagesEndpoint, res);
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
  };

  // Canonical MCP Streamable HTTP endpoint (supports both Streamable HTTP and SSE fallback probes)
  const handleMcp = async (req: Request, res: Response) => {
    // If client requested Server-Sent Events (SSE probe on /mcp), negotiate SSE transport
    if (req.method === "GET" && req.headers.accept?.includes("text/event-stream")) {
      return handleSse(req, res);
    }

    try {
      const auth = extractAuth(req);

      await authStorage.run(auth, async () => {
        // If client sends a GET probe without text/event-stream, respond with active MCP info
        if (req.method === "GET") {
          const pathToken = getPathToken(req);
          res.json({
            status: "ok",
            protocol: "mcp",
            authenticated: true,
            transport: "streamable-http",
            sseEndpoint: pathToken ? `/s/${encodeURIComponent(pathToken)}/sse` : "/sse",
          });
          return;
        }

        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        // 1. Route to existing stateful session if session ID is provided and known
        if (sessionId && httpSessions.has(sessionId)) {
          const session = httpSessions.get(sessionId)!;
          session.lastActive = Date.now();
          await session.transport.handleRequest(req, res, req.body);
          return;
        }

        // 2. If initialization request, establish a new stateful session
        const isInit =
          (req.body && req.body.method === "initialize") ||
          (Array.isArray(req.body) && req.body.some((m: any) => m?.method === "initialize"));

        if (isInit) {
          const { server: sessionServer } = createMcpServer(config);
          let assignedSessionId: string | undefined;

          const sessionTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => {
              assignedSessionId = crypto.randomUUID();
              return assignedSessionId;
            },
            onsessioninitialized: (id) => {
              httpSessions.set(id, {
                server: sessionServer,
                transport: sessionTransport,
                auth,
                createdAt: Date.now(),
                lastActive: Date.now(),
              });
            },
          });

          sessionTransport.onclose = () => {
            if (assignedSessionId) {
              httpSessions.delete(assignedSessionId);
            }
          };

          await sessionServer.connect(sessionTransport);
          await sessionTransport.handleRequest(req, res, req.body);
          return;
        }

        // 3. Fallback: Stateless request (fresh transport per request prevents reuse collisions)
        const { server: statelessServer } = createMcpServer(config);
        const statelessTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await statelessServer.connect(statelessTransport);
        await statelessTransport.handleRequest(req, res, req.body);
      });
    } catch (err: any) {
      console.error("[MCP HTTP /mcp Error]:", err);
      res.status(err.statusCode || (err.name === "ObsidianMcpError" ? 401 : 500)).json(
        err.toJSON ? err.toJSON() : { error: err.message }
      );
    }
  };

  app.all(["/mcp", "/s/:token/mcp", "/s/:token"], handleMcp);
  app.get(["/sse", "/s/:token/sse"], handleSse);

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

  app.post(["/messages", "/s/:token/messages"], handleMessages);

  return {
    app,
    sseSessions,
    httpSessions,
    cleanupInterval,
  };
}

export async function runHttpServer(config: AppConfig) {
  const { app, sseSessions, httpSessions, cleanupInterval } = await createHttpApp(config);

  const httpServer = app.listen(config.PORT, config.HOST, () => {
    console.log(
      `Obsidian MCP Server listening on http://${config.HOST}:${config.PORT} (Streamable HTTP /mcp, Legacy /sse)`
    );
  });

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Gracefully shutting down Obsidian MCP server...`);
    clearInterval(cleanupInterval);

    for (const [_id, record] of httpSessions.entries()) {
      try {
        await record.transport.close();
      } catch {
        // Ignore session close error
      }
    }
    httpSessions.clear();

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
