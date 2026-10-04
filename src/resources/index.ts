import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VaultService } from "../services/vault.service.js";

export function registerResources(server: McpServer, vaultService: VaultService) {
  // 0. obsidian://vaults
  server.registerResource(
    "vaults-list",
    "obsidian://vaults",
    { description: "List of all configured Obsidian vaults and active default", mimeType: "application/json" },
    async (uri) => {
      const data = await vaultService.listVaults();
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // 1. obsidian://vault
  server.registerResource(
    "vault-info",
    "obsidian://vault",
    { description: "General vault metadata, file counts, and connectivity status for default vault", mimeType: "application/json" },
    async (uri) => {
      const data = await vaultService.getVault();
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // 2. obsidian://daily/today
  server.registerResource(
    "daily-today",
    "obsidian://daily/today",
    { description: "Direct content of today's daily note", mimeType: "text/markdown" },
    async (uri) => {
      const data = await vaultService.readDailyNote();
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: data.content }],
      };
    }
  );

  // 3. obsidian://tasks
  server.registerResource(
    "vault-tasks",
    "obsidian://tasks",
    { description: "Vault-wide list of pending tasks", mimeType: "application/json" },
    async (uri) => {
      const data = await vaultService.listTasks(undefined, "todo");
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // 4. obsidian://tags
  server.registerResource(
    "vault-tags",
    "obsidian://tags",
    { description: "Vault-wide tags inventory and counts", mimeType: "application/json" },
    async (uri) => {
      const data = await vaultService.getTags();
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // 5. obsidian://note/{path}
  server.registerResource(
    "vault-note",
    new ResourceTemplate("obsidian://note/{path}", { list: undefined }),
    { description: "Read-only access to a specific vault note by relative path", mimeType: "text/markdown" },
    async (uri, variables) => {
      const notePath = String(variables.path);
      const data = await vaultService.readNote(notePath);
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: data.content }],
      };
    }
  );

  // 6. obsidian://folder/{path}
  server.registerResource(
    "vault-folder",
    new ResourceTemplate("obsidian://folder/{path}", { list: undefined }),
    { description: "Folder contents and file listing", mimeType: "application/json" },
    async (uri, variables) => {
      const folderPath = String(variables.path);
      const data = await vaultService.listFiles(folderPath, false);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // 7. obsidian://base/{path}
  server.registerResource(
    "vault-base",
    new ResourceTemplate("obsidian://base/{path}", { list: undefined }),
    { description: "Direct schema and query definitions of a .base file", mimeType: "application/json" },
    async (uri, variables) => {
      const basePath = String(variables.path);
      const data = await vaultService.queryBase(basePath);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
