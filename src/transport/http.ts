import express, { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { AppConfig } from "../config/config.js";
import { createMcpServer } from "../server.js";
import { AuthContext } from "../security/auth.js";
import fs from "node:fs";

export async function runHttpServer(config: AppConfig) {
  const app = express();
  app.use(express.json());

  // Store active transport per connection
  let currentAuth: AuthContext = {
    clientId: "anonymous",
    scopes: [],
    authenticated: false,
  };

  const { server, cliAdapter, pathGuard, authManager } = createMcpServer(
    config,
    () => currentAuth
  );

  const transports = new Map<string, SSEServerTransport>();

  // Operational Health Checks
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      mcp: "running",
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
      vaultPath: pathGuard.getVaultRoot(),
      timestamp: new Date().toISOString(),
    });
  });

  // Authentication Middleware for MCP endpoints
  const authMiddleware = (req: Request, res: Response, next: Function) => {
    try {
      currentAuth = authManager.authenticateHeader(req.headers.authorization);
      next();
    } catch (err: any) {
      res.status(err.statusCode || 401).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
  };

  // SSE Transport Handshake
  app.get("/sse", authMiddleware, async (_req: Request, res: Response) => {
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);

    transport.onclose = () => {
      transports.delete(transport.sessionId);
    };

    await server.connect(transport);
  });

  // Message Handler
  app.post("/messages", authMiddleware, async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId);
    const transport = transports.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: "Session not found or expired" });
      return;
    }

    await transport.handlePostMessage(req, res);
  });

  app.listen(config.PORT, config.HOST, () => {
    console.log(
      `Obsidian MCP Server listening on http://${config.HOST}:${config.PORT} (Transport: HTTP/SSE)`
    );
  });
}
