import { z } from "zod";
import { VaultRelativePathSchema } from "./common.js";

export const VaultNameSchema = z
  .string()
  .optional()
  .describe("Vault name when multiple vaults are configured (e.g. 'work' or 'personal'). Defaults to the active default vault.");

// Vault schemas
export const ListVaultsSchema = z.object({});
export const GetVaultSchema = z.object({
  vault: VaultNameSchema,
});
export const ListFilesSchema = z.object({
  folder: VaultRelativePathSchema.optional(),
  recursive: z.boolean().default(false),
  vault: VaultNameSchema,
});
export const GetFileInfoSchema = z.object({
  path: VaultRelativePathSchema,
  vault: VaultNameSchema,
});

// Note schemas
export const ReadNoteSchema = z.object({
  path: VaultRelativePathSchema,
  stripComments: z.boolean().default(false).describe("If true, removes internal %% Obsidian comments %% before returning content"),
  vault: VaultNameSchema,
});
export const CreateNoteSchema = z.object({
  path: VaultRelativePathSchema,
  content: z.string().default(""),
  template: z.string().optional(),
  overwrite: z.boolean().default(false),
  expectedRevision: z.string().optional(),
  ifMatch: z.string().optional(),
  vault: VaultNameSchema,
});
export const AppendNoteSchema = z.object({
  path: VaultRelativePathSchema,
  content: z.string().min(1, "Content cannot be empty"),
  ensureNewline: z.boolean().default(true),
  expectedRevision: z.string().optional(),
  vault: VaultNameSchema,
});
export const PrependNoteSchema = z.object({
  path: VaultRelativePathSchema,
  content: z.string().min(1, "Content cannot be empty"),
  expectedRevision: z.string().optional(),
  vault: VaultNameSchema,
});
export const UpdateNoteSchema = z.object({
  path: VaultRelativePathSchema,
  content: z.string(),
  expectedRevision: z.string().optional(),
  ifMatch: z.string().optional(),
  vault: VaultNameSchema,
});
export const PatchNoteSchema = z.object({
  path: VaultRelativePathSchema,
  target: z.object({
    type: z.enum(["heading", "block"]).describe("Target type: 'heading' for markdown heading or 'block' for block ID"),
    value: z.string().min(1, "Target value cannot be empty").describe("Heading title or block identifier (e.g. 'Action Items' or '^summary')"),
  }),
  operation: z.enum(["replace", "append", "prepend"]).describe("Operation: replace target section/block, append after, or prepend before"),
  content: z.string().describe("Content to insert or replace with"),
  expectedRevision: z.string().optional(),
  ifMatch: z.string().optional(),
  vault: VaultNameSchema,
});
export const MoveNoteSchema = z.object({
  sourcePath: VaultRelativePathSchema,
  targetPath: VaultRelativePathSchema,
  expectedRevision: z.string().optional(),
  ifMatch: z.string().optional(),
  updateBacklinks: z.boolean().default(true).describe("Automatically rewrites inbound wikilinks across other notes to the new path"),
  vault: VaultNameSchema,
});
export const DeleteNoteSchema = z.object({
  path: VaultRelativePathSchema,
  permanent: z.boolean().default(false).describe("If false, moves to safe trash (.obsidian-mcp/trash). If true, permanently deletes."),
  expectedRevision: z.string().optional(),
  ifMatch: z.string().optional(),
  vault: VaultNameSchema,
});

// Search schemas
export const SearchSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  limit: z.number().int().min(1).max(200).default(50),
  vault: VaultNameSchema,
});
export const SearchContextSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  contextLines: z.number().int().min(1).max(10).default(2),
  limit: z.number().int().min(1).max(100).default(30),
  vault: VaultNameSchema,
});

// Daily note schemas
export const ReadDailyNoteSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  vault: VaultNameSchema,
});
export const AppendDailyNoteSchema = z.object({
  content: z.string().min(1, "Content cannot be empty"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  expectedRevision: z.string().optional(),
  vault: VaultNameSchema,
});
export const PrependDailyNoteSchema = z.object({
  content: z.string().min(1, "Content cannot be empty"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  expectedRevision: z.string().optional(),
  vault: VaultNameSchema,
});

// Properties schemas
export const GetPropertiesSchema = z.object({
  path: VaultRelativePathSchema,
  vault: VaultNameSchema,
});
export const GetPropertySchema = z.object({
  path: VaultRelativePathSchema,
  name: z.string().min(1),
  vault: VaultNameSchema,
});
export const SetPropertySchema = z.object({
  path: VaultRelativePathSchema,
  name: z.string().min(1),
  value: z.any(),
  expectedRevision: z.string().optional(),
  vault: VaultNameSchema,
});
export const RemovePropertySchema = z.object({
  path: VaultRelativePathSchema,
  name: z.string().min(1),
  expectedRevision: z.string().optional(),
  vault: VaultNameSchema,
});

// Tasks schemas
export const ListTasksSchema = z.object({
  path: VaultRelativePathSchema.optional(),
  status: z.enum(["todo", "done", "all"]).default("all"),
  vault: VaultNameSchema,
});
export const ToggleTaskSchema = z.object({
  path: VaultRelativePathSchema,
  line: z.number().int().min(1),
  expectedRevision: z.string().optional(),
  expectedText: z.string().optional(),
  vault: VaultNameSchema,
});

// Links schemas
export const GetBacklinksSchema = z.object({
  path: VaultRelativePathSchema,
  vault: VaultNameSchema,
});
export const GetLinksSchema = z.object({
  path: VaultRelativePathSchema,
  vault: VaultNameSchema,
});
export const GetLinkPathSchema = z.object({
  from: VaultRelativePathSchema.describe("Starting note relative path"),
  to: VaultRelativePathSchema.describe("Target destination note relative path"),
  maxDepth: z.number().int().min(1).max(10).default(6).describe("Maximum graph traversal search depth"),
  vault: VaultNameSchema,
});
export const GetOrphansSchema = z.object({
  vault: VaultNameSchema,
});
export const GetUnresolvedLinksSchema = z.object({
  vault: VaultNameSchema,
});
export const GetDeadendsSchema = z.object({
  vault: VaultNameSchema,
});

// Tags schemas
export const GetTagsSchema = z.object({
  vault: VaultNameSchema,
});
export const GetTagNotesSchema = z.object({
  tag: z.string().min(1),
  vault: VaultNameSchema,
});

// Bases schemas
export const ListBasesSchema = z.object({
  vault: VaultNameSchema,
});
export const QueryBaseSchema = z.object({
  path: VaultRelativePathSchema,
  view: z.string().optional(),
  vault: VaultNameSchema,
});

// Context & Discovery schemas
export const GetNoteContextSchema = z.object({
  path: VaultRelativePathSchema,
  stripComments: z.boolean().default(false).describe("If true, removes internal %% Obsidian comments %% from body content"),
  include: z
    .object({
      body: z.boolean().default(true),
      frontmatter: z.boolean().default(true),
      headings: z.boolean().default(true),
      backlinks: z.boolean().default(true),
      outgoingLinks: z.boolean().default(true),
      relatedNotes: z.boolean().default(true),
    })
    .default({}),
  maxRelatedNotes: z.number().int().min(0).max(50).default(10),
  vault: VaultNameSchema,
});
export const FindNotesSchema = z.object({
  query: z.string().optional(),
  tag: z.string().optional(),
  folder: VaultRelativePathSchema.optional(),
  property: z
    .object({
      name: z.string(),
      value: z.any().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).default(20),
  vault: VaultNameSchema,
});
export const RecentChangesSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  folder: VaultRelativePathSchema.optional(),
  sinceDays: z.number().int().min(1).max(365).optional(),
  vault: VaultNameSchema,
});

// Advanced CLI escape hatch
export const ObsidianCliSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.string()).default({}),
  vault: VaultNameSchema,
});
