/**
 * Permission Scopes & Access Control Matrix for Obsidian MCP
 */

export const Scope = {
  VAULT_READ: "vault:read",
  VAULT_WRITE: "vault:write",
  VAULT_DELETE: "vault:delete",
  VAULT_ADMIN: "vault:admin",
  VAULT_DEVELOPER: "vault:developer",
} as const;

export type ScopeType = (typeof Scope)[keyof typeof Scope];

/**
 * Tool to Required Scope Mapping
 */
export const TOOL_SCOPES: Record<string, ScopeType> = {
  // Vault domain
  obsidian_list_vaults: Scope.VAULT_READ,
  obsidian_get_vault: Scope.VAULT_READ,
  obsidian_list_files: Scope.VAULT_READ,
  obsidian_get_file_info: Scope.VAULT_READ,

  // Notes domain
  obsidian_read_note: Scope.VAULT_READ,
  obsidian_create_note: Scope.VAULT_WRITE,
  obsidian_append_note: Scope.VAULT_WRITE,
  obsidian_prepend_note: Scope.VAULT_WRITE,
  obsidian_update_note: Scope.VAULT_WRITE,
  obsidian_patch_note: Scope.VAULT_WRITE,
  obsidian_move_note: Scope.VAULT_DELETE,
  obsidian_delete_note: Scope.VAULT_DELETE,

  // Search domain
  obsidian_search: Scope.VAULT_READ,
  obsidian_search_context: Scope.VAULT_READ,

  // Daily notes domain
  obsidian_read_daily_note: Scope.VAULT_READ,
  obsidian_append_daily_note: Scope.VAULT_WRITE,
  obsidian_prepend_daily_note: Scope.VAULT_WRITE,

  // Properties domain
  obsidian_get_properties: Scope.VAULT_READ,
  obsidian_get_property: Scope.VAULT_READ,
  obsidian_set_property: Scope.VAULT_WRITE,
  obsidian_remove_property: Scope.VAULT_WRITE,

  // Tasks domain
  obsidian_list_tasks: Scope.VAULT_READ,
  obsidian_toggle_task: Scope.VAULT_WRITE,

  // Links & Graph domain
  obsidian_get_backlinks: Scope.VAULT_READ,
  obsidian_get_links: Scope.VAULT_READ,
  obsidian_get_link_path: Scope.VAULT_READ,
  obsidian_get_orphans: Scope.VAULT_READ,
  obsidian_get_unresolved_links: Scope.VAULT_READ,
  obsidian_get_deadends: Scope.VAULT_READ,

  // Tags & Bases domain
  obsidian_get_tags: Scope.VAULT_READ,
  obsidian_get_tag_notes: Scope.VAULT_READ,
  obsidian_list_bases: Scope.VAULT_READ,
  obsidian_query_base: Scope.VAULT_READ,

  // Context & Intelligence domain
  obsidian_get_note_context: Scope.VAULT_READ,
  obsidian_find_notes: Scope.VAULT_READ,
  obsidian_recent_changes: Scope.VAULT_READ,

  // Bookmarks domain
  obsidian_list_bookmarks: Scope.VAULT_READ,
  obsidian_create_bookmark: Scope.VAULT_WRITE,

  // Outline domain
  obsidian_get_outline: Scope.VAULT_READ,
  obsidian_outline: Scope.VAULT_READ,

  // Aliases domain
  obsidian_list_aliases: Scope.VAULT_READ,
  obsidian_get_aliases: Scope.VAULT_READ,

  // Templates domain
  obsidian_list_templates: Scope.VAULT_READ,
  obsidian_read_template: Scope.VAULT_READ,

  // Word Count & Stats domain
  obsidian_word_count: Scope.VAULT_READ,

  // Random & Discovery domain
  obsidian_random_note: Scope.VAULT_READ,

  // Unique Notes domain
  obsidian_create_unique_note: Scope.VAULT_WRITE,

  // Desktop Integration domain
  obsidian_open_note: Scope.VAULT_READ,
  obsidian_open_in_app: Scope.VAULT_READ,

  // Plugins & Snippets domain
  obsidian_list_plugins: Scope.VAULT_READ,
  obsidian_list_snippets: Scope.VAULT_READ,

  // Commands domain
  obsidian_list_commands: Scope.VAULT_READ,
  obsidian_execute_command: Scope.VAULT_DEVELOPER,

  // Advanced / Escape Hatch
  obsidian_cli: Scope.VAULT_DEVELOPER,
};

/**
 * Checks if a set of granted scopes satisfies the required scope.
 * Admin scope inherits write, delete, and read.
 */
export function hasRequiredScope(grantedScopes: ScopeType[], requiredScope: ScopeType): boolean {
  if (grantedScopes.includes(Scope.VAULT_ADMIN)) {
    if (requiredScope !== Scope.VAULT_DEVELOPER) return true;
  }
  return grantedScopes.includes(requiredScope);
}
