#!/usr/bin/env node
import { loadConfig } from "./config/config.js";
import { runStdioServer } from "./transport/stdio.js";
import { runHttpServer } from "./transport/http.js";

async function main() {
  const config = loadConfig();

  // Allow CLI flag overrides e.g. --transport=http, --port=8080, --host=0.0.0.0
  const transportArg = process.argv.find((arg) => arg.startsWith("--transport="));
  const transportMode = transportArg ? transportArg.split("=")[1] : config.MCP_TRANSPORT;

  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  if (portArg) {
    const portVal = parseInt(portArg.split("=")[1], 10);
    if (!isNaN(portVal) && portVal > 0 && portVal <= 65535) {
      config.PORT = portVal;
    }
  }

  const hostArg = process.argv.find((arg) => arg.startsWith("--host="));
  if (hostArg) {
    const hostVal = hostArg.split("=")[1]?.trim();
    if (hostVal) {
      config.HOST = hostVal;
    }
  }

  if (transportMode === "http") {
    await runHttpServer(config);
  } else {
    await runStdioServer(config);
  }
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
