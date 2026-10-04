export interface AuditRecord {
  timestamp: string;
  requestId: string;
  clientId: string;
  tool: string;
  path?: string;
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

    // Structured JSON log output without exposing sensitive note bodies
    const entry = JSON.stringify({
      level: record.status === "error" ? "warn" : "info",
      type: "mcp_audit",
      ...record,
    });

    if (record.status === "error") {
      console.error(entry);
    } else {
      console.log(entry);
    }
  }
}
