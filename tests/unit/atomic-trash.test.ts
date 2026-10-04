import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AtomicFs } from "../../src/security/atomic-fs.js";
import { TrashManager } from "../../src/security/trash.js";

describe("AtomicFs & TrashManager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-atomic-trash-")));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("AtomicFs", () => {
    it("should write files atomically to target path", () => {
      const target = path.join(tempDir, "sub", "note.md");
      AtomicFs.writeFileSync(target, "# Hello World\n");

      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, "utf-8")).toBe("# Hello World\n");

      // Verify no temporary files remain
      const parentFiles = fs.readdirSync(path.dirname(target));
      expect(parentFiles.filter((f) => f.startsWith(".tmp-"))).toHaveLength(0);
    });

    it("should safely unlink existing and non-existing files", () => {
      const target = path.join(tempDir, "to-delete.md");
      AtomicFs.writeFileSync(target, "delete me");
      expect(fs.existsSync(target)).toBe(true);

      AtomicFs.unlinkSync(target);
      expect(fs.existsSync(target)).toBe(false);

      // Should not throw on non-existent file
      expect(() => AtomicFs.unlinkSync(target)).not.toThrow();
    });
  });

  describe("TrashManager", () => {
    it("should move note to .obsidian-mcp/trash with json metadata", () => {
      const trashManager = new TrashManager(tempDir);
      const notePath = path.join(tempDir, "notes", "old-note.md");
      fs.mkdirSync(path.dirname(notePath), { recursive: true });
      fs.writeFileSync(notePath, "# To Trash Content", "utf-8");

      const rev = crypto.createHash("sha1").update("# To Trash Content").digest("hex");
      const res = trashManager.moveToTrash(notePath, "notes/old-note.md", rev);

      expect(fs.existsSync(notePath)).toBe(false);
      expect(res.trashPath).toContain(".obsidian-mcp/trash");

      // Verify trash list
      const items = trashManager.listTrash();
      expect(items.length).toBe(1);
      expect(items[0].originalPath).toBe("notes/old-note.md");
      expect(items[0].revision).toBe(rev);
      expect(items[0].sizeBytes).toBeGreaterThan(0);
      expect(items[0].deletedAt).toBeDefined();
    });
  });
});
