import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { PathGuard } from "../../src/security/path-guard.js";
import { ObsidianCliAdapter } from "../../src/adapters/obsidian/cli.adapter.js";
import { VaultService } from "../../src/services/vault.service.js";

describe("VaultService Integration", () => {
  let tempVaultDir: string;
  let service: VaultService;

  beforeEach(() => {
    tempVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-mcp-vault-test-"));
    const guard = new PathGuard(tempVaultDir);
    const cli = new ObsidianCliAdapter("mock-obsidian");
    service = new VaultService(guard, cli);
  });

  afterEach(() => {
    fs.rmSync(tempVaultDir, { recursive: true, force: true });
  });

  it("should create, read, and append to notes", async () => {
    const notePath = "projects/test.md";
    const createRes = await service.createNote(notePath, "# Initial Heading\nInitial content.");
    expect(createRes.created).toBe(true);

    const readRes = await service.readNote(notePath);
    expect(readRes.content).toContain("Initial Heading");
    expect(readRes.path).toBe("projects/test.md");

    await service.appendNote(notePath, "- [ ] New task appended");
    const updated = await service.readNote(notePath);
    expect(updated.content).toContain("- [ ] New task appended");
  });

  it("should update notes with optimistic concurrency", async () => {
    const notePath = "concurrency.md";
    await service.createNote(notePath, "Version 1");

    const read = await service.readNote(notePath);
    const rev1 = read.revision;

    const updateRes = await service.updateNote(notePath, "Version 2", rev1);
    expect(updateRes.updated).toBe(true);

    // Stale revision must throw conflict
    await expect(service.updateNote(notePath, "Version 3", rev1)).rejects.toThrow();
  });

  it("should search notes within vault", async () => {
    await service.createNote("docs/arch.md", "Architecture design document with Redis transport.");
    await service.createNote("docs/other.md", "Random thoughts about design patterns.");

    const res = await service.search("Redis");
    expect(res.matches.length).toBe(1);
    expect(res.matches[0].path).toBe("docs/arch.md");
  });

  it("should list tasks from notes", async () => {
    await service.createNote("todo.md", "- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3");

    const res = await service.listTasks("todo.md", "todo");
    expect(res.tasks.length).toBe(2);
    expect(res.tasks[0].text).toBe("Task 1");
    expect(res.tasks[1].text).toBe("Task 3");
  });

  it("should set and read frontmatter properties", async () => {
    const notePath = "metadata.md";
    await service.createNote(notePath, "---\ntitle: Sample\n---\nBody text");

    await service.setProperty(notePath, "status", "complete");
    const props = await service.getProperties(notePath);
    expect(props.properties.status).toBe("complete");
  });
});
