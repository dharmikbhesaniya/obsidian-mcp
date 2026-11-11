# Production Deployment & MCP Troubleshooting Guide

This guide details the diagnosis, architectural fixes, and server-side deployment steps for the Obsidian Remote MCP Server hosted on Hostinger VPS (`obsidianmcp.hvps.dharmikbhesaniya.tech`).

---

## 1. Problem Diagnosis

When connecting an external AI client (such as Claude, ChatGPT, or Cursor) to the production MCP endpoint:
`https://obsidianmcp.hvps.dharmikbhesaniya.tech/s/4a7caf5abe2ca5b9837c326ddb87ba70768cc874e902892f/mcp`

The client returned the following error:
```text
Connection failed
Result: The Obsidian MCP server is still returning:
404 - MCP SSE probe returned 404
Host: dharmikbhesaniya.tech
```

### Root Cause Analysis

Three distinct configuration discrepancies contributed to this failure:

1. **Host Mismatch (`Host: dharmikbhesaniya.tech`)**:
   - The root domain `dharmikbhesaniya.tech` resolves to IP `2.57.91.91` (Hostinger Shared Hosting / Parked Domain Page).
   - The production VPS running Obsidian MCP is hosted on subdomain `obsidianmcp.hvps.dharmikbhesaniya.tech` (IP `187.126.126.218`).
   - Entering `dharmikbhesaniya.tech` in the AI connector routed requests to the parked domain CDN rather than the VPS, generating a 404 error during probe requests.

2. **Missing Native Secret Path Routing (`/s/:token/...`)**:
   - The previous Express router only registered explicit endpoints at `/mcp`, `/sse`, and `/messages`.
   - When an AI client probed for Server-Sent Events (SSE) at `/s/<token>/sse`, Express returned `Cannot GET /s/.../sse` (HTTP 404).

3. **Authentication Token Alignment on VPS**:
   - Testing the server with `Authorization: Bearer 4a7caf5abe2ca5b9837c326ddb87ba70768cc874e902892f` returned `401 Unauthorized: Invalid access token credentials`.
   - The token in the URL must match `AUTH_TOKEN` or `BEARER_TOKEN_HASH` in `/root/projects/obsidian-mcp/.env`.

---

## 2. Server Changes Implemented

The following enhancements have been applied to the codebase in `src/transport/http.ts`:

1. **Native Secret Path Routing**:
   - Registered endpoints:
     - `app.all(["/mcp", "/s/:token/mcp", "/s/:token"], handleMcp)`
     - `app.get(["/sse", "/s/:token/sse"], handleSse)`
     - `app.post(["/messages", "/s/:token/messages"], handleMessages)`
     - `app.get(["/health", "/s/:token/health"], handleHealth)`
     - `app.get(["/ready", "/s/:token/ready"], handleReady)`

2. **Path Parameter Token Extraction**:
   - `extractAuth` now inspects the URL path (`/s/:token/...`), query string (`?token=...`), and `Authorization: Bearer <token>` header in that priority order.

3. **Automatic SSE Negotiation on `/mcp`**:
   - If an AI client sends a `GET` request with `Accept: text/event-stream` to `/mcp` or `/s/:token/mcp`, the server automatically initializes an SSE stream instead of failing.
   - For regular `GET` probes, the server returns an active status payload with transport endpoints.

4. **Preserved Message Routing for SSE**:
   - When an SSE session begins under `/s/:token/sse`, its messages endpoint is automatically assigned to `/s/:token/messages`. Subsequent client POST requests inherit authentication without needing custom headers.

---

## 3. Hostinger VPS Deployment Steps

Execute the following commands on the Hostinger VPS to deploy the updated build and align credentials:

### Step 1: Update the Repository on the VPS
```bash
cd /root/projects/obsidian-mcp
git pull origin main
npm install
npm run build
```

### Step 2: Configure `/root/projects/obsidian-mcp/.env`
Verify that `.env` contains the matching token:

```bash
# Security & Authentication
AUTH_ENABLED=true

# Set this to the secret token in your URL:
AUTH_TOKEN=4a7caf5abe2ca5b9837c326ddb87ba70768cc874e902892f

# Alternatively, set the SHA-256 hash:
# BEARER_TOKEN_HASH=0601ddc0141120d3ac6200dfa9ea918aab4b987bc4913233813522de20c30d47
```

### Step 3: Check Nginx Reverse Proxy Configuration
Open `/etc/nginx/sites-available/obsidianmcp.hvps.dharmikbhesaniya.tech` (or your active server block):

```nginx
server {
    listen 80;
    server_name obsidianmcp.hvps.dharmikbhesaniya.tech;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name obsidianmcp.hvps.dharmikbhesaniya.tech;

    ssl_certificate /etc/letsencrypt/live/obsidianmcp.hvps.dharmikbhesaniya.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/obsidianmcp.hvps.dharmikbhesaniya.tech/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9435;
        proxy_http_version 1.1;

        # Mandatory for Server-Sent Events (SSE)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;

        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Reload Nginx after editing:
```bash
nginx -t && systemctl reload nginx
```

### Step 4: Restart the Obsidian MCP Service
Depending on your process manager:

**If running under systemd:**
```bash
systemctl restart obsidian-mcp
systemctl status obsidian-mcp
```

**If running under PM2:**
```bash
pm2 restart obsidian-mcp --update-env
pm2 status
```

**If running under Docker:**
```bash
docker compose down && docker compose up -d --build
```

---

## 4. Verification Commands

Run these checks to confirm all endpoints respond properly:

### 1. Health Endpoint
```bash
curl -i "https://obsidianmcp.hvps.dharmikbhesaniya.tech/health"
```
*Expected*: `HTTP/2 200` with JSON status payload.

### 2. Secret Path GET Probe
```bash
curl -i "https://obsidianmcp.hvps.dharmikbhesaniya.tech/s/4a7caf5abe2ca5b9837c326ddb87ba70768cc874e902892f/mcp"
```
*Expected*: `HTTP/2 200` with `authenticated: true` and active MCP metadata.

### 3. Secret Path SSE Probe
```bash
curl -i -N -H "Accept: text/event-stream" "https://obsidianmcp.hvps.dharmikbhesaniya.tech/s/4a7caf5abe2ca5b9837c326ddb87ba70768cc874e902892f/sse"
```
*Expected*: `HTTP/2 200` with `content-type: text/event-stream` and endpoint event stream.

---

## 5. Client Connector Setup Summary

In the external AI client application (ChatGPT, Claude, or Cursor connector):

1. **Connector URL**:
   ```text
   https://obsidianmcp.hvps.dharmikbhesaniya.tech/s/4a7caf5abe2ca5b9837c326ddb87ba70768cc874e902892f/mcp
   ```
   *(Ensure the host is `obsidianmcp.hvps.dharmikbhesaniya.tech`, not `dharmikbhesaniya.tech`)*.

2. **Authentication Setting**:
   - Set to **No authentication** (or None).
   - Because the secret passkey is embedded in `/s/<token>/`, custom headers are not required.
