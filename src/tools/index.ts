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
  server.tool("obsidian_get_vault", "Returns vault metadata, file counts, and connectivity status", Schemas.GetVaultSchema.shape, wrapHandler("obsidian_get_vault", () => vaultService.getVault()));
  server.tool("obsidian_list_files", "Lists files and subdirectories under a vault folder", Schemas.ListFilesSchema.shape, wrapHandler("obsidian_list_files", (args) => vaultService.listFiles(args.folder, args.recursive)));
  server.tool("obsidian_get_file_info", "Retrieves size, modification timestamp, and metadata of a file", Schemas.GetFileInfoSchema.shape, wrapHandler("obsidian_get_file_info", (args) => vaultService.getFileInfo(args.path)));

  // 2. Notes Domain
  server.tool("obsidian_read_note", "Reads the full content and frontmatter of a vault note", Schemas.ReadNoteSchema.shape, wrapHandler("obsidian_read_note", (args) => vaultService.readNote(args.path)));
  server.tool("obsidian_create_note", "Creates a new note with optional template", Schemas.CreateNoteSchema.shape, wrapHandler("obsidian_create_note", (args) => vaultService.createNote(args.path, args.content, args.template, args.overwrite)));
  server.tool("obsidian_append_note", "Appends text content to an existing note with revision check", Schemas.AppendNoteSchema.shape, wrapHandler("obsidian_append_note", (args) => vaultService.appendNote(args.path, args.content, args.ensureNewline, args.expectedRevision)));
  server.tool("obsidian_prepend_note", "Prepends text content below frontmatter in an existing note with revision check", Schemas.PrependNoteSchema.shape, wrapHandler("obsidian_prepend_note", (args) => vaultService.prependNote(args.path, args.content, args.expectedRevision)));
  server.tool("obsidian_update_note", "Updates note content with optimistic revision control", Schemas.UpdateNoteSchema.shape, wrapHandler("obsidian_update_note", (args) => vaultService.updateNote(args.path, args.content, args.expectedRevision)));

  // Conditionally register destructive tools based on configuration
  if (!config || config.ENABLE_DESTRUCTIVE_TOOLS !== false) {
    server.tool("obsidian_move_note", "Moves or renames a note within the vault with revision check", Schemas.MoveNoteSchema.shape, wrapHandler("obsidian_move_note", (args) => vaultService.moveNote(args.sourcePath, args.targetPath, args.expectedRevision)));
    server.tool("obsidian_delete_note", "Deletes or moves a note to the vault trash with revision check", Schemas.DeleteNoteSchema.shape, wrapHandler("obsidian_delete_note", (args) => vaultService.deleteNote(args.path, args.permanent, args.expectedRevision)));
  }

  // 3. Search Domain
  server.tool("obsidian_search", "Performs full-text vault search returning file matches and line numbers", Schemas.SearchSchema.shape, wrapHandler("obsidian_search", (args) => vaultService.search(args.query, args.limit)));
  server.tool("obsidian_search_context", "Performs full-text vault search returning contextual lines around matches", Schemas.SearchContextSchema.shape, wrapHandler("obsidian_search_context", (args) => vaultService.searchContext(args.query, args.contextLines, args.limit)));

  // 4. Daily Notes Domain
  server.tool("obsidian_read_daily_note", "Reads today's or a specific date's daily note", Schemas.ReadDailyNoteSchema.shape, wrapHandler("obsidian_read_daily_note", (args) => vaultService.readDailyNote(args.date)));
  server.tool("obsidian_append_daily_note", "Appends a work item or note to the daily note with revision check", Schemas.AppendDailyNoteSchema.shape, wrapHandler("obsidian_append_daily_note", (args) => vaultService.appendDailyNote(args.content, args.date, args.expectedRevision)));
  server.tool("obsidian_prepend_daily_note", "Prepends text to the daily note with revision check", Schemas.PrependDailyNoteSchema.shape, wrapHandler("obsidian_prepend_daily_note", (args) => vaultService.prependDailyNote(args.content, args.date, args.expectedRevision)));

  // 5. Properties Domain
  server.tool("obsidian_get_properties", "Retrieves all frontmatter properties of a note", Schemas.GetPropertiesSchema.shape, wrapHandler("obsidian_get_properties", (args) => vaultService.getProperties(args.path)));
  server.tool("obsidian_get_property", "Retrieves a specific frontmatter property value", Schemas.GetPropertySchema.shape, wrapHandler("obsidian_get_property", (args) => vaultService.getProperty(args.path, args.name)));
  server.tool("obsidian_set_property", "Sets or updates a frontmatter property with structured types and revision check", Schemas.SetPropertySchema.shape, wrapHandler("obsidian_set_property", (args) => vaultService.setProperty(args.path, args.name, args.value, args.expectedRevision)));
  server.tool("obsidian_remove_property", "Removes a frontmatter property from a note with revision check", Schemas.RemovePropertySchema.shape, wrapHandler("obsidian_remove_property", (args) => vaultService.removeProperty(args.path, args.name, args.expectedRevision)));

  // 6. Tasks Domain
  server.tool("obsidian_list_tasks", "Lists pending or completed tasks vault-wide or in a note", Schemas.ListTasksSchema.shape, wrapHandler("obsidian_list_tasks", (args) => vaultService.listTasks(args.path, args.status)));
  server.tool("obsidian_toggle_task", "Toggles the completion checkbox on a specific line of a note with verification", Schemas.ToggleTaskSchema.shape, wrapHandler("obsidian_toggle_task", (args) => vaultService.toggleTask(args.path, args.line, args.expectedRevision, args.expectedText)));

  // 7. Graph & Links Domain
  server.tool("obsidian_get_backlinks", "Lists all incoming links referencing a target note", Schemas.GetBacklinksSchema.shape, wrapHandler("obsidian_get_backlinks", (args) => vaultService.getBacklinks(args.path)));
  server.tool("obsidian_get_links", "Lists all outgoing internal links within a note", Schemas.GetLinksSchema.shape, wrapHandler("obsidian_get_links", (args) => vaultService.getLinks(args.path)));
  server.tool("obsidian_get_orphans", "Discovers orphaned notes that have no internal links", Schemas.GetOrphansSchema.shape, wrapHandler("obsidian_get_orphans", () => vaultService.getOrphans()));
  server.tool("obsidian_get_unresolved_links", "Lists broken internal wikilinks pointing to non-existent notes", Schemas.GetUnresolvedLinksSchema.shape, wrapHandler("obsidian_get_unresolved_links", () => vaultService.getUnresolvedLinks()));
  server.tool("obsidian_get_deadends", "Lists notes with incoming links but zero outgoing links", Schemas.GetDeadendsSchema.shape, wrapHandler("obsidian_get_deadends", () => vaultService.getDeadends()));

  // 8. Tags & Bases Domain
  server.tool("obsidian_get_tags", "Returns all tags and their occurrence counts", Schemas.GetTagsSchema.shape, wrapHandler("obsidian_get_tags", () => vaultService.getTags()));
  server.tool("obsidian_get_tag_notes", "Retrieves all notes tagged with a specific tag", Schemas.GetTagNotesSchema.shape, wrapHandler("obsidian_get_tag_notes", (args) => vaultService.getTagNotes(args.tag)));
  server.tool("obsidian_list_bases", "Lists all .base database schema files in the vault", Schemas.ListBasesSchema.shape, wrapHandler("obsidian_list_bases", () => vaultService.listBases()));
  server.tool("obsidian_query_base", "Queries a .base database view", Schemas.QueryBaseSchema.shape, wrapHandler("obsidian_query_base", (args) => vaultService.queryBase(args.path, args.view)));

  // 9. Context & Intelligence Domain
  server.tool(
    "obsidian_get_note_context",
    "Retrieves full note context (content, frontmatter, headings, backlinks, and related notes) with budget options",
    Schemas.GetNoteContextSchema.shape,
    wrapHandler("obsidian_get_note_context", (args) =>
      vaultService.getNoteContext(args.path, {
        include: args.include,
        maxRelatedNotes: args.maxRelatedNotes,
      })
    )
  );
  server.tool(
    "obsidian_find_notes",
    "Multi-criteria note discovery by title, tag, folder, property, or content query",
    Schemas.FindNotesSchema.shape,
    wrapHandler("obsidian_find_notes", (args) => vaultService.findNotes(args))
  );
  server.tool(
    "obsidian_recent_changes",
    "Lists notes recently modified or created within the vault for change awareness",
    Schemas.RecentChangesSchema.shape,
    wrapHandler("obsidian_recent_changes", (args) => vaultService.recentChanges(args))
  );

  // 10. Escape Hatch (Gated behind ENABLE_ADVANCED_CLI and vault:developer scope)
  if (config?.ENABLE_ADVANCED_CLI === true) {
    server.tool("obsidian_cli", "Controlled execution of allowlisted Obsidian CLI commands", Schemas.ObsidianCliSchema.shape, wrapHandler("obsidian_cli", (args) => vaultService.executeCli(args.command, args.args)));
  }
}
