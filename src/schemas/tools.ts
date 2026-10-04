import { z } from "zod";
import { VaultRelativePathSchema } from "./common.js";

// Vault schemas
export const GetVaultSchema = z.object({});
export const ListFilesSchema = z.object({
  folder: VaultRelativePathSchema.optional(),
  recursive: z.boolean().default(false),
});
export const GetFileInfoSchema = z.object({
  path: VaultRelativePathSchema,
});

// Note schemas
export const ReadNoteSchema = z.object({
  path: VaultRelativePathSchema,
});
export const CreateNoteSchema = z.object({
  path: VaultRelativePathSchema,
  content: z.string().default(""),
  template: z.string().optional(),
  overwrite: z.boolean().default(false),
});
export const AppendNoteSchema = z.object({
  path: VaultRelativePathSchema,
  content: z.string().min(1, "Content cannot be empty"),
  ensureNewline: z.boolean().default(true),
  expectedRevision: z.string().optional(),
});
export const PrependNoteSchema = z.object({
  path: VaultRelativePathSchema,
  content: z.string().min(1, "Content cannot be empty"),
  expectedRevision: z.string().optional(),
});
export const UpdateNoteSchema = z.object({
  path: VaultRelativePathSchema,
  content: z.string(),
  expectedRevision: z.string().optional(),
});
export const MoveNoteSchema = z.object({
  sourcePath: VaultRelativePathSchema,
  targetPath: VaultRelativePathSchema,
});
export const DeleteNoteSchema = z.object({
  path: VaultRelativePathSchema,
  permanent: z.boolean().default(false),
  expectedRevision: z.string().optional(),
});

// Search schemas
export const SearchSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  limit: z.number().int().min(1).max(200).default(50),
});
export const SearchContextSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  contextLines: z.number().int().min(1).max(10).default(2),
  limit: z.number().int().min(1).max(100).default(30),
});

// Daily note schemas
export const ReadDailyNoteSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
});
export const AppendDailyNoteSchema = z.object({
  content: z.string().min(1, "Content cannot be empty"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
});
export const PrependDailyNoteSchema = z.object({
  content: z.string().min(1, "Content cannot be empty"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
});

// Properties schemas
export const GetPropertiesSchema = z.object({
  path: VaultRelativePathSchema,
});
export const GetPropertySchema = z.object({
  path: VaultRelativePathSchema,
  name: z.string().min(1),
});
export const SetPropertySchema = z.object({
  path: VaultRelativePathSchema,
  name: z.string().min(1),
  value: z.any(),
  expectedRevision: z.string().optional(),
});
export const RemovePropertySchema = z.object({
  path: VaultRelativePathSchema,
  name: z.string().min(1),
  expectedRevision: z.string().optional(),
});

// Tasks schemas
export const ListTasksSchema = z.object({
  path: VaultRelativePathSchema.optional(),
  status: z.enum(["todo", "done", "all"]).default("all"),
});
export const ToggleTaskSchema = z.object({
  path: VaultRelativePathSchema,
  line: z.number().int().min(1),
});

// Links schemas
export const GetBacklinksSchema = z.object({
  path: VaultRelativePathSchema,
});
export const GetLinksSchema = z.object({
  path: VaultRelativePathSchema,
});
export const GetOrphansSchema = z.object({});
export const GetUnresolvedLinksSchema = z.object({});
export const GetDeadendsSchema = z.object({});

// Tags schemas
export const GetTagsSchema = z.object({});
export const GetTagNotesSchema = z.object({
  tag: z.string().min(1),
});

// Bases schemas
export const ListBasesSchema = z.object({});
export const QueryBaseSchema = z.object({
  path: VaultRelativePathSchema,
  view: z.string().optional(),
});

// Context & Discovery schemas
export const GetNoteContextSchema = z.object({
  path: VaultRelativePathSchema,
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
});
export const RecentChangesSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  folder: VaultRelativePathSchema.optional(),
  sinceDays: z.number().int().min(1).max(365).optional(),
});

// Advanced CLI escape hatch
export const ObsidianCliSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.string()).default({}),
});
