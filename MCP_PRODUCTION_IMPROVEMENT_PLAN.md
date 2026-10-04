# Obsidian MCP Server — Production Engineering & Feature Enhancement Plan

## Executive Summary

Based on an exhaustive analysis of the competitive Obsidian MCP ecosystem (including `StevenStavrakis/obsidian-mcp`, `cyanheads/obsidian-mcp-server`, `oomkapwn/enquire-mcp`, `bitbonsai/mcpvault`, and `@smammadov/obsidian-mcp`), this plan defines the architectural roadmap to elevate `obsidian-mcp` into an enterprise-grade AI knowledge interface.

Rather than inflating the server with tool bloat (avoiding 40+ redundant tools or heavy GPU vector dependencies), our roadmap focuses strictly on two high-value pillars:
1. **Transactional Vault Correctness**: Atomic mutations, backlink-safe renames, surgical section patching, and recovery journaling.
2. **Context & Retrieval Intelligence**: In-memory BM25 scoring, graph shortest-path navigation, comment stripping, and evidence-cited context packs.

---

## What We Deliberately Exclude (Avoiding Operational Burden)

To keep the service lightweight, maintainable, and fast, the following features are intentionally out of scope:
- **No Heavy Vector Databases / GPU Embeddings**: No ChromaDB, Pinecone, or PyTorch dependencies. In-memory BM25 and structured graph traversal deliver microsecond latency with zero API costs or external database daemons.
- **No Plugin-Specific UI Formats**: No complex state engines for Excalidraw drawing coordinates or Kanban board drag-states. Markdown text, frontmatter properties, and native `.base` tables remain the single source of truth.
- **No Hard Dependency on Obsidian Desktop**: The server operates directly on the vault filesystem, using the Obsidian desktop CLI as an optional accelerator rather than a fragile single point of failure.
- **No Tool Explosion**: Maintain a consolidated, semantic tool surface (25–28 tools max) instead of fragmenting into dozens of micro-tools.

---

## Target Architecture

```
                               AI CLIENT
                 (Claude / Cursor / ChatGPT / Hermes)
                                  │
                                  │ MCP Protocol (Streamable HTTP / SSE / stdio)
                                  ▼
                     ┌─────────────────────────┐
                     │       MCP Gateway       │
                     │  • Bearer Token (SHA256)│
                     │  • Scoped RBAC Matrix   │
                     │  • Sliding Rate Limiter │
                     │  • Audit Logging (JSON) │
                     └────────────┬────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
┌──────────────────┐                            ┌─────────────────────┐
│  Semantic Tools  │                            │   Context Engine    │
│  • Notes & Daily │                            │  • BM25 Lexical FTS │
│  • Surgical Patch│                            │  • Graph Traversal  │
│  • Tasks & Props │                            │  • Evidence Spans   │
│  • Safe Rename   │                            │  • Deep Link URIs   │
└────────┬─────────┘                            └──────────┬──────────┘
         │                                                 │
         └────────────────────────┬────────────────────────┘
                                  ▼
                     ┌─────────────────────────┐
                     │   Transaction Manager   │
                     │  • Atomic File Swaps    │
                     │  • Backlink Rewriter    │
                     │  • Rollback Journal     │
                     │  • PathGuard Sandbox    │
                     └────────────┬────────────┘
                                  ▼
                     ┌─────────────────────────┐
                     │   Local Vault on Disk   │
                     │  (/srv/obsidian/vault)  │
                     └─────────────────────────┘
```

---

## Phased Implementation Roadmap

### Phase 1: Vault Transaction Safety & Mutation Correctness (Immediate Focus)
**Objective**: Guarantee that vault edits never corrupt notes or leave broken links upon failure.

1. **Atomic File Operations**:
   - Implement `AtomicFs`: Write content to `.tmp-[uuid]` and execute atomic replacement via `fs.renameSync`.
   - Prevent partial writes if an unexpected process interruption occurs.
2. **Backlink-Aware Note Move & Rename**:
   - When `obsidian_move_note` executes, scan all incoming backlinks.
   - Transactionally rewrite unambiguous `[[Old Note]]` wikilinks, embeds (`![[Old Note]]`), and markdown links to `[[New Note]]`.
   - If any backlink file update fails, roll back all modified files from the transaction journal.
3. **Surgical Note Patching (`obsidian_patch_note`)**:
   - Allow targeted insertion, replacement, or append under a specific heading (e.g. `## Action Items`) or block ID (`^summary`) without rewriting the entire 5,000-word file.
4. **PathGuard Extended Directory Isolation**:
   - Hardblock access to internal reserved directories: `.obsidian`, `.obsidian-mcp`, `.git`, `.trash`.
   - Reject Windows UNC paths, alternate data streams, and parent path escape sequences.
5. **Standard ETag / If-Match Aliases**:
   - Accept `etag` / `ifMatch` as direct equivalents to `revision` / `expectedRevision` for HTTP/REST standards compliance.
6. **Safe Trash Journaling**:
   - On note deletion, move files into `.obsidian-mcp/trash/<timestamp>_<filename>` with recovery metadata instead of unrecoverable deletion.

---

### Phase 2: Retrieval Intelligence & Context Optimization
**Objective**: Deliver precise, evidence-cited answers to AI agents while minimizing context window consumption.

1. **In-Memory BM25 Relevance Search**:
   - Implement BM25 scoring over note titles, headings, frontmatter, and body text.
   - Return matches sorted by BM25 relevance score rather than naive string appearance.
2. **Obsidian Deep Linking (`obsidian://open`)**:
   - Include direct desktop URI links (`obsidian://open?vault=<vault>&file=<encoded-path>`) in all tool outputs, allowing users to jump directly to notes with a single click.
3. **Comment Stripping (`%% ... %%`)**:
   - Add an optional `stripComments: boolean` parameter to `obsidian_read_note` and `obsidian_get_note_context` to remove private comments, reducing token usage.
4. **Graph Analytical Navigation**:
   - Add `obsidian_graph_path`: Calculate the shortest wikilink traversal path connecting two notes using Breadth-First Search (BFS).
   - Add `obsidian_graph_neighbors`: Retrieve 1st and 2nd degree connected notes around a topic.
5. **Compact Output Mode**:
   - Add `compact: boolean` option to search and list tools to return minimal token payloads when invoked by autonomous agents.

---

### Phase 3: The Unified Context & Evidence Engine (`obsidian_query`)
**Objective**: Provide a single comprehensive knowledge retrieval tool that replaces multiple round-trip calls.

1. **Unified Query Workflow**:
   - Tool: `obsidian_query(query: string, options?: { maxResults?: number; includeGraph?: boolean })`
   - Flow:
     1. BM25 search across vault notes.
     2. Graph expansion to find closely related notes.
     3. Extraction of relevant evidence spans (specific line numbers and paragraph text).
     4. Formatting into a concise "Context Pack" containing cited sources and confidence scores.

---

### Phase 4: Developer Ergonomics & NPM Distribution
**Objective**: Ensure frictionless setup, diagnostics, and global package availability.

1. **CLI Diagnostics (`doctor` command)**:
   - Command: `npx @dharmikbhesaniya/obsidian-mcp doctor`
   - Validates Node.js version, vault path accessibility, write permissions, and port availability.
2. **Scoped Package Publishing**:
   - Update `package.json` name to `@dharmikbhesaniya/obsidian-mcp`.
   - Publish to NPM registry with public access.

---

## Prioritized Implementation Schedule

| Milestone | Key Deliverables | Estimated Impact |
| :--- | :--- | :--- |
| **P1.1: Surgical Patching** | `obsidian_patch_note` (heading & block targeting) | Eliminates full-file overwrites |
| **P1.2: Atomic Writes & ETag** | `AtomicFs`, `etag` / `ifMatch` support, `.obsidian-mcp/trash` | Guarantees zero corrupted notes |
| **P1.3: Backlink-Safe Move** | Automated inbound link rewriting on file move | Prevents broken vault links |
| **P2.1: BM25 Search & Deep Links** | BM25 ranker + `obsidian://open` desktop links | 10x better search relevance & UX |
| **P2.2: Graph Shortest Path** | BFS shortest path traversal between notes | Direct knowledge navigation |
| **P3.0: Unified Context Pack** | `obsidian_query` with cited line evidence | Next-generation agent context |
