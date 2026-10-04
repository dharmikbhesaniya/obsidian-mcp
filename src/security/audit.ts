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
  public log(record: AuditRecord): void {
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
