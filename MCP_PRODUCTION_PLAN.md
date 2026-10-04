# Obsidian Remote MCP Server — Production Architecture & Implementation Plan

A secure, typed, remote Model Context Protocol (MCP) service connecting AI agents (ChatGPT, Claude, Codex, Cursor, Hermes Agent) to an Obsidian knowledge system hosted on a VPS.

---

## 1. Executive Summary & Core Principle

This architecture establishes a strict separation between **behavioral knowledge** and **executable capability**:

```
                              AI CLIENTS
               (ChatGPT, Claude, Codex, Cursor, Hermes)
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
         BEHAVIORAL LAYER                  CAPABILITY LAYER
   Repository: obsidian-skill        Repository: obsidian-mcp
   (Instructions, Skills, Plugins)   (Standalone Remote Service)
                 │                                 │
          Guides reasoning                  Enforces typed execution
                 │                                 │
                 └────────────────┬────────────────┘
                                  ▼
                         OBSIDIAN VPS ENGINE
                      (Desktop CLI / IPC + Xvfb)
                                  │
                                  ▼
                           OBSIDIAN VAULT
```

- **`obsidian-skill`**: Houses instructions, guidelines, and prompt schemas describing *how* an agent reasons about and organizes notes.
- **`obsidian-mcp`**: Standalone production service exposing *what* capabilities the agent is permitted to invoke over the Model Context Protocol.
- **Service Layer**: Handles validation, authorization, rate limits, path isolation, and concurrency.
- **Adapter Layer**: Communicates with the local Obsidian desktop CLI via IPC over an Xvfb virtual frame buffer.
- **Vault**: The single source of truth on disk.

---

## 2. Target System Architecture

```
                    Internet (Remote AI Clients)
                    [ChatGPT / Claude / Hermes]
                                │
                                │ HTTPS / MCP (Streamable HTTP)
                                ▼
               ┌─────────────────────────────────┐
               │    Reverse Proxy / TLS (HTTPS)  │
               │         Caddy / Nginx           │
               │      https://mcp.domain.com     │
               └────────────────┬────────────────┘
                                │ HTTP (127.0.0.1:3000)
                                ▼
               ┌─────────────────────────────────┐
               │       Obsidian MCP Server       │
               │                                 │
               │  • Bearer Token Authentication  │
               │  • Scoped Permission Matrix     │
               │  • Path Traversal Guard         │
               │  • Rate Limiting & Audit Log    │
               │  • Zod Input/Output Validation  │
               └────────────────┬────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
     Typed Tools            Resources              Prompts
     (25 Semantic)       (URI Context)         (Guided Workflows)
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                ▼
                       Service Layer
                    (Concurrency & Rules)
                                │
                                ▼
                      Obsidian CLI Adapter
                                │
                                ▼
                       Obsidian Desktop
                     (Headless via Xvfb)
                                │
                                ▼
                      Hostinger VPS Vault
                       (/srv/obsidian/vault)
```

---

## 3. Formal MCP v1 Capability Contract

To prevent arbitrary execution and maintain reliability, v1 exposes **25 strongly-typed semantic tools** with Zod validation.

### 3.1 Vault Domain Tools
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_get_vault` | `vault:read` | Returns vault metadata and connectivity status | `{}` | `{ name: string, status: string, totalFiles: number }` |
| `obsidian_list_files` | `vault:read` | Lists files and folders under a vault-relative path | `{ folder?: string, recursive?: boolean }` | `{ files: Array<{ path: string, type: "file" \| "folder" }> }` |
| `obsidian_get_file_info` | `vault:read` | Retrieves file statistics and metadata | `{ path: string }` | `{ path: string, size: number, mtime: string, isFolder: boolean }` |

### 3.2 Notes Domain Tools
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_read_note` | `vault:read` | Reads content of a specific note | `{ path: string }` | `{ path: string, content: string, frontmatter: Record<string, any> }` |
| `obsidian_create_note` | `vault:write` | Creates a new note (fails if exists unless overwrite specified) | `{ path: string, content?: string, template?: string, overwrite?: boolean }` | `{ path: string, created: boolean }` |
| `obsidian_append_note` | `vault:write` | Appends text content to an existing note | `{ path: string, content: string, ensureNewline?: boolean }` | `{ path: string, appended: boolean }` |
| `obsidian_prepend_note` | `vault:write` | Prepends text content below frontmatter | `{ path: string, content: string }` | `{ path: string, prepended: boolean }` |
| `obsidian_update_note` | `vault:write` | Updates note content with optimistic concurrency control | `{ path: string, content: string, expectedRevision?: string }` | `{ path: string, updated: boolean, newRevision: string }` |
| `obsidian_move_note` | `vault:delete` | Moves or renames a note across directories | `{ sourcePath: string, targetPath: string }` | `{ sourcePath: string, targetPath: string, moved: boolean }` |
| `obsidian_delete_note` | `vault:delete` | Permanently deletes or trashes a note | `{ path: string, permanent?: boolean }` | `{ path: string, deleted: boolean }` |

### 3.3 Search Domain Tools
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_search` | `vault:read` | Full-text structured search returning matches and line numbers | `{ query: string, limit?: number }` | `{ matches: Array<{ path: string, lines: Array<number> }> }` |
| `obsidian_search_context` | `vault:read` | Search returning surrounding contextual lines | `{ query: string, contextLines?: number, limit?: number }` | `{ matches: Array<{ path: string, snippet: string }> }` |

### 3.4 Daily Notes Domain Tools
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_read_daily_note` | `vault:read` | Reads the daily note for today or a specific date | `{ date?: string }` | `{ path: string, content: string, date: string }` |
| `obsidian_append_daily_note` | `vault:write` | Appends a structured item or task to the daily note | `{ content: string, date?: string }` | `{ path: string, appended: boolean }` |
| `obsidian_prepend_daily_note` | `vault:write` | Prepends content to the daily note | `{ content: string, date?: string }` | `{ path: string, prepended: boolean }` |

### 3.5 Metadata & Properties Tools
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_get_properties` | `vault:read` | Reads all frontmatter properties of a note | `{ path: string }` | `{ path: string, properties: Record<string, any> }` |
| `obsidian_get_property` | `vault:read` | Reads a specific frontmatter property | `{ path: string, name: string }` | `{ path: string, name: string, value: any }` |
| `obsidian_set_property` | `vault:write` | Sets or updates a frontmatter property | `{ path: string, name: string, value: any }` | `{ path: string, name: string, updated: boolean }` |
| `obsidian_remove_property` | `vault:write` | Removes a frontmatter property | `{ path: string, name: string }` | `{ path: string, name: string, removed: boolean }` |

### 3.6 Tasks & Checklists Tools
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_list_tasks` | `vault:read` | Lists tasks across vault or note (always uses `all` scope) | `{ path?: string, status?: "todo" \| "done" \| "all" }` | `{ tasks: Array<{ path: string, line: number, text: string, status: string }> }` |
| `obsidian_toggle_task` | `vault:write` | Toggles the completion state of a specific task line | `{ path: string, line: number }` | `{ path: string, line: number, toggled: boolean }` |

### 3.7 Knowledge Graph & Links Tools
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_get_backlinks` | `vault:read` | Lists all incoming links referencing a target note | `{ path: string }` | `{ path: string, backlinks: Array<string> }` |
| `obsidian_get_links` | `vault:read` | Lists all outgoing links contained within a note | `{ path: string }` | `{ path: string, links: Array<string> }` |
| `obsidian_get_orphans` | `vault:read` | Discovers orphaned notes with no links | `{}` | `{ orphans: Array<string> }` |
| `obsidian_get_unresolved_links`| `vault:read` | Lists broken internal wikilinks across the vault | `{}` | `{ unresolved: Array<{ target: string, referencedIn: string }> }` |
| `obsidian_get_deadends` | `vault:read` | Lists notes with incoming links but zero outgoing links | `{}` | `{ deadends: Array<string> }` |

### 3.8 Tags & Bases Tools
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_get_tags` | `vault:read` | Returns tag counts (enforces `tags all counts` scope) | `{}` | `{ tags: Record<string, number> }` |
| `obsidian_get_tag_notes` | `vault:read` | Retrieves all notes tagged with a specific tag | `{ tag: string }` | `{ tag: string, notes: Array<string> }` |
| `obsidian_list_bases` | `vault:read` | Lists all `.base` files in the vault | `{}` | `{ bases: Array<string> }` |
| `obsidian_query_base` | `vault:read` | Queries a specific `.base` schema | `{ path: string, view?: string }` | `{ data: Array<Record<string, any>> }` |

### 3.9 Restricted Escape Hatch
| Tool Name | Scope | Description | Inputs | Output |
| :--- | :--- | :--- | :--- | :--- |
| `obsidian_cli` | `vault:developer` | Controlled execution of allowlisted CLI subcommands | `{ command: string, args: Record<string, string> }` | `{ stdout: string, exitCode: number }` |

---

## 4. MCP Resources Specification

Resources provide direct URI-based context retrieval without active tool invocation:

| Resource URI | MIME Type | Description |
| :--- | :--- | :--- |
| `obsidian://vault` | `application/json` | Vault status, file counts, and configuration summary |
| `obsidian://daily/today` | `text/markdown` | Direct content of today's daily note |
| `obsidian://note/{path}` | `text/markdown` | Direct content of any vault note |
| `obsidian://folder/{path}` | `application/json` | File listing of a specific vault folder |
| `obsidian://tags` | `application/json` | Complete tag inventory and occurrences |
| `obsidian://tasks` | `application/json` | Vault-wide pending task inventory |
| `obsidian://base/{path}` | `application/json` | Direct schema and view definitions of a `.base` file |

---

## 5. MCP Prompts Specification

Prompt templates standardize conversational workflows for remote clients:

1. `daily-work-report`: Synthesizes today's daily note, closed tasks, and changed files into a structured daily summary.
2. `knowledge-capture`: Extracts reusable principles, decisions, and patterns from meeting or daily notes into permanent knowledge notes.
3. `weekly-review`: Aggregates the last 7 daily notes and project notes into an executive progress review.
4. `project-review`: Evaluates project files, open milestones, and linked tasks.
5. `vault-health-check`: Scans for broken links (`unresolved`), orphan notes, and missing frontmatter tags.

---

## 6. Standardized Error Handling Protocol

Every failure returns structured error payloads using stable machine-readable codes:

| Error Code | HTTP / RPC Status | Client Action |
| :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | Provide valid Bearer token credentials. |
| `FORBIDDEN` | 403 | Token lacks required scope (e.g. `vault:delete`). Do not retry with same token. |
| `PATH_INVALID` | 400 | Path attempted directory traversal or is outside vault. Correct path. |
| `NOT_FOUND` | 404 | File or resource does not exist in vault. |
| `CONFLICT` | 409 | Concurrent edit detected (revision mismatch). Re-read note before reapplying. |
| `OBSIDIAN_UNAVAILABLE` | 503 | Obsidian desktop or CLI IPC is offline. Back off and retry. |
| `VAULT_UNAVAILABLE` | 503 | Vault directory is unreadable or filesystem is unmounted. |
| `RATE_LIMITED` | 429 | Client exceeded rate quota. Honor `Retry-After` header. |
| `VALIDATION_ERROR` | 400 | Malformed parameters. Inspect schema error details. |
| `INTERNAL_ERROR` | 500 | Unexpected service failure. Reference `request_id` in logs. |

---

## 7. Security Architecture & Hard Guardrails

### 7.1 Path Isolation
- **Vault Root Barrier**: All paths are resolved relative to `OBSIDIAN_VAULT_PATH`.
- **Traversal Prevention**: Inputs containing `../`, `./`, or absolute paths (`/etc/`, `/home/`) are rejected immediately by the `PathGuard` middleware before reaching any service.
- **Symlink Policy**: Symlinks pointing outside the vault root are forbidden.

### 7.2 Authentication & Scopes
- **Transport Security**: HTTPS only. Plain HTTP is rejected.
- **Token Hashing**: Bearer tokens are stored and compared using SHA-256 hashes.
- **Scope Enforcement**:
  - `vault:read`: Safe queries, search, read operations.
  - `vault:write`: Additive note creation, appends, property updates.
  - `vault:delete`: Move, rename, trash, delete operations.
  - `vault:admin`: Sync recovery, vault maintenance.
  - `vault:developer`: Allowlisted CLI command execution (`obsidian_cli`).

### 7.3 Audit Logging & Privacy
- Every request records: `timestamp`, `request_id`, `client_id`, `tool`, `path`, `status`, `duration_ms`, `error_code`.
- **Privacy Rule**: Note bodies, sensitive personal data, and bearer tokens are never written to audit logs.

---

## 8. VPS Infrastructure & Deployment (Hostinger)

### 8.1 Runtime Stack
- **OS**: Ubuntu 24.04 LTS / Debian 12
- **Headless Display**: `Xvfb` daemon creating virtual display `DISPLAY=:5`
- **Obsidian**: Official `.deb` package running under a dedicated non-root service account (`obsidian`)
- **Node.js**: v20+ LTS
- **Reverse Proxy**: Caddy (automatic TLS) or Nginx with Let's Encrypt
- **Process Supervision**: `systemd` unit services with `PrivateTmp=false` and automatic restarts

### 8.2 Health & Readiness Endpoints
- `GET /health`: Verifies MCP process memory and uptime.
- `GET /ready`: Verifies Obsidian Desktop IPC reachability and vault disk accessibility.

---

## 9. Standalone Repository Structure (`obsidian-mcp`)

```
obsidian-mcp/
├── .github/
│   └── workflows/
│       ├── test.yml
│       └── build.yml
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── README.md
├── MCP_PRODUCTION_PLAN.md
├── src/
│   ├── index.ts                      # Entrypoint (CLI / stdio vs HTTP switch)
│   ├── server.ts                     # MCP Server factory and routing
│   ├── config/
│   │   ├── config.ts                 # Environment validation via Zod
│   │   └── scopes.ts                 # Scope definitions and permission maps
│   ├── transport/
│   │   ├── stdio.ts                  # Local stdio transport
│   │   └── http.ts                   # Remote Streamable HTTP (Express / Node HTTP)
│   ├── security/
│   │   ├── auth.ts                   # Bearer token verification & hash comparison
│   │   ├── path-guard.ts             # Path traversal prevention & normalization
│   │   ├── permissions.ts            # Tool scope checker
│   │   ├── rate-limit.ts             # In-memory / token-bucket rate limiter
│   │   └── audit.ts                  # Structured privacy-preserving audit logger
│   ├── schemas/
│   │   ├── common.ts                 # Shared Zod schemas (Path, Pagination, etc.)
│   │   ├── notes.ts                  # Note tool schemas
│   │   ├── search.ts                 # Search schemas
│   │   ├── daily.ts                  # Daily note schemas
│   │   ├── tasks.ts                  # Task schemas
│   │   ├── properties.ts             # Property schemas
│   │   └── errors.ts                 # Error response envelopes
│   ├── tools/
│   │   ├── index.ts                  # Tool registry
│   │   ├── vault.ts                  # Vault domain tools
│   │   ├── notes.ts                  # Note domain tools
│   │   ├── search.ts                 # Search domain tools
│   │   ├── daily.ts                  # Daily note tools
│   │   ├── tasks.ts                  # Task tools
│   │   ├── properties.ts             # Property tools
│   │   ├── links.ts                  # Links & graph tools
│   │   ├── bases.ts                  # Bases database tools
│   │   └── advanced.ts               # Guarded CLI escape hatch
│   ├── resources/
│   │   ├── index.ts                  # Resource registry
│   │   ├── vault.ts                  # Vault & status resources
│   │   └── notes.ts                  # Note & daily resources
│   ├── prompts/
│   │   ├── index.ts                  # Prompt registry
│   │   ├── daily-report.ts           # Daily work report prompt
│   │   ├── knowledge-capture.ts      # Knowledge capture prompt
│   │   └── weekly-review.ts          # Weekly review prompt
│   ├── services/
│   │   ├── note.service.ts           # Note file operations & conflict checks
│   │   ├── search.service.ts         # Search execution & formatting
│   │   ├── task.service.ts           # Task parsing & toggling
│   │   └── vault.service.ts          # Vault inspection & stats
│   └── adapters/
│       └── obsidian/
│           ├── cli.adapter.ts        # Direct execution of Obsidian CLI commands
│           └── ipc.client.ts         # Health checking & IPC detection
└── tests/
    ├── unit/
    │   ├── path-guard.test.ts
    │   ├── auth.test.ts
    │   └── schemas.test.ts
    ├── integration/
    │   ├── notes.test.ts
    │   └── search.test.ts
    ├── security/
    │   ├── traversal.test.ts
    │   └── permissions.test.ts
    └── protocol/
        ├── stdio.test.ts
        └── http.test.ts
```

---

## 10. Phased Implementation Roadmap & Milestone Tracker

Use this checklist to track progress from initiation to production deployment:

### Phase 0: Specification & Foundation
- [x] Initialize repository configuration (`package.json`, `tsconfig.json`, `.gitignore`, `README.md`)
- [x] Install core dependencies (`@modelcontextprotocol/sdk`, `zod`, `dotenv`)
- [x] Freeze MCP v1 Contract specification and Zod input/output schemas
- [x] Create mock test vault for automated integration tests

### Phase 1: Core Runtime & Local Transport
- [x] Implement `src/config/config.ts` with strict Zod environment variable parsing
- [x] Implement `src/adapters/obsidian/cli.adapter.ts` with execution timeouts and error detection
- [x] Implement `src/transport/stdio.ts` for local IDE execution
- [x] Build server bootstrap in `src/server.ts` and test stdio handshake with MCP Inspector

### Phase 2: Core Tools & Services
- [x] Implement `src/security/path-guard.ts` with automated path traversal test suite
- [x] Implement `Vault` domain tools (`get_vault`, `list_files`, `get_file_info`)
- [x] Implement `Notes` domain tools (`read_note`, `create_note`, `append_note`, `prepend_note`, `update_note`)
- [x] Implement `Daily` domain tools (`read_daily_note`, `append_daily_note`, `prepend_daily_note`)
- [x] Implement `Search` domain tools (`search`, `search_context`) with structured JSON output
- [x] Implement `Tasks` domain tools (`list_tasks`, `toggle_task`) with `tasks all` scope
- [x] Implement `Properties` domain tools (`get_properties`, `set_property`, `remove_property`)
- [x] Implement `Links & Graph` tools (`get_backlinks`, `get_links`, `get_orphans`, `get_unresolved_links`)
- [x] Implement `Bases` tools (`list_bases`, `query_base`)

### Phase 3: Security & Authorization Engine
- [x] Implement Bearer token verification with SHA-256 hash comparison
- [x] Implement permission scope checker (`vault:read`, `vault:write`, `vault:delete`, `vault:admin`, `vault:developer`)
- [x] Implement preflight confirmation logic for destructive tools (`delete_note`, `move_note`)
- [x] Implement in-memory token-bucket rate limiter
- [x] Implement structured privacy-safe audit logger (`src/security/audit.ts`)

### Phase 4: Remote Transport & Reverse Proxy
- [x] Implement Streamable HTTP transport (`src/transport/http.ts`) supporting SSE and JSON-RPC
- [x] Implement operational health endpoints (`GET /health` and `GET /ready`)
- [x] Create Caddy reverse proxy configuration with automated TLS
- [x] Create Nginx reverse proxy configuration alternative
- [x] Create `systemd` unit files for Obsidian Desktop (`Xvfb`) and MCP Server

### Phase 5: Resources & Prompt Workflows
- [x] Implement MCP Resources (`obsidian://vault`, `obsidian://daily/today`, `obsidian://tasks`, `obsidian://tags`)
- [x] Implement `daily-work-report` prompt
- [x] Implement `knowledge-capture` prompt
- [x] Implement `weekly-review` prompt
- [x] Implement `vault-health-check` prompt

### Phase 6: Production Hardening & Testing
- [x] Execute security test suite (path traversal, symlink escapes, unauthorized scope attempts)
- [x] Execute concurrency test suite (simultaneous appends and conflict detection)
- [ ] Validate end-to-end connectivity from remote ChatGPT, Claude Desktop, and Hermes Agent on live VPS
- [ ] Validate automated backup runbook for the VPS vault

---

## 11. Strict Non-Goals (What Not to Build in v1)

To ensure stability, security, and timely delivery, the following are explicitly out of scope for v1:
- ❌ **No arbitrary shell execution**: Commands outside the allowlisted Obsidian CLI are strictly forbidden.
- ❌ **No LLM reasoning inside the server**: The server is a deterministic capability provider; reasoning remains in the remote client (ChatGPT/Claude).
- ❌ **No vector databases or embeddings**: Retrieval relies on native full-text search, tags, properties, and links.
- ❌ **No multi-tenant billing or complex OAuth**: Single-user bearer tokens with scoped permissions are used for the VPS.
- ❌ **No Kubernetes deployment**: Simple, reliable `systemd` / Docker Compose supervision on the VPS.
