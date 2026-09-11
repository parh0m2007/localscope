import { z } from "zod";

export const ResponseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

export const IndexToolSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(4096)
      .default(".")
      .describe("Repository path to index (absolute, or relative to the directory the server was started in)"),
    max_files: z
      .number()
      .int()
      .min(1)
      .max(200_000)
      .default(50_000)
      .describe("Safety cap on number of files to index"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const SearchToolSchema = z
  .object({
    query: z
      .string()
      .min(2, "Query must be at least 2 characters")
      .max(500, "Query must not exceed 500 characters")
      .describe("Natural-language query, symbol name, or code fragment to find"),
    path: z
      .string()
      .min(1)
      .max(4096)
      .default(".")
      .describe("Repository path (must match a previously indexed root)"),
    limit: z.number().int().min(1).max(100).default(20)
      .describe("Maximum results to return"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const ImpactToolSchema = z
  .object({
    target: z
      .string()
      .min(1)
      .max(1024)
      .describe("File path (e.g. 'src/utils/parse.ts') OR symbol name (e.g. 'parseConfig', 'UserService')"),
    path: z
      .string()
      .min(1)
      .max(4096)
      .default(".")
      .describe("Repository path (must match a previously indexed root)"),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("How deep to walk the reverse dependency graph"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const StatusToolSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(4096)
      .default(".")
      .describe("Repository path to check"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const ReferencesToolSchema = z
  .object({
    symbol: z
      .string()
      .min(2, "Symbol name must be at least 2 characters")
      .max(256)
      .describe("Symbol name to find call sites and reads for (e.g. 'parseConfig')"),
    path: z
      .string()
      .min(1)
      .max(4096)
      .default(".")
      .describe("Repository path (must match a previously indexed root)"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const DefinitionToolSchema = z
  .object({
    symbol: z
      .string()
      .min(2, "Symbol name must be at least 2 characters")
      .max(256)
      .describe("Symbol name to locate the definition of (e.g. 'parseConfig')"),
    path: z
      .string()
      .min(1)
      .max(4096)
      .default(".")
      .describe("Repository path (must match a previously indexed root)"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export type IndexToolInput = z.infer<typeof IndexToolSchema>;
export type SearchToolInput = z.infer<typeof SearchToolSchema>;
export type ImpactToolInput = z.infer<typeof ImpactToolSchema>;
export type StatusToolInput = z.infer<typeof StatusToolSchema>;
export type ReferencesToolInput = z.infer<typeof ReferencesToolSchema>;
export type DefinitionToolInput = z.infer<typeof DefinitionToolSchema>;
