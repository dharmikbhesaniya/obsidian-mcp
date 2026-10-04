export interface AuditRecord {
  timestamp: string;
  requestId: string;
  clientId: string;
  tool: string;
  path?: string;
  vault?: string;
  status: "success" | "error";
  durationMs: number;
  errorCode?: string;
}

export class AuditLogger {
  private readonly enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public log(record: AuditRecord): void {
    if (!this.enabled) {
      return;
    }

    // Structured JSON log output to stderr without exposing sensitive note bodies.
    // In stdio MCP transport, stdout is strictly reserved for JSON-RPC 2.0 protocol frames.
    const entry = JSON.stringify({
      level: record.status === "error" ? "warn" : "info",
      type: "mcp_audit",
      ...record,
    });

    console.error(entry);
  }
}
