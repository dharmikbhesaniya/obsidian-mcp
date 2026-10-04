import { describe, it, expect } from "vitest";
import { BM25Engine, DocumentItem } from "../../src/search/bm25.js";

describe("BM25Engine", () => {
  const docs: DocumentItem[] = [
    {
      id: "architecture/redis-cache.md",
      title: "redis-cache",
      content: "This document describes the distributed caching layer built using Redis clustering and cache invalidation policies.",
    },
    {
      id: "architecture/postgres-db.md",
      title: "postgres-db",
      content: "Relational storage strategy using PostgreSQL for transactional data persistence and replication.",
    },
    {
      id: "notes/redis-debugging.md",
      title: "redis-debugging",
      content: "Quick checklist for troubleshooting memory pressure and latency spikes in Redis instances.",
    },
    {
      id: "notes/general-tips.md",
      title: "general-tips",
      content: "General development environment tips, shell shortcuts, and workstation setup.",
    },
  ];

  it("should rank documents containing query terms at the top", () => {
    const engine = new BM25Engine(docs);
    const results = engine.search("Redis clustering");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("architecture/redis-cache.md");
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].lines.length).toBeGreaterThan(0);
  });

  it("should prioritize title matches with higher relevance score", () => {
    const engine = new BM25Engine(docs);
    const results = engine.search("postgres");

    expect(results.length).toBe(1);
    expect(results[0].path).toBe("architecture/postgres-db.md");
  });

  it("should return empty array for non-matching queries or whitespace", () => {
    const engine = new BM25Engine(docs);
    expect(engine.search("kubernetes kubeflow")).toHaveLength(0);
    expect(engine.search("   ")).toHaveLength(0);
  });

  it("should respect limit argument", () => {
    const engine = new BM25Engine(docs);
    const results = engine.search("Redis", 1);
    expect(results).toHaveLength(1);
  });
});
