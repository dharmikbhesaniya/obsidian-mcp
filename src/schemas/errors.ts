/**
 * Standard Error Protocol for Obsidian Remote MCP Server
 * Stable, machine-readable error codes and structured response envelopes.
 */

export const ErrorCode = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  PATH_INVALID: "PATH_INVALID",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  OBSIDIAN_UNAVAILABLE: "OBSIDIAN_UNAVAILABLE",
  VAULT_UNAVAILABLE: "VAULT_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorDetails {
  code: ErrorCodeType;
  message: string;
  field?: string;
  retryAfterSeconds?: number;
  expectedRevision?: string;
  actualRevision?: string;
}

export class ObsidianMcpError extends Error {
  public readonly code: ErrorCodeType;
  public readonly statusCode: number;
  public readonly details?: Record<string, any>;

  constructor(code: ErrorCodeType, message: string, statusCode: number = 400, details?: Record<string, any>) {
    super(message);
    this.name = "ObsidianMcpError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}
