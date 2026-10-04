import { z } from "zod";

export const VaultRelativePathSchema = z
  .string()
  .min(1, "Path cannot be empty")
  .refine((val) => !val.includes("\0"), "Null bytes are not allowed")
  .refine((val) => !val.startsWith("../") && !val.includes("/../"), "Path traversal is forbidden");

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
