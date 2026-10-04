/**
 * Centralized Obsidian CLI Command Registry & Policy Definition
 * Single source of truth for allowed commands, scopes, and capabilities.
 */

import { Scope, ScopeType } from "./scopes.js";

export interface CliCommandMetadata {
  command: string;
  category:
    | "system"
    | "notes"
    | "search"
    | "daily"
    | "tasks"
    | "tags"
    | "properties"
    | "links"
    | "bookmarks"
    | "templates"
    | "bases"
    | "desktop"
    | "plugins"
    | "snippets"
    | "commands";
  readOnly: boolean;
  requiredScope: ScopeType;
  supportsVault: boolean;
  supportsPath: boolean;
  dangerous: boolean;
  description: string;
}

export const OBSIDIAN_CLI_COMMAND_REGISTRY: Record<string, CliCommandMetadata> = {
  // System & Vault info
  version: {
    command: "version",
    category: "system",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: false,
    supportsPath: false,
    dangerous: false,
    description: "Print Obsidian desktop version",
  },
  files: {
    command: "files",
    category: "system",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List all files in vault",
  },
  folders: {
    command: "folders",
    category: "system",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List all folders in vault",
  },
  file: {
    command: "file",
    category: "system",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Get file info and metadata",
  },

  // Search
  search: {
    command: "search",
    category: "search",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Search notes across vault",
  },
  "search:context": {
    command: "search:context",
    category: "search",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Search with surrounding context lines",
  },

  // Tasks
  tasks: {
    command: "tasks",
    category: "tasks",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "List tasks across vault or file",
  },
  task: {
    command: "task",
    category: "tasks",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Toggle task checkbox at line",
  },

  // Graph, Links & Tags
  backlinks: {
    command: "backlinks",
    category: "links",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "List backlinks to note",
  },
  links: {
    command: "links",
    category: "links",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "List outgoing links from note",
  },
  orphans: {
    command: "orphans",
    category: "links",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List orphaned notes with no links",
  },
  unresolved: {
    command: "unresolved",
    category: "links",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List unresolved/broken wikilinks",
  },
  deadends: {
    command: "deadends",
    category: "links",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List notes with no outgoing links",
  },
  tags: {
    command: "tags",
    category: "tags",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "List all tags with counts",
  },
  tag: {
    command: "tag",
    category: "tags",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List notes matching tag",
  },

  // Frontmatter Properties
  properties: {
    command: "properties",
    category: "properties",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "List frontmatter properties",
  },
  "property:read": {
    command: "property:read",
    category: "properties",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Read single property value",
  },
  "property:set": {
    command: "property:set",
    category: "properties",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Set property value in frontmatter",
  },
  "property:remove": {
    command: "property:remove",
    category: "properties",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Remove property from frontmatter",
  },
  aliases: {
    command: "aliases",
    category: "properties",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "List aliases from frontmatter",
  },

  // Obsidian Bases
  bases: {
    command: "bases",
    category: "bases",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List all .base files in vault",
  },
  "base:query": {
    command: "base:query",
    category: "bases",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Query database records and formulas from a .base file",
  },
  "base:views": {
    command: "base:views",
    category: "bases",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "List views defined in a .base file",
  },
  "base:create": {
    command: "base:create",
    category: "bases",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Create a new .base file",
  },

  // Outline
  outline: {
    command: "outline",
    category: "notes",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Get structured heading outline",
  },

  // Daily Notes
  daily: {
    command: "daily",
    category: "daily",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Open daily note in UI",
  },
  "daily:read": {
    command: "daily:read",
    category: "daily",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Read today's daily note",
  },
  "daily:path": {
    command: "daily:path",
    category: "daily",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Get path of daily note",
  },
  "daily:append": {
    command: "daily:append",
    category: "daily",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Append content to daily note",
  },
  "daily:prepend": {
    command: "daily:prepend",
    category: "daily",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Prepend content to daily note",
  },

  // Bookmarks
  bookmarks: {
    command: "bookmarks",
    category: "bookmarks",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List bookmarks in vault",
  },
  bookmark: {
    command: "bookmark",
    category: "bookmarks",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Create bookmark for file or query",
  },

  // Templates
  templates: {
    command: "templates",
    category: "templates",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List template files in vault",
  },
  "template:read": {
    command: "template:read",
    category: "templates",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Read template file contents",
  },
  "template:insert": {
    command: "template:insert",
    category: "templates",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Insert template into note",
  },

  // Word Count & Stats
  wordcount: {
    command: "wordcount",
    category: "notes",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Calculate word count and reading stats",
  },

  // Random Note
  random: {
    command: "random",
    category: "notes",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Open random note in UI",
  },
  "random:read": {
    command: "random:read",
    category: "notes",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Read random note content",
  },

  // Unique Notes
  unique: {
    command: "unique",
    category: "notes",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Create unique timestamped note",
  },

  // Desktop Open
  open: {
    command: "open",
    category: "desktop",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: true,
    dangerous: false,
    description: "Open note in Obsidian desktop app",
  },

  // Plugins & Snippets
  plugins: {
    command: "plugins",
    category: "plugins",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List installed community and core plugins",
  },
  plugin: {
    command: "plugin",
    category: "plugins",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Get plugin information",
  },
  "plugin:enable": {
    command: "plugin:enable",
    category: "plugins",
    readOnly: false,
    requiredScope: Scope.VAULT_ADMIN,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Enable a community plugin",
  },
  "plugin:disable": {
    command: "plugin:disable",
    category: "plugins",
    readOnly: false,
    requiredScope: Scope.VAULT_ADMIN,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Disable a community plugin",
  },
  "plugin:reload": {
    command: "plugin:reload",
    category: "plugins",
    readOnly: false,
    requiredScope: Scope.VAULT_DEVELOPER,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Reload plugin during development",
  },
  snippets: {
    command: "snippets",
    category: "snippets",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List CSS snippets",
  },
  "snippet:enable": {
    command: "snippet:enable",
    category: "snippets",
    readOnly: false,
    requiredScope: Scope.VAULT_ADMIN,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Enable a CSS snippet",
  },
  "snippet:disable": {
    command: "snippet:disable",
    category: "snippets",
    readOnly: false,
    requiredScope: Scope.VAULT_ADMIN,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Disable a CSS snippet",
  },

  // Commands
  commands: {
    command: "commands",
    category: "commands",
    readOnly: true,
    requiredScope: Scope.VAULT_READ,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "List command palette command IDs",
  },
  command: {
    command: "command",
    category: "commands",
    readOnly: false,
    requiredScope: Scope.VAULT_WRITE,
    supportsVault: true,
    supportsPath: false,
    dangerous: false,
    description: "Execute Obsidian command by ID",
  },
};

export const ALLOWED_CLI_COMMANDS = new Set(Object.keys(OBSIDIAN_CLI_COMMAND_REGISTRY));

export function isCliCommandAllowed(command: string): boolean {
  return ALLOWED_CLI_COMMANDS.has(command);
}

export function getCliCommandMetadata(command: string): CliCommandMetadata | undefined {
  return OBSIDIAN_CLI_COMMAND_REGISTRY[command];
}

export function getAllowedCliCommandsList(): string[] {
  return Array.from(ALLOWED_CLI_COMMANDS);
}
