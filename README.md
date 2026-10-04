# Obsidian Remote MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Protocol](https://img.shields.io/badge/MCP-Model_Context_Protocol-blue.svg)](https://modelcontextprotocol.io)
[![Status](https://img.shields.io/badge/status-planning_%26_init-orange.svg)](#)

A secure, typed remote [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server enabling AI clients (ChatGPT, Claude, Codex, Cursor, Hermes Agent) to interact directly with an Obsidian knowledge vault hosted on a remote VPS or local environment.

---

## Architecture Overview

```
ChatGPT / Claude / Cursor / Hermes
                │
                │ MCP over HTTPS (Streamable HTTP)
                ▼
      Caddy / Nginx Reverse Proxy (TLS)
                │
                ▼
       Obsidian MCP Server
     (Auth, PathGuard, Scopes)
                │
                ▼
       Obsidian CLI Adapter
                │
                ▼
    Obsidian Desktop (IPC via Xvfb)
                │
                ▼
       Obsidian Vault on VPS
```

---

## Complete Plan & Roadmap

The complete architecture specification, formal tool contracts (25 semantic tools), security model, VPS deployment guide, and phased milestone tracker are documented in:

👉 **[`MCP_PRODUCTION_PLAN.md`](MCP_PRODUCTION_PLAN.md)**

---

## Key Highlights

- **Typed Semantic Tools**: 25 tools covering Vault, Notes, Search, Daily Notes, Properties, Tasks, Links, Tags, and Bases. No raw shell execution.
- **Dual Transport**: `stdio` for local development and `Streamable HTTP` over HTTPS for remote VPS hosting.
- **Enterprise Security**: Bearer token authentication, scoped permissions (`vault:read`, `vault:write`, `vault:delete`, `vault:admin`, `vault:developer`), and hard path traversal protection.
- **Observability**: Structured audit logs and operational health checks (`/health` and `/ready`).

---

## License

MIT License. See [LICENSE](LICENSE) for details.
