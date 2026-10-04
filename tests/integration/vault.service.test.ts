import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { PathGuard } from "../../src/security/path-guard.js";
import { ObsidianCliAdapter } from "../../src/adapters/obsidian/cli.adapter.js";
import { VaultService } from "../../src/services/vault.service.js";
import { ErrorCode, ObsidianMcpError } from "../../src/schemas/errors.js";

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

  it("should enforce optimistic concurrency across all mutating operations", async () => {
    const notePath = "concurrency.md";
    await service.createNote(notePath, "Version 1");

    const read = await service.readNote(notePath);
    const rev1 = read.revision;

    // 1. updateNote
    const updateRes = await service.updateNote(notePath, "Version 2", rev1);
    expect(updateRes.updated).toBe(true);
    const rev2 = updateRes.newRevision;

    // Stale revision on updateNote must throw CONFLICT
    await expect(service.updateNote(notePath, "Version 3", rev1)).rejects.toThrowError(ObsidianMcpError);

    // 2. appendNote with valid revision
    const appendRes = await service.appendNote(notePath, "\nAppended line", true, rev2);
    expect(appendRes.appended).toBe(true);
    const rev3 = appendRes.newRevision;

    // Stale revision on appendNote must throw CONFLICT
    await expect(service.appendNote(notePath, "Invalid append", true, rev2)).rejects.toThrowError(ObsidianMcpError);

    // 3. prependNote with valid revision
    const prependRes = await service.prependNote(notePath, "Prepended Header\n", rev3);
    expect(prependRes.prepended).toBe(true);
    const rev4 = prependRes.newRevision;

    // Stale revision on prependNote must throw CONFLICT
    await expect(service.prependNote(notePath, "Invalid prepend", rev3)).rejects.toThrowError(ObsidianMcpError);

    // 4. setProperty with valid revision
    const propRes = await service.setProperty(notePath, "status", "in-progress", rev4);
    expect(propRes.updated).toBe(true);
    const rev5 = propRes.newRevision;

    // Stale revision on setProperty must throw CONFLICT
    await expect(service.setProperty(notePath, "status", "done", rev4)).rejects.toThrowError(ObsidianMcpError);

    // 5. deleteNote with stale revision must throw CONFLICT
    await expect(service.deleteNote(notePath, false, rev4)).rejects.toThrowError(ObsidianMcpError);

    // deleteNote with valid revision succeeds
    const delRes = await service.deleteNote(notePath, false, rev5);
    expect(delRes.deleted).toBe(true);
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

  it("should set, read, and remove structured frontmatter properties", async () => {
    const notePath = "metadata.md";
    await service.createNote(notePath, "---\ntitle: Sample Note\ntags:\n  - arch\n---\nBody text");

    await service.setProperty(notePath, "status", "complete");
    await service.setProperty(notePath, "priority", 1);
    await service.setProperty(notePath, "tags", ["arch", "backend", "api"]);

    const props = await service.getProperties(notePath);
    expect(props.properties.status).toBe("complete");
    expect(props.properties.priority).toBe(1);
    expect(props.properties.tags).toEqual(["arch", "backend", "api"]);

    await service.removeProperty(notePath, "status");
    const updatedProps = await service.getProperties(notePath);
    expect(updatedProps.properties.status).toBeUndefined();
    expect(updatedProps.properties.priority).toBe(1);
  });

  it("should enforce CLI command allowlist", async () => {
    // Disallowed command must throw 403 FORBIDDEN before process execution
    try {
      await service.executeCli("rm", { path: "important.md" });
      expect.fail("Should have thrown FORBIDDEN");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ObsidianMcpError);
      expect(err.code).toBe(ErrorCode.FORBIDDEN);
    }

    try {
      await service.executeCli("bash", { command: "whoami" });
      expect.fail("Should have thrown FORBIDDEN");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ObsidianMcpError);
      expect(err.code).toBe(ErrorCode.FORBIDDEN);
    }
  });

  it("should retrieve rich note context in a single call (Context Engine)", async () => {
    await service.createNote("03-Knowledge/Auth.md", `---
title: Auth Architecture
tags:
  - security
---

# Authentication System
We use OAuth and tokens.
See also [[03-Knowledge/Sessions]] for details.
`);

    await service.createNote("03-Knowledge/Sessions.md", `---
title: Session Architecture
tags:
  - security
---

# Sessions
Refer to [[03-Knowledge/Auth]] for credentials.
`);

    const ctx = await service.getNoteContext("03-Knowledge/Auth.md");
    expect(ctx.path).toBe("03-Knowledge/Auth.md");
    expect(ctx.frontmatter.title).toBe("Auth Architecture");
    expect(ctx.headings).toEqual([{ level: 1, text: "Authentication System" }]);
    expect(ctx.outgoingLinks).toEqual(["03-Knowledge/Sessions"]);
    expect(ctx.backlinks).toContain("03-Knowledge/Sessions.md");
    expect(ctx.relatedNotes).toContain("03-Knowledge/Sessions.md");
    expect(ctx.body).toContain("We use OAuth and tokens.");
  });

  it("should find notes by query, tag, and property", async () => {
    await service.createNote("note1.md", "---\ntitle: Database Tuning\ntags: [db, perf]\ncategory: infra\n---\nPostgres performance");
    await service.createNote("note2.md", "---\ntitle: UI Components\ntags: [frontend]\ncategory: design\n---\nReact components");

    const tagSearch = await service.findNotes({ tag: "db" });
    expect(tagSearch.notes.length).toBe(1);
    expect(tagSearch.notes[0].path).toBe("note1.md");

    const propSearch = await service.findNotes({ property: { name: "category", value: "design" } });
    expect(propSearch.notes.length).toBe(1);
    expect(propSearch.notes[0].path).toBe("note2.md");
  });

  it("should return recent changes sorted by modification date", async () => {
    await service.createNote("recent1.md", "First note");
    await new Promise((r) => setTimeout(r, 20));
    await service.createNote("recent2.md", "Second note");

    const recent = await service.recentChanges({ limit: 10 });
    expect(recent.recentChanges.length).toBe(2);
    expect(recent.recentChanges[0].path).toBe("recent2.md");
    expect(recent.recentChanges[1].path).toBe("recent1.md");
  });

  it("should enforce expectedRevision on moveNote", async () => {
    const notePath = "move-source.md";
    const destPath = "archive/move-dest.md";
    await service.createNote(notePath, "Initial content for move");

    const read = await service.readNote(notePath);
    const rev1 = read.revision;

    // Stale revision must throw CONFLICT
    await expect(
      service.moveNote(notePath, destPath, "stale-rev-12345")
    ).rejects.toThrowError(ObsidianMcpError);

    // Matching revision succeeds
    const moveRes = await service.moveNote(notePath, destPath, rev1);
    expect(moveRes.moved).toBe(true);
    const movedNote = await service.readNote(destPath);
    expect(movedNote.content).toContain("Initial content for move");
    await expect(service.readNote(notePath)).rejects.toThrowError(ObsidianMcpError);
  });

  it("should enforce expectedRevision on appendDailyNote and prependDailyNote", async () => {
    // 1. Initial appendDailyNote (creates if not existing)
    const daily1 = await service.appendDailyNote("- [ ] Morning task");
    expect(daily1.created || daily1.appended).toBe(true);
    const rev1 = daily1.newRevision;

    // Stale revision on appendDailyNote must throw CONFLICT
    await expect(
      service.appendDailyNote("- [ ] Afternoon task", undefined, "stale-revision")
    ).rejects.toThrowError(ObsidianMcpError);

    // Matching revision succeeds
    const daily2 = await service.appendDailyNote("- [ ] Afternoon task", undefined, rev1);
    expect(daily2.appended).toBe(true);
    const rev2 = daily2.newRevision;

    // Stale revision on prependDailyNote must throw CONFLICT
    await expect(
      service.prependDailyNote("## Today Plan\n", undefined, "stale-revision")
    ).rejects.toThrowError(ObsidianMcpError);

    // Matching revision on prependDailyNote succeeds
    const daily3 = await service.prependDailyNote("## Today Plan\n", undefined, rev2);
    expect(daily3.prepended).toBe(true);
  });

  it("should enforce expectedRevision and expectedText line-drift check on toggleTask", async () => {
    const notePath = "tasks-concurrency.md";
    await service.createNote(notePath, "# Tasks\n- [ ] Deploy server\n- [ ] Run migration");

    const read = await service.readNote(notePath);
    const rev1 = read.revision;

    // Line 2 is "- [ ] Deploy server"
    // 1. Stale revision must throw CONFLICT
    await expect(
      service.toggleTask(notePath, 2, "stale-revision")
    ).rejects.toThrowError(ObsidianMcpError);

    // 2. Line drift: expectedText mismatch must throw CONFLICT
    await expect(
      service.toggleTask(notePath, 2, rev1, "- [ ] Run migration")
    ).rejects.toThrowError(ObsidianMcpError);

    // 3. Matching revision and matching expectedText succeeds
    const toggleRes = await service.toggleTask(notePath, 2, rev1, "- [ ] Deploy server");
    expect(toggleRes.toggled).toBe(true);

    const updated = await service.readNote(notePath);
    expect(updated.content).toContain("- [x] Deploy server");
  });

  it("should respect include flags and maxRelatedNotes in getNoteContext", async () => {
    await service.createNote("04-Budget/Main.md", `---
title: Main Note
tags: [tag1, tag2]
---
# Main Heading
Content body line.
See [[04-Budget/Rel1]] and [[04-Budget/Rel2]].
`);
    await service.createNote("04-Budget/Rel1.md", "Content 1 referencing [[04-Budget/Main]]");
    await service.createNote("04-Budget/Rel2.md", "Content 2 referencing [[04-Budget/Main]]");

    // Context with selective includes
    const selectiveCtx = await service.getNoteContext("04-Budget/Main.md", {
      include: {
        body: false,
        backlinks: false,
        headings: false,
      },
      maxRelatedNotes: 1,
    });

    expect(selectiveCtx.body).toBeUndefined();
    expect(selectiveCtx.backlinks).toBeUndefined();
    expect(selectiveCtx.headings).toBeUndefined();
    expect(selectiveCtx.frontmatter.title).toBe("Main Note");
    expect(selectiveCtx.relatedNotes.length).toBeLessThanOrEqual(1);
  });
});
