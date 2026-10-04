import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { VaultService } from "../../src/services/vault.service.js";
import { ObsidianCliAdapter } from "../../src/adapters/obsidian/cli.adapter.js";
import { PathGuard } from "../../src/security/path-guard.js";
import { ObsidianMcpError } from "../../src/schemas/errors.js";

describe("Obsidian Extended Capabilities", () => {
  let tempVaultDir: string;
  let service: VaultService;
  let cliAdapter: ObsidianCliAdapter;

  beforeEach(() => {
    tempVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-extended-test-"));
    const guard = new PathGuard(tempVaultDir);
    cliAdapter = new ObsidianCliAdapter("non-existent-binary", 1000);
    service = new VaultService(guard, cliAdapter);
  });

  afterEach(() => {
    if (fs.existsSync(tempVaultDir)) {
      fs.rmSync(tempVaultDir, { recursive: true, force: true });
    }
  });

  describe("Bookmarks", () => {
    it("should list bookmarks and create a new bookmark into .obsidian/bookmarks.json", async () => {
      // Create a target note
      await service.createNote("DeepWork.md", "# Deep Work\nFocus rules.");

      // Initial bookmarks list is empty
      const initial = await service.listBookmarks();
      expect(initial.bookmarks).toEqual([]);

      // Create a bookmark
      const created = await service.createBookmark("DeepWork.md", "#Deep Work", "Deep Work Notes");
      expect(created.bookmarked).toBe(true);
      expect(created.title).toBe("Deep Work Notes");

      // Verify listBookmarks now returns the saved bookmark
      const after = await service.listBookmarks();
      expect(after.bookmarks.length).toBe(1);
      expect(after.bookmarks[0].path).toBe("DeepWork.md");
      expect(after.bookmarks[0].title).toBe("Deep Work Notes");
    });

    it("should throw 404 when attempting to bookmark a non-existent file", async () => {
      await expect(service.createBookmark("GhostNote.md")).rejects.toThrowError(
        /File 'GhostNote\.md' not found to bookmark/
      );
    });

    it("should recover gracefully from malformed bookmarks.json", async () => {
      const dotObsidian = path.join(tempVaultDir, ".obsidian");
      fs.mkdirSync(dotObsidian, { recursive: true });
      fs.writeFileSync(path.join(dotObsidian, "bookmarks.json"), "{ invalid JSON content !!!");

      const res = await service.listBookmarks();
      expect(res.bookmarks).toEqual([]);
    });
  });

  describe("Outline", () => {
    it("should extract structured heading hierarchy with accurate line numbers", async () => {
      const noteContent = `# Main Title
Paragraph introduction.

## Section 1
Content 1.

### Subsection 1.1
Details.

## Section 2
Final thoughts.
`;
      await service.createNote("Document.md", noteContent);

      const outline = await service.getOutline("Document.md");
      expect(outline.totalHeadings).toBe(4);
      expect(outline.headings).toEqual([
        { level: 1, text: "Main Title", line: 1 },
        { level: 2, text: "Section 1", line: 4 },
        { level: 3, text: "Subsection 1.1", line: 7 },
        { level: 2, text: "Section 2", line: 10 },
      ]);
    });

    it("should throw 404 when extracting outline of non-existent note", async () => {
      await expect(service.getOutline("Missing.md")).rejects.toThrowError(ObsidianMcpError);
    });
  });

  describe("Aliases", () => {
    it("should inspect note aliases from frontmatter and vault-wide", async () => {
      await service.createNote(
        "ArtificialIntelligence.md",
        `---
aliases: [AI, Machine Learning]
---
# Artificial Intelligence
Body.
`
      );
      await service.createNote(
        "PersonalKnowledgeManagement.md",
        `---
alias: PKM
---
# PKM
Body.
`
      );

      // Single note aliases
      const noteAliases = await service.listAliases("ArtificialIntelligence.md");
      expect(noteAliases.aliases).toEqual(["AI", "Machine Learning"]);

      // Vault-wide alias resolution map
      const vaultAliases = await service.listAliases();
      expect(vaultAliases.totalAliases).toBe(3);
      expect(vaultAliases.aliases["AI"]).toBe("ArtificialIntelligence.md");
      expect(vaultAliases.aliases["Machine Learning"]).toBe("ArtificialIntelligence.md");
      expect(vaultAliases.aliases["PKM"]).toBe("PersonalKnowledgeManagement.md");
    });
  });

  describe("Templates", () => {
    it("should list templates and resolve {{title}}, {{date}}, and {{time}}", async () => {
      const templatesDir = path.join(tempVaultDir, "Templates");
      fs.mkdirSync(templatesDir, { recursive: true });

      const templateContent = `# {{title}}
Created: {{date}} at {{time}}

## Notes
`;
      fs.writeFileSync(path.join(templatesDir, "DailyMeeting.md"), templateContent);

      const list = await service.listTemplates();
      expect(list.templates).toContain("Templates/DailyMeeting.md");

      const read = await service.readTemplate("DailyMeeting", "Design Review", true);
      expect(read.content).toContain("# Design Review");
      expect(read.content).not.toContain("{{title}}");
      expect(read.content).not.toContain("{{date}}");
      expect(read.content).not.toContain("{{time}}");
    });

    it("should throw 404 when requested template does not exist", async () => {
      await expect(service.readTemplate("NonExistentTemplate")).rejects.toThrowError(
        /Template 'NonExistentTemplate' not found/
      );
    });

    it("should reject path traversal in template name", async () => {
      await expect(service.readTemplate("../../etc/passwd")).rejects.toThrowError();
    });
  });

  describe("Word Count & Metrics", () => {
    it("should accurately calculate words, characters, sentences, and reading time", async () => {
      const text = `# Project Plan
This is the first sentence. This is the second sentence!
Are there three sentences?

Yes, there are.
`;
      await service.createNote("Plan.md", text);

      const stats = await service.wordCount("Plan.md");
      expect(stats.words).toBeGreaterThan(10);
      expect(stats.sentences).toBeGreaterThanOrEqual(4);
      expect(stats.readingTimeMinutes).toBe(1);
    });
  });

  describe("Random Note", () => {
    it("should pick a random note from available files", async () => {
      await service.createNote("Note1.md", "Content 1");
      await service.createNote("Note2.md", "Content 2");

      const random = await service.randomNote();
      expect(["Note1.md", "Note2.md"]).toContain(random.path);
    });
  });

  describe("Unique / Zettelkasten Note", () => {
    it("should generate timestamp-prefixed unique notes with random entropy", async () => {
      const unique = await service.createUniqueNote("Quantum Computing", "# Quantum\nQubits.");
      expect(unique.created).toBe(true);
      expect(unique.path).toMatch(/^\d{14}-[a-f0-9]{4} Quantum Computing\.md$/);

      const read = await service.readNote(unique.path);
      expect(read.content).toContain("# Quantum");
    });

    it("should guarantee uniqueness even with identical titles created in immediate succession", async () => {
      const note1 = await service.createUniqueNote("CollisionTest", "Note 1");
      const note2 = await service.createUniqueNote("CollisionTest", "Note 2");

      expect(note1.path).not.toBe(note2.path);
      expect(fs.existsSync(path.join(tempVaultDir, note1.path))).toBe(true);
      expect(fs.existsSync(path.join(tempVaultDir, note2.path))).toBe(true);
    });
  });

  describe("Desktop Integration (Open Note)", () => {
    it("should report opened=false and return obsidianUri when CLI is not available", async () => {
      await service.createNote("OpenMe.md", "Open me in desktop");
      const res = await service.openNote("OpenMe.md");
      expect(res.opened).toBe(false);
      expect(res.obsidianUri).toContain("obsidian://open?vault=");
      expect(res.message).toContain("Obsidian CLI is not currently running or reachable");
    });

    it("should throw 404 when opening a non-existent note", async () => {
      await expect(service.openNote("DoesNotExist.md")).rejects.toThrowError(
        /Note 'DoesNotExist\.md' does not exist to open/
      );
    });
  });

  describe("Plugins & Snippets Inspection", () => {
    it("should read community plugins and CSS snippets config", async () => {
      const dotObsidian = path.join(tempVaultDir, ".obsidian");
      fs.mkdirSync(dotObsidian, { recursive: true });

      fs.writeFileSync(
        path.join(dotObsidian, "community-plugins.json"),
        JSON.stringify(["dataview", "omnisearch"])
      );
      fs.writeFileSync(
        path.join(dotObsidian, "core-plugins.json"),
        JSON.stringify({ bookmarks: true, canvas: true, sync: false })
      );

      const snippetsDir = path.join(dotObsidian, "snippets");
      fs.mkdirSync(snippetsDir, { recursive: true });
      fs.writeFileSync(path.join(snippetsDir, "custom-theme.css"), "body { color: red; }");

      fs.writeFileSync(
        path.join(dotObsidian, "appearance.json"),
        JSON.stringify({ enabledCssSnippets: ["custom-theme"] })
      );

      const plugins = await service.listPlugins();
      expect(plugins.communityPlugins).toEqual(["dataview", "omnisearch"]);
      expect(plugins.corePlugins).toEqual({ bookmarks: true, canvas: true, sync: false });
      expect(plugins.totalCommunity).toBe(2);

      const snippets = await service.listSnippets();
      expect(snippets.totalSnippets).toBe(1);
      expect(snippets.snippets[0]).toEqual({
        name: "custom-theme",
        enabled: true,
      });
    });

    it("should handle corrupted plugins JSON gracefully without throwing", async () => {
      const dotObsidian = path.join(tempVaultDir, ".obsidian");
      fs.mkdirSync(dotObsidian, { recursive: true });
      fs.writeFileSync(path.join(dotObsidian, "community-plugins.json"), "CORRUPT JSON");
      fs.writeFileSync(path.join(dotObsidian, "core-plugins.json"), "CORRUPT JSON");

      const plugins = await service.listPlugins();
      expect(plugins.communityPlugins).toEqual([]);
      expect(plugins.corePlugins).toEqual({});
      expect(plugins.totalCommunity).toBe(0);
    });
  });

  describe("CLI Command Allowlist", () => {
    it("should reject unapproved commands through executeCli", async () => {
      await expect(
        service.executeCli("malicious-rm", {})
      ).rejects.toThrowError(/not in the Obsidian CLI allowlist/);
    });
  });
});
