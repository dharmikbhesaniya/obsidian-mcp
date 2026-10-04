#!/usr/bin/env node
import { loadConfig } from "./config/config.js";
import { runStdioServer } from "./transport/stdio.js";
import { runHttpServer } from "./transport/http.js";

async function main() {
  const config = loadConfig();

  // Allow CLI flag overrides e.g. --transport=http or --transport=stdio
  const transportArg = process.argv.find((arg) => arg.startsWith("--transport="));
  const transportMode = transportArg ? transportArg.split("=")[1] : config.MCP_TRANSPORT;

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
