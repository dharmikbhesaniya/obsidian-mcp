# Obsidian Remote MCP Server

[![Version](https://img.shields.io/badge/version-v1.0.0-blue.svg)](https://github.com/dharmikbhesaniya/obsidian-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Protocol](https://img.shields.io/badge/MCP-Model_Context_Protocol-blue.svg)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B_LTS-green.svg)](https://nodejs.org)
[![Companion Skills](https://img.shields.io/badge/Agent_Skills-Universal_Obsidian_Suite-green.svg)](https://github.com/dharmikbhesaniya/obsidian-skill)

Obsidian Remote MCP Server is an enterprise-grade capability runtime connecting AI assistants and agents (ChatGPT, Claude, Codex, Cursor, and Hermes Agent) to an [Obsidian](https://obsidian.md) vault. It provides strongly-typed semantic operations, timing-safe Bearer authentication, vault path isolation, dual-transport support (stdio and Streamable HTTP/SSE), and systemd supervision for production VPS hosting.

This server is accompanied by the official companion repository: [Universal Obsidian Suite (dharmikbhesaniya/obsidian-skill)](https://github.com/dharmikbhesaniya/obsidian-skill), which provides standardized Agent Skills, prompt rules, and pre-packaged IDE plugins for these tools.

---

## Table of Contents

- [System Architecture](#system-architecture)
- [Feature & Capability Summary](#feature--capability-summary)
- [Companion Agent Skills & Plugins Suite](#companion-agent-skills--plugins-suite)
- [Environment Variables & Configuration Reference](#environment-variables--configuration-reference)
  - [Environment Variables Overview](#environment-variables-overview)
  - [Architectural Importance of Variables](#architectural-importance-of-variables)
- [Local Development Setup](#local-development-setup)
  - [Prerequisites](#prerequisites)
  - [Installation & Build](#installation--build)
  - [Running with Claude Desktop (stdio)](#running-with-claude-desktop-stdio)
  - [Single Vault vs. Multi-Vault Configuration](#single-vault-vs-multi-vault-configuration)
  - [Running with Cursor IDE](#running-with-cursor-ide)
  - [Testing with MCP Inspector](#testing-with-mcp-inspector)
- [Production VPS Setup (Hostinger / Ubuntu / Debian)](#production-vps-setup-hostinger--ubuntu--debian)
  - [Step 1: Install Operating System Dependencies](#step-1-install-operating-system-dependencies)
  - [Step 2: Create Dedicated Service Account](#step-2-create-dedicated-service-account)
  - [Step 3: Install Obsidian Desktop and Enable CLI](#step-3-install-obsidian-desktop-and-enable-cli)
  - [Step 4: Configure Headless Display (Xvfb Service)](#step-4-configure-headless-display-xvfb-service)
  - [Step 5: Deploy the MCP Server](#step-5-deploy-the-mcp-server)
  - [Step 6: Configure Reverse Proxy with TLS (Caddy or Nginx)](#step-6-configure-reverse-proxy-with-tls-caddy-or-nginx)
  - [Step 7: Verify Health Endpoints](#step-7-verify-health-endpoints)
- [Connecting Remote Clients](#connecting-remote-clients)
  - [Connecting ChatGPT](#connecting-chatgpt)
  - [Connecting Remote Claude](#connecting-remote-claude)
  - [Connecting Hermes Agent (Nous Research)](#connecting-hermes-agent-nous-research)
- [Security Model & Path Isolation](#security-model--path-isolation)
- [Error Handling Protocol](#error-handling-protocol)
- [License](#license)

---

## System Architecture

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
               │  • Zod-validated tool inputs    │
               └────────────────┬────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
     Typed Tools            Resources              Prompts
    (51 Semantic)         (URI Context)         (Guided Workflows)
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

## Feature & Capability Summary

The server exposes 54 strongly-typed semantic tools (with advanced CLI escape hatch gated behind `ENABLE_ADVANCED_CLI=true`), 7 direct read resources, and 7 guided prompts:

### Tools (54 Semantic Capabilities)
- **Vault Domain (4 tools)**: `obsidian_list_vaults` (multi-vault inventory with deduplication), `obsidian_get_vault`, `obsidian_list_files` (recursive traversal & extension filtering), `obsidian_get_file_info`
- **Notes Domain (8 tools)**: `obsidian_read_note`, `obsidian_create_note`, `obsidian_append_note`, `obsidian_prepend_note`, `obsidian_update_note`, `obsidian_patch_note` (surgical search/replace/regex editing), `obsidian_move_note`, `obsidian_delete_note` (safe atomic trash by default)
- **Search Domain (2 tools)**: `obsidian_search`, `obsidian_search_context`
- **Context & Discovery Domain (3 tools)**: `obsidian_get_note_context` (selective include budget controls), `obsidian_find_notes`, `obsidian_recent_changes`
- **Daily Notes Domain (3 tools)**: `obsidian_read_daily_note`, `obsidian_append_daily_note`, `obsidian_prepend_daily_note`
- **Bookmarks Domain (2 tools)**: `obsidian_list_bookmarks`, `obsidian_create_bookmark`
- **Outline & Structure Domain (2 tools)**: `obsidian_get_outline`, `obsidian_outline` (hierarchical heading tree with line offsets)
- **Aliases Domain (2 tools)**: `obsidian_list_aliases`, `obsidian_get_aliases` (frontmatter alias resolution)
- **Templates Domain (2 tools)**: `obsidian_list_templates`, `obsidian_read_template` (variable resolution for `{{title}}`, `{{date}}`, `{{time}}`)
- **Metrics & Stats Domain (1 tool)**: `obsidian_word_count` (words, characters, sentences, paragraphs, reading time)
- **Random & Unique Notes (2 tools)**: `obsidian_random_note`, `obsidian_create_unique_note` (Zettelkasten style with entropy and guaranteed collision prevention)
- **Desktop Integration (2 tools)**: `obsidian_open_note`, `obsidian_open_in_app` (desktop app launch with accurate execution reporting and URI fallback)
- **Plugins & Customization (2 tools)**: `obsidian_list_plugins`, `obsidian_list_snippets`
- **Commands Domain (2 tools)**: `obsidian_list_commands`, `obsidian_execute_command`
- **Properties Domain (4 tools)**: `obsidian_get_properties`, `obsidian_get_property`, `obsidian_set_property`, `obsidian_remove_property`
- **Tasks Domain (2 tools)**: `obsidian_list_tasks`, `obsidian_toggle_task`
- **Knowledge Graph Domain (6 tools)**: `obsidian_get_backlinks`, `obsidian_get_links`, `obsidian_get_link_path`, `obsidian_get_orphans`, `obsidian_get_unresolved_links`, `obsidian_get_deadends`
- **Tags & Bases Domain (4 tools)**: `obsidian_get_tags`, `obsidian_get_tag_notes`, `obsidian_list_bases`, `obsidian_query_base`
- **Guarded Escape Hatch (1 tool)**: `obsidian_cli` *(strictly allowlisted through central command registry, disabled by default, gated by `ENABLE_ADVANCED_CLI=true` and `vault:developer` scope)*

### Resources (7 Direct Read Contexts)
- `obsidian://vault`: Vault statistics, file count, and connectivity state.
- `obsidian://daily/today`: Content of today's daily note.
- `obsidian://tasks`: Vault-wide pending task inventory.
- `obsidian://tags`: Inventory of all tags and occurrence frequencies.
- `obsidian://note/{path}`: Read-only access to a specific note.
- `obsidian://folder/{path}`: Directory listing for a vault folder.
- `obsidian://base/{path}`: Schema and view definitions of a `.base` file.

### Prompts (7 Standard Workflows)
- `daily-work-report`: Synthesizes today's daily note and tasks into an executive summary.
- `knowledge-capture`: Extracts reusable lessons and decisions from meeting/daily notes into permanent knowledge notes.
- `weekly-review`: Aggregates the last 7 daily notes and active project milestones.
- `monthly-review`: Conducts a broad retrospective across deliverables and patterns.
- `project-review`: Evaluates project status, open tasks, and incoming backlinks.
- `meeting-summary`: Extracts action items and decision records from raw meeting notes.
- `vault-health-check`: Scans for broken wikilinks and orphan notes.

---

## Companion Agent Skills & Plugins Suite

For complete instruction sets, prompts, and IDE rule definitions that empower AI coding agents to use these MCP tools autonomously, see the official companion repository:

👉 **[Universal Obsidian Suite (dharmikbhesaniya/obsidian-skill)](https://github.com/dharmikbhesaniya/obsidian-skill)**

### What the Companion Suite Provides
- **`obsidian-mcp` Skill**: Clear operational instructions, tool schemas, and best practices for AI agents executing these 54 semantic tools.
- **Claude Code & Antigravity Plugins**: Discoverable plugins (`.claude-plugin/`) and pre-configured `.mcp.json` definitions to register this MCP server automatically.
- **Cursor Rules & MDC**: Ready-to-copy `.cursorrules` and `.cursor/rules/obsidian.mdc` files.
- **OpenAI & ChatGPT Tools**: Pre-built JSON function definitions ([function_tools.json](https://github.com/dharmikbhesaniya/obsidian-skill/tree/main/integrations/openai)).
- **Complementary CLI & Markdown Skills**: Official Obsidian CLI commands, Obsidian Flavored Markdown (OFM), database Bases (`.base`), and JSON Canvas (`.canvas`) specifications.

---

## Environment Variables & Configuration Reference

The Obsidian MCP Server is configured entirely via environment variables (in your `.env` file or within your AI client's MCP configuration).

### Environment Variables Overview

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `OBSIDIAN_VAULT_PATH` | string | *None* | Absolute path to a single target vault (e.g. `/Users/name/Vault`). Required unless `OBSIDIAN_VAULTS` is provided. |
| `OBSIDIAN_VAULTS` | string / JSON | *None* | Multi-vault inventory. Accepts comma-separated `name=path,name2=path2` pairs or JSON string `{"v1":"/path1","v2":"/path2"}`. |
| `OBSIDIAN_DEFAULT_VAULT` | string | *First vault* | Name of the primary vault used when tool calls omit an explicit `vault` argument. |
| `OBSIDIAN_BIN_PATH` | string | `obsidian` | System path to the official Obsidian desktop binary (e.g. `/usr/bin/obsidian` or `/Applications/Obsidian.app/Contents/MacOS/Obsidian`). |
| `AUTH_ENABLED` | boolean | `false` | Enables cryptographic credential checks. Required (`true`) for production HTTP transport. |
| `AUTH_TOKEN` | string | *None* | Plain-text secret passkey. The server computes a SHA-256 hash internally for verification. |
| `BEARER_TOKEN_HASH` | string | *None* | Hexadecimal SHA-256 hash of your Bearer access token (for zero-trust setups where raw keys are never placed in configs). |
| `READ_ONLY` | boolean | `false` | Safety toggle. When `true`, restricts all connections strictly to `vault:read` scope, blocking file creation, editing, or deletion. |
| `SCOPES` | string | *All* | Comma-separated list of granted capabilities: `vault:read`, `vault:write`, `vault:delete`, `vault:admin`, `vault:developer`. |
| `MCP_TRANSPORT` | enum | `stdio` | Transport mechanism: `stdio` (local subprocess) or `http` (Streamable HTTP `/mcp` and SSE `/sse`). |
| `PORT` | number | `3000` | Network port when running over HTTP transport. |
| `HOST` | string | `127.0.0.1` | Network interface binding. Set to `127.0.0.1` behind reverse proxies (Caddy/Nginx). |
| `RATE_LIMIT_PER_MINUTE` | number | `120` | Maximum allowed tool invocations per minute per client session to prevent runaway AI loops. |
| `COMMAND_TIMEOUT_MS` | number | `15000` | Timeout threshold (in milliseconds) before CLI subsystem commands are aborted. |
| `MAX_SEARCH_RESULTS` | number | `50` | Maximum results returned by full-text and semantic search routines. |
| `ENABLE_DESTRUCTIVE_TOOLS` | boolean | `true` | Allows deletion tools. When enabled, `obsidian_delete_note` recycles files to `.trash` safely. |
| `ENABLE_ADVANCED_CLI` | boolean | `false` | Gated escape-hatch exposing raw `obsidian_cli` execution to clients with `vault:developer` scope. |
| `AUDIT_LOG_ENABLED` | boolean | `true` | Emits structured JSON audit records to standard error (`stderr`) for every tool invocation. |

---

### Architectural Importance of Variables

1. **Vault Sandboxing (`OBSIDIAN_VAULT_PATH` & `OBSIDIAN_VAULTS`)**  
   The server implements a strict path-containment engine (`PathGuard`). By defining vault boundaries, the server prevents path traversal (`../`), symlink escapes, and null-byte injection attacks. AI agents are contained entirely within authorized vault folders.
2. **Timing-Safe Credential Verification (`AUTH_ENABLED` & `AUTH_TOKEN` / `BEARER_TOKEN_HASH`)**  
   When exposed over HTTP or shared environments, authentication ensures only authorized callers interact with private notes. Token comparisons use `crypto.timingSafeEqual` over SHA-256 digests, eliminating side-channel timing analysis. In production HTTP mode, disabling auth triggers a startup safety violation.
3. **Immutable Guardrail (`READ_ONLY`)**  
   For read-only assistants, research agents, or untrusted models, setting `READ_ONLY=true` immediately strips write, delete, and execution scopes. Even if an AI attempts to call `obsidian_create_note` or `obsidian_delete_note`, the request is denied with a `403 Forbidden` response.
4. **Blast Radius Control (`SCOPES`)**  
   Scopes provide least-privilege access. An agent tasked with drafting daily logs can be assigned `vault:read,vault:write` without granting `vault:delete` (preventing note loss) or `vault:developer` (preventing CLI access).
5. **Session Safety & Loop Prevention (`RATE_LIMIT_PER_MINUTE`)**  
   Autonomous AI agents occasionally enter repetitive retry loops. The sliding-window rate limiter prevents CPU exhaustion, excessive disk I/O, or Obsidian UI unresponsiveness.

---

## Local Development Setup

### Prerequisites
1. **Node.js**: v20+ LTS
2. **Obsidian Desktop**: v1.12.0+ installed and running locally
3. **CLI Enabled**: Inside Obsidian, open **Settings &rarr; Command line interface &rarr; Toggle ON**

### Installation & Build

```bash
# 1. Clone repository
git clone https://github.com/dharmikbhesaniya/obsidian-mcp.git
cd obsidian-mcp

# 2. Install dependencies
npm install

# 3. Create local environment configuration
cp .env.example .env
```

Edit `.env` for your local path:
```ini
OBSIDIAN_VAULT_PATH=/Users/yourusername/Documents/MyVault
MCP_TRANSPORT=stdio
AUTH_ENABLED=false
```

Build and test:
```bash
# Run test suite (unit, integration, and security checks)
npm test

# Build TypeScript to dist/
npm run build
```

---

### Running with Claude Desktop (stdio)

Add the server to your Claude Desktop configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

---

### Single Vault vs. Multi-Vault Configuration

#### Scenario 1: Single Vault (Full Read & Write Access)
Use this setup when you have one primary vault and want your AI assistant to read notes, answer questions, draft content, and organize tags.

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp/dist/index.js"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/Users/yourusername/Documents/MyVault",
        "READ_ONLY": "false"
      }
    }
  }
}
```

#### Scenario 2: Single Vault (Safe Read-Only Mode)
Use this setup if you want an AI assistant to query and reference your vault without the ability to create, edit, or delete any files.

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp/dist/index.js"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/Users/yourusername/Documents/MyVault",
        "READ_ONLY": "true"
      }
    }
  }
}
```

#### Scenario 3: Multi-Vault on a Single MCP Server (Unified Routing)
Use this setup if you have multiple vaults (e.g. work and personal) and want a single AI assistant to route commands between them using the `vault` parameter.

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp/dist/index.js"
      ],
      "env": {
        "OBSIDIAN_VAULTS": "work=/Users/yourusername/Documents/WorkVault,personal=/Users/yourusername/Documents/PersonalVault",
        "OBSIDIAN_DEFAULT_VAULT": "work",
        "READ_ONLY": "false"
      }
    }
  }
}
```
*How it works*:
- The AI discovers both vaults via `obsidian_list_vaults`.
- Requests specifying `"vault": "personal"` operate on the personal vault.
- Requests without a `vault` parameter automatically default to `work`.

#### Scenario 4: Multi-Vault with Separate Server Blocks (Independent Permissions)
Use this setup when you want different security policies for each vault—such as allowing the AI to write to your work vault while keeping your personal vault strictly read-only.

```json
{
  "mcpServers": {
    "obsidian_work": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp/dist/index.js"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/Users/yourusername/Documents/WorkVault",
        "READ_ONLY": "false"
      }
    },
    "obsidian_personal": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp/dist/index.js"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/Users/yourusername/Documents/PersonalVault",
        "READ_ONLY": "true"
      }
    }
  }
}
```

---

### Running with Cursor IDE

Add the server to Cursor's MCP configuration in `~/.cursor/mcp.json` or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault",
        "READ_ONLY": "false"
      }
    }
  }
}
```

### Testing with MCP Inspector

Test tools interactively in the browser without an external client:

```bash
npx @modelcontextprotocol/inspector@latest node dist/index.js
```

---

## Production VPS Setup (Hostinger / Ubuntu / Debian)

This guide walks through deploying the MCP server on a remote Linux VPS (e.g. Hostinger Ubuntu 24.04 LTS or Debian 12).

### Step 1: Install Operating System Dependencies

Obsidian Desktop on Linux requires a virtual frame buffer (`xvfb`) when running in headless server environments:

```bash
sudo apt update
sudo apt install -y xvfb libnotify4 libnss3 libasound2 libgbm1 libsecret-1-0 nodejs npm caddy
```

Verify Node.js is v20+:
```bash
node -v
```

### Step 2: Create Dedicated Service Account

Run all Obsidian and MCP processes under a restricted service account:

```bash
# Create service user
sudo useradd -r -m -d /opt/obsidian -s /bin/bash obsidian

# Create application and vault directories
sudo mkdir -p /srv/obsidian/vault
sudo mkdir -p /etc/obsidian-mcp
sudo mkdir -p /opt/obsidian-mcp

# Assign ownership
sudo chown -R obsidian:obsidian /srv/obsidian
sudo chown -R obsidian:obsidian /opt/obsidian-mcp
```

### Step 3: Install Obsidian Desktop and Enable CLI

Download and install the official Obsidian `.deb` package:

```bash
wget https://github.com/obsidianmd/obsidian-releases/releases/download/v1.12.0/obsidian_1.12.0_amd64.deb
sudo dpkg -i obsidian_1.12.0_amd64.deb
sudo apt install -f -y
```

Verify the binary is available:
```bash
which obsidian
# Output: /usr/bin/obsidian
```

### Step 4: Configure Headless Display (Xvfb Service)

Copy the Xvfb systemd service file:

```bash
sudo cp deploy/systemd/obsidian-xvfb.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now obsidian-xvfb.service
```

Verify that virtual display `:5` is active:
```bash
sudo systemctl status obsidian-xvfb.service
```

### Step 5: Deploy the MCP Server

```bash
# Clone repository to deployment location
sudo -u obsidian git clone https://github.com/dharmikbhesaniya/obsidian-mcp.git /opt/obsidian-mcp
cd /opt/obsidian-mcp

# Install dependencies and compile
sudo -u obsidian npm ci
sudo -u obsidian npm run build
```

Generate a secure Bearer access token:
```bash
# Generate random 32-byte secret token
TOKEN=$(openssl rand -hex 32)
echo "Your Raw Token: $TOKEN"

# Compute SHA-256 hash for configuration
TOKEN_HASH=$(echo -n "$TOKEN" | sha256sum | awk '{print $1}')
echo "Your Token Hash: $TOKEN_HASH"
```

Configure `/etc/obsidian-mcp/.env`:
```ini
NODE_ENV=production
MCP_TRANSPORT=http
PORT=3000
HOST=127.0.0.1
OBSIDIAN_VAULT_PATH=/srv/obsidian/vault
OBSIDIAN_BIN_PATH=/usr/bin/obsidian
AUTH_ENABLED=true
BEARER_TOKEN_HASH=<paste_computed_token_hash_here>
RATE_LIMIT_PER_MINUTE=120
MAX_SEARCH_RESULTS=50
COMMAND_TIMEOUT_MS=15000
ENABLE_DESTRUCTIVE_TOOLS=true
ENABLE_ADVANCED_CLI=false
LOG_LEVEL=info
```

#### Feature Flag Controls
- **`ENABLE_DESTRUCTIVE_TOOLS`**: When set to `false`, destructive operations (`obsidian_delete_note` and `obsidian_move_note`) are excluded from MCP registration. Defaults to `true`.
- **`ENABLE_ADVANCED_CLI`**: When set to `true`, the guarded `obsidian_cli` tool is registered for allowlisted commands (requires `vault:developer` scope). Defaults to `false`.

Set secure permissions on the environment configuration:
```bash
sudo chown obsidian:obsidian /etc/obsidian-mcp/.env
sudo chmod 600 /etc/obsidian-mcp/.env
```

Install and enable the systemd service:
```bash
sudo cp deploy/systemd/obsidian-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now obsidian-mcp.service
```

### Step 6: Configure Reverse Proxy with TLS (Caddy or Nginx)

#### Option A: Caddy (Recommended — Automatic TLS)

Edit `/etc/caddy/Caddyfile`:

```caddy
mcp.yourdomain.com {
    encode gzip zstd

    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}

        transport http {
            keepalive 120s
            response_header_timeout 600s
        }
    }

    log {
        output file /var/log/caddy/obsidian_mcp.log
        format json
    }
}
```

Restart Caddy:
```bash
sudo systemctl restart caddy
```

#### Option B: Nginx

Copy `deploy/nginx/obsidian-mcp.conf` to `/etc/nginx/sites-available/obsidian-mcp.conf` and obtain a certificate using Certbot:
```bash
sudo certbot --nginx -d mcp.yourdomain.com
sudo systemctl restart nginx
```

### Step 7: Verify Health Endpoints

Test that the service is running and accessible:

```bash
# 1. Check MCP process health
curl https://mcp.yourdomain.com/health
# Response: {"status":"ok","mcp":"running","uptimeSeconds":42,"timestamp":"..."}

# 2. Check vault and Obsidian readiness
curl https://mcp.yourdomain.com/ready
# Response: {"status":"ready","vaultAccessible":true,"obsidianConnected":true,...}
```

---

## Connecting Remote Clients

The server provides two HTTP transport modes:
- **Streamable HTTP (`/mcp`)**: Native high-performance streaming transport for modern MCP clients.
- **Server-Sent Events (`/sse`)**: Dedicated SSE stream transport with `/messages` for legacy MCP clients.

### Connecting ChatGPT

1. In ChatGPT, open **Explore GPTs** &rarr; **Create a GPT** (or configure **Custom Actions**).
2. For remote MCP connections, configure the endpoint:
   - **URL**: `https://mcp.yourdomain.com/sse` (or `/mcp` for Streamable HTTP clients)
   - **Authentication**: `Bearer`
   - **Token**: `<your_raw_bearer_token>`
3. ChatGPT will discover all active semantic tools via the MCP protocol and display them under capabilities.

### Connecting Remote Claude

Add the remote server to Claude Desktop via Streamable HTTP (`/mcp`) or SSE (`/sse`):

```json
{
  "mcpServers": {
    "obsidian-remote": {
      "url": "https://mcp.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer <your_raw_bearer_token>"
      }
    }
  }
}
```

*(For legacy Claude clients requiring SSE, use `https://mcp.yourdomain.com/sse`)*

### Connecting Hermes Agent (Nous Research)

In Hermes Agent, configure the remote MCP endpoint in `~/.hermes/config.yaml`:

```yaml
mcp:
  servers:
    obsidian:
      url: "https://mcp.yourdomain.com/sse"
      headers:
        Authorization: "Bearer <your_raw_bearer_token>"
```

---

## Automated Test Suite

The repository contains an automated test matrix covering unit logic, path isolation, security policies, concurrency control, and protocol integration:

```bash
# Execute entire test suite
npm test

# Run build typecheck
npm run build
```

The test suite covers:
- **Frontmatter & YAML Serialization**: Tests scalar properties, flow lists, block arrays, colons in titles, and wikilink parsing.
- **PathGuard Security**: Strict rejection of leading slashes, path traversal (`../`), null byte injections, and symlink escapes.
- **Timing-Safe Authentication**: Bearer token parsing, timing-safe SHA-256 verification, and scope validation.
- **Optimistic Concurrency**: Conflict detection across note updates, appends, prepends, property mutations, and note deletions.
- **CLI Allowlist**: Enforces command allowlisting rejecting unauthorized process execution.
- **Context Engine**: Integration test of single-call note context assembly (content, metadata, headings, backlinks, and related notes).
- **Protocol Discovery**: McpServer initialization and capability registration.

---

## Security Model & Path Isolation

The server enforces four security boundaries:

1. **PathGuard**: All note paths must be vault-relative. Attempts to traverse directories (`../`), inject null bytes (`\0`), use absolute paths (`/etc/passwd`), or follow external symlinks are rejected before touching disk.
2. **Bearer Token Authentication**: Uses SHA-256 constant-time hash verification. Raw tokens are never stored on the server.
3. **Scope Enforcement**:
   - `vault:read`: Allows searches, task reads, property inspection, and note reading.
   - `vault:write`: Allows note creation, appends, prepends, and property updates.
   - `vault:delete`: Required for note moves, renames, and deletion.
   - `vault:developer`: Required for allowlisted CLI command execution (`obsidian_cli`).
4. **Audit Trail**: Every invocation logs structured JSON with `request_id`, client identity, tool name, and duration without recording private note content.

---

## Error Handling Protocol

Every failure returns structured error payloads:

| Error Code | HTTP Status | Meaning |
| :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | Missing or invalid Bearer token credentials. |
| `FORBIDDEN` | 403 | Token lacks the required scope for the requested tool. |
| `PATH_INVALID` | 400 | Path attempted directory traversal or points outside the vault. |
| `NOT_FOUND` | 404 | Target note, folder, or property does not exist. |
| `CONFLICT` | 409 | Concurrent modification detected via revision hash. |
| `OBSIDIAN_UNAVAILABLE` | 503 | Obsidian desktop or CLI IPC is offline. |
| `RATE_LIMITED` | 429 | Client exceeded request quota. |
| `VALIDATION_ERROR` | 400 | Malformed arguments failing schema validation. |
| `INTERNAL_ERROR` | 500 | Unexpected service error. |

---

## NPM Package Distribution

The package is configured for direct zero-install execution via `npx` or standard installation via `npm`:

```bash
# Execute directly without cloning or building
OBSIDIAN_VAULT_PATH="/path/to/vault" npx -y obsidian-mcp

# Or install globally
npm install -g obsidian-mcp
```

### Publishing to NPM

1. **Verify Tarball Contents**:
   ```bash
   npm pack --dry-run
   ```
   Only `dist/`, `package.json`, `README.md`, and `LICENSE` are packaged.

2. **Authenticate with NPM**:
   ```bash
   npm login
   ```

3. **Publishing Manually**:
   ```bash
   # Automatically executes prepublishOnly (runs build and tests)
   npm publish --access public
   ```

4. **Automated Publishing via GitHub Actions**:
   Create a new release or tag on GitHub (`v0.1.0`). The workflow in `.github/workflows/publish.yml` will automatically build, test, and publish the package to the NPM registry using the repository's `NPM_TOKEN` secret.

---

## License

MIT License. See [LICENSE](LICENSE) for full details.
