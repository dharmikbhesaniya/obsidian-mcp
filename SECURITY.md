# Security Policy

## Supported Versions

Security updates and patches are actively applied to the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

If you discover a potential security vulnerability within `obsidian-mcp`, please follow responsible disclosure practices:

1. **Do not** disclose vulnerabilities publicly in public GitHub issues, discussions, or social channels.
2. Report the vulnerability privately via [GitHub Security Advisories](https://github.com/dharmikbhesaniya/obsidian-mcp/security/advisories/new) or by emailing the project maintainer at `dharmikbhesaniya@gmail.com`.
3. Include detailed steps to reproduce the vulnerability, along with sample configuration and environment details.

You will receive an initial response within 48 hours acknowledging receipt of the report. A fix will be developed, tested, and published promptly.

## Security Architecture & Hardening

`obsidian-mcp` is designed with security-first defaults:
- **Path Traversal Sandboxing**: Strict canonical path resolution ensures file operations cannot escape configured vault root directories.
- **Bearer Token Hashing**: Authentication tokens are converted to SHA-256 hashes and evaluated using timing-safe comparisons (`crypto.timingSafeEqual`).
- **Granular Scopes & Isolation**: Per-vault read-only (`:ro`) and read-write (`:rw`) flags restrict destructive tool execution at runtime.
- **Rate Limiting & Audit Logging**: Built-in request sliding-window rate limiters and operational audit trails prevent credential brute-forcing and unauthorized discovery attempts.
