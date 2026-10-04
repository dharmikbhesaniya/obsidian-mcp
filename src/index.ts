/**
 * Obsidian Remote MCP Server Entrypoint
 * Standalone capability layer for remote Obsidian knowledge systems.
 */

export function main() {
  console.log("Obsidian MCP Server initialized.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main();
}
