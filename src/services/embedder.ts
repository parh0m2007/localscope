import { DEFAULT_SEMANTIC_MODEL } from "../constants.js";
import type { EmbedderKind } from "../types.js";

export interface Embedder {
  readonly kind: EmbedderKind;
  readonly embed: (texts: readonly string[]) => Promise<readonly number[][]>;
  readonly query: (text: string) => Promise<readonly number[]>;
}

interface TransformersModule {
  pipeline: (
    task: string,
    model: string,
    options?: { quantized?: boolean; dtype?: string },
  ) => Promise<(text: string) => Promise<{ data: number[] }>>;
}

let cachedOnnx: Promise<Embedder | null> | null = null;

async function createOnnxEmbedder(
  modelId: string,
): Promise<Embedder | null> {
  try {
    const mod = (await import(
      "@huggingface/transformers"
    )) as unknown as TransformersModule;
    const extractor = await mod.pipeline("feature-extraction", modelId, {
      dtype: "q8",
    });

    const embedOne = async (text: string): Promise<number[]> => {
      const out = await extractor(text);
      return normalize(meanPool(out.data));
    };

    return {
      kind: { type: "onnx", model: modelId },
      embed: async (texts) => {
        if (texts.length === 0) return [];
        const results: number[][] = [];
        const batchSize = 16;
        for (let i = 0; i < texts.length; i += batchSize) {
          const batch = texts.slice(i, i + batchSize);
          const batchResults = await Promise.all(batch.map(embedOne));
          results.push(...batchResults);
        }
        return results;
      },
      query: (text) => embedOne(text),
    };
  } catch {
    return null;
  }
}

export function getOnnxEmbedder(
  modelId: string = DEFAULT_SEMANTIC_MODEL,
): Promise<Embedder | null> {
  if (!cachedOnnx) {
    cachedOnnx = createOnnxEmbedder(modelId).catch(() => null);
  }
  return cachedOnnx;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "if",
  "then",
  "else",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "is",
  "it",
  "as",
  "with",
  "this",
  "that",
  "be",
  "from",
  "are",
  "we",
  "you",
  "i",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

const LEXICAL_NOTE =
  "lexical TF scoring over identifier-split tokens (no model installed)";

export const lexicalEmbedder: Embedder = {
  kind: { type: "lexical", note: LEXICAL_NOTE },
  embed: async (texts) => texts.map(() => []),
  query: async () => [],
};

function meanPool(data: number[]): number[] {
  return data;
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_$-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface LexicalIndexEntry {
  readonly chunkId: string;
  readonly tf: ReadonlyMap<string, number>;
}

export function buildLexicalTf(
  chunkId: string,
  content: string,
  symbolName: string | null,
): LexicalIndexEntry {
  const tokens = [
    ...tokenize(content),
    ...(symbolName ? splitIdentifier(symbolName) : []),
  ];
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  const total = tokens.length || 1;
  for (const [k, v] of tf) {
    tf.set(k, v / total);
  }
  return { chunkId, tf };
}

export function lexicalScore(
  queryTokens: readonly string[],
  entry: LexicalIndexEntry,
): number {
  let score = 0;
  for (const token of queryTokens) {
    score += entry.tf.get(token) ?? 0;
  }
  const norm = Math.sqrt(queryTokens.length) || 1;
  return score / norm;
}
