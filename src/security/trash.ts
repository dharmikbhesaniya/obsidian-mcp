import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AtomicFs } from "./atomic-fs.js";

export interface TrashMetadata {
  originalPath: string;
  deletedAt: string;
  sizeBytes: number;
  revision: string;
}

export class TrashManager {
  private readonly vaultRoot: string;
  private readonly trashDir: string;

  constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot;
    this.trashDir = path.join(vaultRoot, ".obsidian-mcp", "trash");
  }

  /**
   * Moves a file into the safe trash directory with metadata.
   */
  public moveToTrash(sourceAbsolutePath: string, originalRelativePath: string, revision: string): { trashPath: string; trashedAt: string } {
    if (!fs.existsSync(this.trashDir)) {
      fs.mkdirSync(this.trashDir, { recursive: true });
    }

    const timestamp = Date.now();
    const sanitizedBase = path.basename(originalRelativePath);
    const trashFileName = `${timestamp}_${sanitizedBase}`;
    const trashFilePath = path.join(this.trashDir, trashFileName);
    const metaFilePath = `${trashFilePath}.meta.json`;

    const stat = fs.statSync(sourceAbsolutePath);
    const metadata: TrashMetadata = {
      originalPath: originalRelativePath,
      deletedAt: new Date(timestamp).toISOString(),
      sizeBytes: stat.size,
      revision,
    };

    // Move file into trash
    fs.renameSync(sourceAbsolutePath, trashFilePath);

    // Write metadata atomically
    AtomicFs.writeFileSync(metaFilePath, JSON.stringify(metadata, null, 2));

    return {
      trashPath: path.relative(this.vaultRoot, trashFilePath),
      trashedAt: metadata.deletedAt,
    };
  }

  /**
   * Lists all items currently in trash.
   */
  public listTrash(): Array<TrashMetadata & { id: string }> {
    if (!fs.existsSync(this.trashDir)) {
      return [];
    }

    const files = fs.readdirSync(this.trashDir);
    const metaFiles = files.filter((f) => f.endsWith(".meta.json"));
    const items: Array<TrashMetadata & { id: string }> = [];

    for (const metaFile of metaFiles) {
      try {
        const fullMetaPath = path.join(this.trashDir, metaFile);
        const data = JSON.parse(fs.readFileSync(fullMetaPath, "utf-8")) as TrashMetadata;
        items.push({
          ...data,
          id: metaFile.replace(/\.meta\.json$/, ""),
        });
      } catch {
        // ignore corrupted metadata files
      }
    }

    return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
}
