import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { VaultService } from "../../src/services/vault.service.js";
import { ObsidianCliAdapter } from "../../src/adapters/obsidian/cli.adapter.js";
import { PathGuard } from "../../src/security/path-guard.js";

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
    it("should generate timestamp-prefixed unique notes", async () => {
      const unique = await service.createUniqueNote("Quantum Computing", "# Quantum\nQubits.");
      expect(unique.created).toBe(true);
      expect(unique.path).toMatch(/^\d{12} Quantum Computing\.md$/);

      const read = await service.readNote(unique.path);
      expect(read.content).toContain("# Quantum");
    });
  });

  describe("Desktop Integration (Open Note)", () => {
    it("should resolve obsidian URI for desktop open", async () => {
      await service.createNote("OpenMe.md", "Open me in desktop");
      const res = await service.openNote("OpenMe.md");
      expect(res.opened).toBe(true);
      expect(res.obsidianUri).toContain("obsidian://open?vault=");
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

      const snippetsDir = path.join(dotObsidian, "snippets");
      fs.mkdirSync(snippetsDir, { recursive: true });
      fs.writeFileSync(path.join(snippetsDir, "custom-cards.css"), "/* CSS */");

      fs.writeFileSync(
        path.join(dotObsidian, "appearance.json"),
        JSON.stringify({ enabledCssSnippets: ["custom-cards"] })
      );

      const plugins = await service.listPlugins();
      expect(plugins.communityPlugins).toEqual(["dataview", "omnisearch"]);

      const snippets = await service.listSnippets();
      expect(snippets.snippets).toEqual([{ name: "custom-cards", enabled: true }]);
    });
  });
});
