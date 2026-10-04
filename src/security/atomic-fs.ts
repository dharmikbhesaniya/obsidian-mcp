import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * AtomicFs provides crash-resilient file system write operations.
 * Writes are performed to a localized temporary file before executing an atomic rename,
 * ensuring that interrupted processes never leave partial or corrupt notes in the vault.
 */
export class AtomicFs {
  /**
   * Atomically writes content to a file.
   */
  public static writeFileSync(
    targetPath: string,
    content: string | Buffer,
    encoding: BufferEncoding = "utf-8"
  ): void {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempFile = path.join(dir, `.tmp-${crypto.randomUUID()}`);
    try {
      fs.writeFileSync(tempFile, content, encoding);
      fs.renameSync(tempFile, targetPath);
    } catch (err) {
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // ignore cleanup errors
        }
      }
      throw err;
    }
  }

  /**
   * Safely removes a file if it exists.
   */
  public static unlinkSync(targetPath: string): void {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }
}
