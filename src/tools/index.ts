import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VaultService } from "../services/vault.service.js";
import { AuthManager, AuthContext, getCurrentAuthContext } from "../security/auth.js";
import { RateLimiter } from "../security/rate-limit.js";
import { AuditLogger } from "../security/audit.js";
import { TOOL_SCOPES } from "../config/scopes.js";
import { AppConfig } from "../config/config.js";
import * as Schemas from "../schemas/tools.js";

export function registerTools(
  server: McpServer,
  vaultService: VaultService,
  authManager: AuthManager,
  rateLimiter: RateLimiter,
  auditLogger: AuditLogger,
  config?: AppConfig,
  getAuthContext?: () => AuthContext
) {
  // Helper to wrap tool execution with Auth, Rate-limiting, and Audit logging
  const wrapHandler = (toolName: string, fn: (args: any) => Promise<any>) => {
    return async (args: any) => {
      const start = Date.now();
      const requestId = crypto.randomUUID();
      const auth = getAuthContext ? getAuthContext() : getCurrentAuthContext();

      try {
        rateLimiter.checkRateLimit(auth.clientId);
        const requiredScope = TOOL_SCOPES[toolName];
        if (requiredScope) {
          authManager.enforceScope(auth, requiredScope, toolName);
        }

        const result = await fn(args);
        auditLogger.log({
          timestamp: new Date().toISOString(),
          requestId,
          clientId: auth.clientId,
          tool: toolName,
          path: args?.path || args?.sourcePath,
          status: "success",
          durationMs: Date.now() - start,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        auditLogger.log({
          timestamp: new Date().toISOString(),
          requestId,
          clientId: auth.clientId,
          tool: toolName,
          path: args?.path || args?.sourcePath,
          status: "error",
          durationMs: Date.now() - start,
          errorCode: err.code || "INTERNAL_ERROR",
        });

        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                err.toJSON ? err.toJSON() : { error: { code: "INTERNAL_ERROR", message: err.message } },
                null,
                2
              ),
            },
          ],
        };
      }
    };
  };

  // 1. Vault Domain
  server.registerTool("obsidian_get_vault", { description: "Returns vault metadata, file counts, and connectivity status", inputSchema: Schemas.GetVaultSchema.shape }, wrapHandler("obsidian_get_vault", () => vaultService.getVault()));
  server.registerTool("obsidian_list_files", { description: "Lists files and subdirectories under a vault folder", inputSchema: Schemas.ListFilesSchema.shape }, wrapHandler("obsidian_list_files", (args) => vaultService.listFiles(args.folder, args.recursive)));
  server.registerTool("obsidian_get_file_info", { description: "Retrieves size, modification timestamp, and metadata of a file", inputSchema: Schemas.GetFileInfoSchema.shape }, wrapHandler("obsidian_get_file_info", (args) => vaultService.getFileInfo(args.path)));

  // 2. Notes Domain
  server.registerTool("obsidian_read_note", { description: "Reads the full content and frontmatter of a vault note with comment stripping option", inputSchema: Schemas.ReadNoteSchema.shape }, wrapHandler("obsidian_read_note", (args) => vaultService.readNote(args.path, args.stripComments)));
  server.registerTool("obsidian_create_note", { description: "Creates a new note with optional template", inputSchema: Schemas.CreateNoteSchema.shape }, wrapHandler("obsidian_create_note", (args) => vaultService.createNote(args.path, args.content, args.template, args.overwrite)));
  server.registerTool("obsidian_append_note", { description: "Appends text content to an existing note with revision check", inputSchema: Schemas.AppendNoteSchema.shape }, wrapHandler("obsidian_append_note", (args) => vaultService.appendNote(args.path, args.content, args.ensureNewline, args.expectedRevision)));
  server.registerTool("obsidian_prepend_note", { description: "Prepends text content below frontmatter in an existing note with revision check", inputSchema: Schemas.PrependNoteSchema.shape }, wrapHandler("obsidian_prepend_note", (args) => vaultService.prependNote(args.path, args.content, args.expectedRevision)));
  server.registerTool("obsidian_update_note", { description: "Updates note content with optimistic revision control", inputSchema: Schemas.UpdateNoteSchema.shape }, wrapHandler("obsidian_update_note", (args) => vaultService.updateNote(args.path, args.content, args.expectedRevision || args.ifMatch)));
  server.registerTool("obsidian_patch_note", { description: "Surgically updates, appends to, or prepends to a note heading section or block ID without rewriting the entire note", inputSchema: Schemas.PatchNoteSchema.shape }, wrapHandler("obsidian_patch_note", (args) => vaultService.patchNote(args.path, args.target, args.operation, args.content, args.expectedRevision || args.ifMatch)));

  // Conditionally register destructive tools based on configuration
  if (!config || config.ENABLE_DESTRUCTIVE_TOOLS !== false) {
    server.registerTool("obsidian_move_note", { description: "Moves or renames a note within the vault with automatic backlink updating and revision check", inputSchema: Schemas.MoveNoteSchema.shape }, wrapHandler("obsidian_move_note", (args) => vaultService.moveNote(args.sourcePath, args.targetPath, args.expectedRevision || args.ifMatch, args.updateBacklinks)));
    server.registerTool("obsidian_delete_note", { description: "Deletes or moves a note to the safe vault trash (.obsidian-mcp/trash) with revision check", inputSchema: Schemas.DeleteNoteSchema.shape }, wrapHandler("obsidian_delete_note", (args) => vaultService.deleteNote(args.path, args.permanent, args.expectedRevision || args.ifMatch)));
  }

  // 3. Search Domain
  server.registerTool("obsidian_search", { description: "Performs full-text vault search returning file matches and line numbers", inputSchema: Schemas.SearchSchema.shape }, wrapHandler("obsidian_search", (args) => vaultService.search(args.query, args.limit)));
  server.registerTool("obsidian_search_context", { description: "Performs full-text vault search returning contextual lines around matches", inputSchema: Schemas.SearchContextSchema.shape }, wrapHandler("obsidian_search_context", (args) => vaultService.searchContext(args.query, args.contextLines, args.limit)));

  // 4. Daily Notes Domain
  server.registerTool("obsidian_read_daily_note", { description: "Reads today's or a specific date's daily note", inputSchema: Schemas.ReadDailyNoteSchema.shape }, wrapHandler("obsidian_read_daily_note", (args) => vaultService.readDailyNote(args.date)));
  server.registerTool("obsidian_append_daily_note", { description: "Appends a work item or note to the daily note with revision check", inputSchema: Schemas.AppendDailyNoteSchema.shape }, wrapHandler("obsidian_append_daily_note", (args) => vaultService.appendDailyNote(args.content, args.date, args.expectedRevision)));
  server.registerTool("obsidian_prepend_daily_note", { description: "Prepends text to the daily note with revision check", inputSchema: Schemas.PrependDailyNoteSchema.shape }, wrapHandler("obsidian_prepend_daily_note", (args) => vaultService.prependDailyNote(args.content, args.date, args.expectedRevision)));

  // 5. Properties Domain
  server.registerTool("obsidian_get_properties", { description: "Retrieves all frontmatter properties of a note", inputSchema: Schemas.GetPropertiesSchema.shape }, wrapHandler("obsidian_get_properties", (args) => vaultService.getProperties(args.path)));
  server.registerTool("obsidian_get_property", { description: "Retrieves a specific frontmatter property value", inputSchema: Schemas.GetPropertySchema.shape }, wrapHandler("obsidian_get_property", (args) => vaultService.getProperty(args.path, args.name)));
  server.registerTool("obsidian_set_property", { description: "Sets or updates a frontmatter property with structured types and revision check", inputSchema: Schemas.SetPropertySchema.shape }, wrapHandler("obsidian_set_property", (args) => vaultService.setProperty(args.path, args.name, args.value, args.expectedRevision)));
  server.registerTool("obsidian_remove_property", { description: "Removes a frontmatter property from a note with revision check", inputSchema: Schemas.RemovePropertySchema.shape }, wrapHandler("obsidian_remove_property", (args) => vaultService.removeProperty(args.path, args.name, args.expectedRevision)));

  // 6. Tasks Domain
  server.registerTool("obsidian_list_tasks", { description: "Lists pending or completed tasks vault-wide or in a note", inputSchema: Schemas.ListTasksSchema.shape }, wrapHandler("obsidian_list_tasks", (args) => vaultService.listTasks(args.path, args.status)));
  server.registerTool("obsidian_toggle_task", { description: "Toggles the completion checkbox on a specific line of a note with verification", inputSchema: Schemas.ToggleTaskSchema.shape }, wrapHandler("obsidian_toggle_task", (args) => vaultService.toggleTask(args.path, args.line, args.expectedRevision, args.expectedText)));

  // 7. Graph & Links Domain
  server.registerTool("obsidian_get_backlinks", { description: "Lists all incoming links referencing a target note", inputSchema: Schemas.GetBacklinksSchema.shape }, wrapHandler("obsidian_get_backlinks", (args) => vaultService.getBacklinks(args.path)));
  server.registerTool("obsidian_get_links", { description: "Lists all outgoing internal links within a note", inputSchema: Schemas.GetLinksSchema.shape }, wrapHandler("obsidian_get_links", (args) => vaultService.getLinks(args.path)));
  server.registerTool("obsidian_get_link_path", { description: "Finds the shortest wikilink connection path between two notes using breadth-first search", inputSchema: Schemas.GetLinkPathSchema.shape }, wrapHandler("obsidian_get_link_path", (args) => vaultService.getLinkPath(args.from, args.to, args.maxDepth)));
  server.registerTool("obsidian_get_orphans", { description: "Discovers orphaned notes that have no internal links", inputSchema: Schemas.GetOrphansSchema.shape }, wrapHandler("obsidian_get_orphans", () => vaultService.getOrphans()));
  server.registerTool("obsidian_get_unresolved_links", { description: "Lists broken internal wikilinks pointing to non-existent notes", inputSchema: Schemas.GetUnresolvedLinksSchema.shape }, wrapHandler("obsidian_get_unresolved_links", () => vaultService.getUnresolvedLinks()));
  server.registerTool("obsidian_get_deadends", { description: "Lists notes with incoming links but zero outgoing links", inputSchema: Schemas.GetDeadendsSchema.shape }, wrapHandler("obsidian_get_deadends", () => vaultService.getDeadends()));

  // 8. Tags & Bases Domain
  server.registerTool("obsidian_get_tags", { description: "Returns all tags and their occurrence counts", inputSchema: Schemas.GetTagsSchema.shape }, wrapHandler("obsidian_get_tags", () => vaultService.getTags()));
  server.registerTool("obsidian_get_tag_notes", { description: "Retrieves all notes tagged with a specific tag", inputSchema: Schemas.GetTagNotesSchema.shape }, wrapHandler("obsidian_get_tag_notes", (args) => vaultService.getTagNotes(args.tag)));
  server.registerTool("obsidian_list_bases", { description: "Lists all .base database schema files in the vault", inputSchema: Schemas.ListBasesSchema.shape }, wrapHandler("obsidian_list_bases", () => vaultService.listBases()));
  server.registerTool("obsidian_query_base", { description: "Queries a .base database view", inputSchema: Schemas.QueryBaseSchema.shape }, wrapHandler("obsidian_query_base", (args) => vaultService.queryBase(args.path, args.view)));

  // 9. Context & Intelligence Domain
  server.registerTool(
    "obsidian_get_note_context",
    {
      description: "Retrieves full note context (content, frontmatter, headings, backlinks, and related notes) with budget options and comment stripping",
      inputSchema: Schemas.GetNoteContextSchema.shape,
    },
    wrapHandler("obsidian_get_note_context", (args) =>
      vaultService.getNoteContext(args.path, {
        stripComments: args.stripComments,
        include: args.include,
        maxRelatedNotes: args.maxRelatedNotes,
      })
    )
  );
  server.registerTool(
    "obsidian_find_notes",
    {
      description: "Multi-criteria note discovery by title, tag, folder, property, or content query",
      inputSchema: Schemas.FindNotesSchema.shape,
    },
    wrapHandler("obsidian_find_notes", (args) => vaultService.findNotes(args))
  );
  server.registerTool(
    "obsidian_recent_changes",
    {
      description: "Lists notes recently modified or created within the vault for change awareness",
      inputSchema: Schemas.RecentChangesSchema.shape,
    },
    wrapHandler("obsidian_recent_changes", (args) => vaultService.recentChanges(args))
  );

  // 10. Escape Hatch (Gated behind ENABLE_ADVANCED_CLI and vault:developer scope)
  if (config?.ENABLE_ADVANCED_CLI === true) {
    server.registerTool(
      "obsidian_cli",
      {
        description: "Controlled execution of allowlisted Obsidian CLI commands",
        inputSchema: Schemas.ObsidianCliSchema.shape,
      },
      wrapHandler("obsidian_cli", (args) => vaultService.executeCli(args.command, args.args))
    );
  }
}
