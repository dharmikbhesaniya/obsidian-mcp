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

    // 5. createNote with overwrite=true and missing expectedRevision must throw PRECONDITION_REQUIRED (428)
    await expect(
      service.createNote(notePath, "Blind Overwrite", undefined, true)
    ).rejects.toThrowError(ObsidianMcpError);
    try {
      await service.createNote(notePath, "Blind Overwrite", undefined, true);
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.PRECONDITION_REQUIRED);
      expect(err.statusCode).toBe(428);
    }

    // createNote with overwrite=true and stale revision must throw CONFLICT (409)
    await expect(
      service.createNote(notePath, "Overwritten", undefined, true, rev4)
    ).rejects.toThrowError(ObsidianMcpError);

    // createNote with overwrite=true and matching revision succeeds
    const overwriteRes = await service.createNote(notePath, "Overwritten Valid", undefined, true, rev5);
    expect(overwriteRes.created).toBe(true);
    const rev6 = overwriteRes.revision;

    // 6. deleteNote with stale revision must throw CONFLICT
    await expect(service.deleteNote(notePath, false, rev5)).rejects.toThrowError(ObsidianMcpError);

    // deleteNote with valid revision succeeds
    const delRes = await service.deleteNote(notePath, false, rev6);
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
    expect(res.tasks?.length).toBe(2);
    expect(res.tasks?.[0].text).toBe("Task 1");
    expect(res.tasks?.[1].text).toBe("Task 3");
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
    expect(ctx.frontmatter?.title).toBe("Auth Architecture");
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
    expect(daily1.appended).toBe(true);
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
    expect(selectiveCtx.frontmatter?.title).toBe("Main Note");
    expect(selectiveCtx.relatedNotes?.length).toBeLessThanOrEqual(1);
  });

  it("should surgically patch note headings (replace, append, prepend)", async () => {
    const notePath = "patch-heading.md";
    await service.createNote(
      notePath,
      "# Overview\nIntro text.\n\n## Action Items\n- [ ] Task 1\n\n## Notes\nEnd notes."
    );

    // 1. Append to "Action Items"
    const appendRes = await service.patchNote(
      notePath,
      { type: "heading", value: "Action Items" },
      "append",
      "- [ ] Task 2"
    );
    expect(appendRes.patched).toBe(true);
    let read = await service.readNote(notePath);
    expect(read.content).toContain("- [ ] Task 1\n\n- [ ] Task 2");
    expect(read.content).toContain("## Notes");

    // 2. Prepend to "Action Items"
    await service.patchNote(
      notePath,
      { type: "heading", value: "## Action Items" },
      "prepend",
      "- [ ] Urgent Priority"
    );
    read = await service.readNote(notePath);
    expect(read.content).toContain("## Action Items\n\n- [ ] Urgent Priority\n\n- [ ] Task 1");

    // 3. Replace "Action Items" section
    await service.patchNote(
      notePath,
      { type: "heading", value: "Action Items" },
      "replace",
      "All tasks completed!"
    );
    read = await service.readNote(notePath);
    expect(read.content).toContain("## Action Items\n\nAll tasks completed!\n\n## Notes");
    expect(read.content).not.toContain("Task 1");

    // 4. Missing heading throws 404
    await expect(
      service.patchNote(notePath, { type: "heading", value: "Nonexistent" }, "append", "Text")
    ).rejects.toThrowError(ObsidianMcpError);
  });

  it("should surgically patch note blocks (replace, append, prepend)", async () => {
    const notePath = "patch-block.md";
    await service.createNote(
      notePath,
      "# Document\n\nThis is a key quote. ^quote-1\n\nSome trailing explanation."
    );

    // 1. Append after block
    await service.patchNote(
      notePath,
      { type: "block", value: "^quote-1" },
      "append",
      "Analysis of quote 1."
    );
    let read = await service.readNote(notePath);
    expect(read.content).toContain("This is a key quote. ^quote-1\nAnalysis of quote 1.");

    // 2. Prepend before block
    await service.patchNote(
      notePath,
      { type: "block", value: "quote-1" },
      "prepend",
      "Introduction to quote 1:"
    );
    read = await service.readNote(notePath);
    expect(read.content).toContain("Introduction to quote 1:\nThis is a key quote. ^quote-1");

    // 3. Replace block
    await service.patchNote(
      notePath,
      { type: "block", value: "quote-1" },
      "replace",
      "This is the updated quote."
    );
    read = await service.readNote(notePath);
    expect(read.content).toContain("This is the updated quote. ^quote-1");
  });

  it("should surgically patch notes via string search, regex, and direct search/replace", async () => {
    const notePath = "string-patch-test.md";
    await service.createNote(
      notePath,
      "# Target Note\n\nOriginal string here to replace.\nAnother line with [pattern-xyz].\n"
    );

    // 1. Direct search and replace
    const patch1 = await service.patchNote(
      notePath,
      undefined,
      "replace",
      undefined,
      undefined,
      undefined,
      "Original string here to replace.",
      "Replaced string successfully."
    );
    expect(patch1.patched).toBe(true);
    let read = await service.readNote(notePath);
    expect(read.content).toContain("Replaced string successfully.");

    // 2. String target with append
    await service.patchNote(
      notePath,
      { type: "string", value: "Replaced string successfully." },
      "append",
      "Appended line after string."
    );
    read = await service.readNote(notePath);
    expect(read.content).toContain("Replaced string successfully.\nAppended line after string.");

    // 3. Regex target with replace
    await service.patchNote(
      notePath,
      { type: "regex", value: "\\[pattern-[a-z]+\\]" },
      "replace",
      "[pattern-resolved]"
    );
    read = await service.readNote(notePath);
    expect(read.content).toContain("Another line with [pattern-resolved].");

    // 4. Missing search string throws 404
    await expect(
      service.patchNote(
        notePath,
        undefined,
        "replace",
        undefined,
        undefined,
        undefined,
        "Nonexistent string needle",
        "Replacement"
      )
    ).rejects.toThrowError(ObsidianMcpError);
  });

  it("should atomically move notes and rewrite inbound backlinks across the vault", async () => {
    await service.createNote("01-Projects/alpha.md", "# Alpha Project");
    await service.createNote(
      "02-Notes/ref1.md",
      "Referencing [[01-Projects/alpha]] and [[alpha|Alpha Shortcut]] and [[alpha#Overview]]."
    );
    await service.createNote("02-Notes/ref2.md", "Another reference to [[01-Projects/alpha]].");

    const moveRes = await service.moveNote(
      "01-Projects/alpha.md",
      "01-Projects/alpha-renamed.md",
      undefined,
      true
    );
    expect(moveRes.moved).toBe(true);
    expect(moveRes.backlinksUpdated).toBe(2);
    expect(moveRes.obsidianUri).toContain("alpha-renamed.md");

    // Verify references updated
    const ref1 = await service.readNote("02-Notes/ref1.md");
    expect(ref1.content).toContain("[[01-Projects/alpha-renamed]]");
    expect(ref1.content).toContain("[[alpha-renamed|Alpha Shortcut]]");
    expect(ref1.content).toContain("[[alpha-renamed#Overview]]");

    const ref2 = await service.readNote("02-Notes/ref2.md");
    expect(ref2.content).toContain("[[01-Projects/alpha-renamed]]");
  });

  it("should safely move deleted note to .obsidian-mcp/trash with metadata", async () => {
    const notePath = "to-delete.md";
    await service.createNote(notePath, "# Temporary Document");

    const delRes = await service.deleteNote(notePath, false);
    expect(delRes.deleted).toBe(true);
    expect(delRes.permanent).toBe(false);
    expect(delRes.trashPath).toContain(".obsidian-mcp/trash");

    // Note should no longer exist in vault
    await expect(service.readNote(notePath)).rejects.toThrowError(ObsidianMcpError);

    // Trash manager should list the trashed note
    const trashItems = service.getTrashManager().listTrash();
    expect(trashItems.some((item) => item.originalPath === "to-delete.md")).toBe(true);
  });

  it("should strip Obsidian comments %% %% and return obsidian desktop URI", async () => {
    const notePath = "comments.md";
    await service.createNote(
      notePath,
      "# Title\nPublic visible text. %% This is a secret developer note %% More public text.\n%% Multi-line\ncomment %%\nFinal text."
    );

    // 1. readNote without stripComments
    const rawRead = await service.readNote(notePath, false);
    expect(rawRead.content).toContain("secret developer note");
    expect(rawRead.etag).toBeDefined();
    expect(rawRead.obsidianUri).toContain("obsidian://open?vault=");

    // 2. readNote with stripComments
    const cleanRead = await service.readNote(notePath, true);
    expect(cleanRead.content).not.toContain("secret developer note");
    expect(cleanRead.content).not.toContain("Multi-line");
    expect(cleanRead.content).toContain("Public visible text.");
    expect(cleanRead.content).toContain("More public text.");
    expect(cleanRead.content).toContain("Final text.");

    // 3. getNoteContext with stripComments
    const cleanCtx = await service.getNoteContext(notePath, { stripComments: true });
    expect(cleanCtx.body).not.toContain("secret developer note");
    expect(cleanCtx.obsidianUri).toContain("obsidian://open?vault=");
  });

  it("should find the shortest wikilink path between two notes using BFS", async () => {
    // Chain: NoteA -> NoteB -> NoteC -> NoteD
    // Alternative shortcut: NoteA -> NoteD
    await service.createNote("Graph/NoteA.md", "Points to [[Graph/NoteB]] and other topics.");
    await service.createNote("Graph/NoteB.md", "Points to [[Graph/NoteC]].");
    await service.createNote("Graph/NoteC.md", "Points to [[Graph/NoteD]].");
    await service.createNote("Graph/NoteD.md", "Terminal node in knowledge graph.");
    await service.createNote("Graph/Isolated.md", "No incoming or outgoing links.");

    // 1. Multi-hop path from NoteA to NoteD
    const pathRes = await service.getLinkPath("Graph/NoteA.md", "Graph/NoteD.md");
    expect(pathRes.found).toBe(true);
    expect(pathRes.distance).toBe(3);
    expect(pathRes.path).toEqual([
      "Graph/NoteA.md",
      "Graph/NoteB.md",
      "Graph/NoteC.md",
      "Graph/NoteD.md",
    ]);

    // 2. Direct hop from NoteB to NoteC
    const directRes = await service.getLinkPath("Graph/NoteB.md", "Graph/NoteC.md");
    expect(directRes.found).toBe(true);
    expect(directRes.distance).toBe(1);
    expect(directRes.path).toEqual(["Graph/NoteB.md", "Graph/NoteC.md"]);

    // 3. Disconnected note
    const disconnected = await service.getLinkPath("Graph/NoteA.md", "Graph/Isolated.md");
    expect(disconnected.found).toBe(false);
    expect(disconnected.distance).toBe(-1);
    expect(disconnected.path).toHaveLength(0);

    // 4. Same note (distance 0)
    const sameNote = await service.getLinkPath("Graph/NoteA.md", "Graph/NoteA.md");
    expect(sameNote.found).toBe(true);
    expect(sameNote.distance).toBe(0);
    expect(sameNote.path).toEqual(["Graph/NoteA.md"]);

    // 5. Non-existent note throws 404
    await expect(
      service.getLinkPath("Graph/NoteA.md", "Graph/Missing.md")
    ).rejects.toThrowError(ObsidianMcpError);
  });
});
