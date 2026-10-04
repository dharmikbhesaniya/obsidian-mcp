import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PathGuard } from "../security/path-guard.js";
import { AtomicFs } from "../security/atomic-fs.js";
import { TrashManager } from "../security/trash.js";
import { ObsidianCliAdapter } from "../adapters/obsidian/cli.adapter.js";
import { ErrorCode, ObsidianMcpError } from "../schemas/errors.js";
import { BM25Engine, DocumentItem } from "../search/bm25.js";
import {
  parseNoteContent,
  setFrontmatterProperty,
  removeFrontmatterProperty,
  extractHeadings,
  extractWikilinks,
} from "../utils/frontmatter.js";

export const ALLOWED_CLI_COMMANDS = new Set([
  "version",
  "search",
  "tasks",
  "backlinks",
  "orphans",
  "unresolved",
  "deadends",
  "tags",
  "tag",
  "properties",
  "bases",
  "outline",
  "daily:read",
]);

export function stripObsidianComments(content: string): string {
  return content.replace(/%%[\s\S]*?%%/g, "");
}

export class VaultService {
  private readonly pathGuard: PathGuard;
  private readonly cliAdapter: ObsidianCliAdapter;
  private readonly trashManager: TrashManager;

  constructor(pathGuard: PathGuard, cliAdapter: ObsidianCliAdapter, trashManager?: TrashManager) {
    this.pathGuard = pathGuard;
    this.cliAdapter = cliAdapter;
    this.trashManager = trashManager ?? new TrashManager(pathGuard.getVaultRoot());
  }

  public getTrashManager(): TrashManager {
    return this.trashManager;
  }

  public getObsidianUri(relativePath: string): string {
    const vaultName = path.basename(this.pathGuard.getVaultRoot());
    return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relativePath)}`;
  }

  // --- VAULT DOMAIN ---

  public async getVault() {
    const root = this.pathGuard.getVaultRoot();
    let totalFiles = 0;
    try {
      const walk = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name));
          } else {
            totalFiles++;
          }
        }
      };
      walk(root);
    } catch {
      // Fallback
    }

    const cliReachable = await this.cliAdapter.checkReachability();

    return {
      vaultId: path.basename(root),
      name: path.basename(root),
      status: cliReachable ? "connected" : "degraded",
      vaultAccessible: true,
      obsidianCli: cliReachable ? "connected" : "unavailable",
      totalFiles,
    };
  }

  public async listFiles(folder?: string, recursive: boolean = false) {
    const target = folder ? this.pathGuard.resolveSafePath(folder).absolutePath : this.pathGuard.getVaultRoot();
    if (!fs.existsSync(target)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Directory '${folder || ""}' not found`, 404);
    }

    const files: Array<{ path: string; type: "file" | "folder" }> = [];
    const root = this.pathGuard.getVaultRoot();

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(root, fullPath);
        if (entry.isDirectory()) {
          files.push({ path: relPath, type: "folder" });
          if (recursive) walk(fullPath);
        } else {
          files.push({ path: relPath, type: "file" });
        }
      }
    };

    walk(target);
    return { files };
  }

  public async getFileInfo(targetPath: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `File '${relativePath}' not found`, 404);
    }

    const stat = fs.statSync(absolutePath);
    return {
      path: relativePath,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      isFolder: stat.isDirectory(),
    };
  }

  // --- NOTES DOMAIN ---

  public async readNote(targetPath: string, stripComments: boolean = false) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const rawContent = fs.readFileSync(absolutePath, "utf-8");
    const revision = crypto.createHash("sha1").update(rawContent).digest("hex");
    const content = stripComments ? stripObsidianComments(rawContent) : rawContent;
    const parsed = parseNoteContent(content);

    return {
      path: relativePath,
      content,
      revision,
      etag: revision,
      frontmatter: parsed.frontmatter,
      obsidianUri: this.getObsidianUri(relativePath),
    };
  }

  public async createNote(
    targetPath: string,
    content: string = "",
    template?: string,
    overwrite: boolean = false,
    expectedRevision?: string
  ) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (fs.existsSync(absolutePath)) {
      if (!overwrite) {
        throw new ObsidianMcpError(
          ErrorCode.CONFLICT,
          `Note '${relativePath}' already exists. Specify overwrite=true to replace.`,
          409
        );
      }

      if (!expectedRevision) {
        throw new ObsidianMcpError(
          ErrorCode.PRECONDITION_REQUIRED,
          `Overwriting existing note '${relativePath}' requires expectedRevision or ifMatch precondition to prevent blind overwrites.`,
          428,
          { path: relativePath }
        );
      }

      const existingContent = fs.readFileSync(absolutePath, "utf-8");
      const currentRevision = crypto.createHash("sha1").update(existingContent).digest("hex");
      if (expectedRevision !== currentRevision) {
        throw new ObsidianMcpError(
          ErrorCode.CONFLICT,
          `Concurrent edit detected on createNote overwrite. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
          409,
          { expectedRevision, actualRevision: currentRevision }
        );
      }
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    // If template specified, CLI execution is required
    if (template) {
      const args = [`path=${relativePath}`, "silent", `template=${template}`];
      await this.cliAdapter.execute("create", args);
      if (content) {
        AtomicFs.writeFileSync(absolutePath, content, "utf-8");
      }
    } else {
      AtomicFs.writeFileSync(absolutePath, content, "utf-8");
    }

    const finalContent = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf-8") : content;
    const revision = crypto.createHash("sha1").update(finalContent).digest("hex");

    return {
      path: relativePath,
      created: true,
      revision,
      etag: revision,
      obsidianUri: this.getObsidianUri(relativePath),
    };
  }

  public async appendNote(targetPath: string, content: string, ensureNewline: boolean = true, expectedRevision?: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const existing = fs.readFileSync(absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(existing).digest("hex");

    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    const toAppend = ensureNewline && !existing.endsWith("\n") ? `\n${content}` : content;
    const newContent = existing + toAppend;
    AtomicFs.writeFileSync(absolutePath, newContent, "utf-8");
    const newRevision = crypto.createHash("sha1").update(newContent).digest("hex");

    return {
      path: relativePath,
      appended: true,
      newRevision,
      etag: newRevision,
      obsidianUri: this.getObsidianUri(relativePath),
    };
  }

  public async prependNote(targetPath: string, content: string, expectedRevision?: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const existing = fs.readFileSync(absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(existing).digest("hex");

    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    // Prepend below frontmatter if present
    let updated = "";
    const fmMatch = existing.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    if (fmMatch) {
      const fm = fmMatch[0];
      const rest = existing.slice(fm.length);
      updated = `${fm}${content}\n\n${rest}`;
    } else {
      updated = `${content}\n\n${existing}`;
    }

    AtomicFs.writeFileSync(absolutePath, updated, "utf-8");
    const newRevision = crypto.createHash("sha1").update(updated).digest("hex");
    return {
      path: relativePath,
      prepended: true,
      newRevision,
      etag: newRevision,
      obsidianUri: this.getObsidianUri(relativePath),
    };
  }

  public async updateNote(targetPath: string, content: string, expectedRevision?: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const currentContent = fs.readFileSync(absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(currentContent).digest("hex");

    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    AtomicFs.writeFileSync(absolutePath, content, "utf-8");
    const newRevision = crypto.createHash("sha1").update(content).digest("hex");

    return {
      path: relativePath,
      updated: true,
      newRevision,
      etag: newRevision,
      obsidianUri: this.getObsidianUri(relativePath),
    };
  }

  public async patchNote(
    targetPath: string,
    target: { type: "heading" | "block"; value: string },
    operation: "replace" | "append" | "prepend",
    content: string,
    expectedRevision?: string
  ) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const existingContent = fs.readFileSync(absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(existingContent).digest("hex");

    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected on patch. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    const lines = existingContent.split("\n");
    let updatedLines: string[] = [];

    if (target.type === "heading") {
      const cleanTargetHeading = target.value.replace(/^#+\s*/, "").trim().toLowerCase();
      // Locate the heading line
      let headingIndex = -1;
      let headingLevel = 0;
      let matchedHeadingText = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          const level = match[1].length;
          const text = match[2].trim();
          if (text.toLowerCase() === cleanTargetHeading) {
            headingIndex = i;
            headingLevel = level;
            matchedHeadingText = line;
            break;
          }
        }
      }

      if (headingIndex === -1) {
        throw new ObsidianMcpError(
          ErrorCode.NOT_FOUND,
          `Heading '${target.value}' not found in note '${relativePath}'.`,
          404
        );
      }

      // Find section end: next heading of equal or higher level (<= headingLevel) or EOF
      let sectionEndIndex = lines.length;
      for (let i = headingIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match && match[1].length <= headingLevel) {
          sectionEndIndex = i;
          break;
        }
      }

      const beforeSection = lines.slice(0, headingIndex);
      const afterSection = lines.slice(sectionEndIndex);
      const sectionLines = lines.slice(headingIndex + 1, sectionEndIndex);

      if (operation === "replace") {
        if (/^#{1,6}\s+/.test(content.trim())) {
          updatedLines = [...beforeSection, content.trim(), ...(afterSection.length > 0 ? [""] : []), ...afterSection];
        } else {
          updatedLines = [...beforeSection, matchedHeadingText, "", content.trim(), ...(afterSection.length > 0 ? [""] : []), ...afterSection];
        }
      } else if (operation === "append") {
        let lastNonEmpty = sectionLines.length - 1;
        while (lastNonEmpty >= 0 && sectionLines[lastNonEmpty].trim() === "") {
          lastNonEmpty--;
        }
        const trimmedSection = sectionLines.slice(0, lastNonEmpty + 1);
        updatedLines = [
          ...beforeSection,
          matchedHeadingText,
          ...trimmedSection,
          "",
          content.trim(),
          "",
          ...afterSection,
        ];
      } else if (operation === "prepend") {
        updatedLines = [
          ...beforeSection,
          matchedHeadingText,
          "",
          content.trim(),
          "",
          ...sectionLines,
          ...afterSection,
        ];
      }
    } else if (target.type === "block") {
      const cleanBlockId = target.value.replace(/^\^/, "").trim();
      const blockPattern = new RegExp(`\\^${cleanBlockId}(\\s|$)`);
      let blockIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (blockPattern.test(lines[i])) {
          blockIndex = i;
          break;
        }
      }

      if (blockIndex === -1) {
        throw new ObsidianMcpError(
          ErrorCode.NOT_FOUND,
          `Block ID '^${cleanBlockId}' not found in note '${relativePath}'.`,
          404
        );
      }

      const beforeBlock = lines.slice(0, blockIndex);
      const targetLine = lines[blockIndex];
      const afterBlock = lines.slice(blockIndex + 1);

      if (operation === "replace") {
        let newBlock = content.trim();
        if (!newBlock.includes(`^${cleanBlockId}`)) {
          newBlock = `${newBlock} ^${cleanBlockId}`;
        }
        updatedLines = [...beforeBlock, newBlock, ...afterBlock];
      } else if (operation === "append") {
        updatedLines = [...beforeBlock, targetLine, content.trim(), ...afterBlock];
      } else if (operation === "prepend") {
        updatedLines = [...beforeBlock, content.trim(), targetLine, ...afterBlock];
      }
    }

    const normalizedContent = updatedLines.join("\n").replace(/\n{3,}/g, "\n\n");
    AtomicFs.writeFileSync(absolutePath, normalizedContent, "utf-8");
    const newRevision = crypto.createHash("sha1").update(normalizedContent).digest("hex");

    return {
      path: relativePath,
      patched: true,
      target,
      operation,
      newRevision,
      etag: newRevision,
      obsidianUri: this.getObsidianUri(relativePath),
    };
  }

  public async moveNote(
    sourcePath: string,
    targetPath: string,
    expectedRevision?: string,
    updateBacklinks: boolean = true
  ) {
    const src = this.pathGuard.resolveSafePath(sourcePath);
    const dest = this.pathGuard.resolveSafePath(targetPath);

    if (!fs.existsSync(src.absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Source note '${src.relativePath}' does not exist`, 404);
    }
    if (fs.existsSync(dest.absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.CONFLICT, `Target note '${dest.relativePath}' already exists`, 409);
    }

    const currentContent = fs.readFileSync(src.absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(currentContent).digest("hex");
    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected on move. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    const root = this.pathGuard.getVaultRoot();
    const oldPathNoExt = src.relativePath.replace(/\.md$/, "");
    const newPathNoExt = dest.relativePath.replace(/\.md$/, "");
    const oldBaseName = path.basename(src.relativePath, ".md");
    const newBaseName = path.basename(dest.relativePath, ".md");

    const rollbackJournal: Array<{ absolutePath: string; originalContent: string }> = [];
    const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const wikilinkRegex = new RegExp(
      `\\[\\[(${escapeRegex(src.relativePath)}|${escapeRegex(oldPathNoExt)}|${escapeRegex(oldBaseName)})(#[^\\]\\|]+)?(\\|[^\\]]+)?\\]\\]`,
      "g"
    );

    if (updateBacklinks) {
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(full);
          } else if (entry.name.endsWith(".md") && full !== src.absolutePath) {
            const noteText = fs.readFileSync(full, "utf-8");
            if (wikilinkRegex.test(noteText)) {
              wikilinkRegex.lastIndex = 0;
              const updatedText = noteText.replace(wikilinkRegex, (_match, matchedTarget, heading, alias) => {
                const h = heading || "";
                const a = alias || "";
                const replacement = matchedTarget === oldBaseName ? newBaseName : newPathNoExt;
                return `[[${replacement}${h}${a}]]`;
              });
              rollbackJournal.push({ absolutePath: full, originalContent: noteText });
              AtomicFs.writeFileSync(full, updatedText, "utf-8");
            }
          }
        }
      };

      try {
        scanDir(root);
      } catch (err) {
        for (const item of rollbackJournal) {
          try {
            AtomicFs.writeFileSync(item.absolutePath, item.originalContent, "utf-8");
          } catch {
            // ignore rollback error
          }
        }
        throw err;
      }
    }

    try {
      fs.mkdirSync(path.dirname(dest.absolutePath), { recursive: true });
      fs.renameSync(src.absolutePath, dest.absolutePath);
    } catch (err) {
      if (updateBacklinks) {
        for (const item of rollbackJournal) {
          try {
            AtomicFs.writeFileSync(item.absolutePath, item.originalContent, "utf-8");
          } catch {
            // ignore
          }
        }
      }
      throw err;
    }

    return {
      sourcePath: src.relativePath,
      targetPath: dest.relativePath,
      moved: true,
      backlinksUpdated: rollbackJournal.length,
      revision: currentRevision,
      etag: currentRevision,
      obsidianUri: this.getObsidianUri(dest.relativePath),
    };
  }

  public async deleteNote(targetPath: string, permanent: boolean = false, expectedRevision?: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const existing = fs.readFileSync(absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(existing).digest("hex");
    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected on delete. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    if (permanent) {
      AtomicFs.unlinkSync(absolutePath);
      return { path: relativePath, deleted: true, permanent: true };
    } else {
      const res = this.trashManager.moveToTrash(absolutePath, relativePath, currentRevision);
      return {
        path: relativePath,
        deleted: true,
        permanent: false,
        trashPath: res.trashPath,
        trashedAt: res.trashedAt,
      };
    }
  }

  // --- SEARCH DOMAIN ---

  public async search(query: string, limit: number = 50) {
    try {
      const res = await this.cliAdapter.execute("search", [`query=${query}`, "format=json", "matches"]);
      let parsed = JSON.parse(res.stdout);
      if (Array.isArray(parsed)) {
        return { matches: parsed.slice(0, limit) };
      }
    } catch {
      // In-process BM25 lexical ranking fallback
    }

    const root = this.pathGuard.getVaultRoot();
    const docs: DocumentItem[] = [];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          const content = fs.readFileSync(full, "utf-8");
          const rel = path.relative(root, full);
          docs.push({
            id: rel,
            title: path.basename(rel, ".md"),
            content,
          });
        }
      }
    };

    walk(root);
    const engine = new BM25Engine(docs);
    const matches = engine.search(query, limit);

    return { matches };
  }

  public async searchContext(query: string, contextLines: number = 2, limit: number = 30) {
    const root = this.pathGuard.getVaultRoot();
    const results: Array<{ path: string; snippet: string }> = [];

    const walk = (dir: string) => {
      if (results.length >= limit) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          const content = fs.readFileSync(full, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              const start = Math.max(0, i - contextLines);
              const end = Math.min(lines.length, i + contextLines + 1);
              const snippet = lines.slice(start, end).join("\n");
              results.push({ path: path.relative(root, full), snippet });
              break;
            }
          }
        }
      }
    };

    walk(root);
    return { matches: results.slice(0, limit) };
  }

  // --- DAILY NOTES DOMAIN ---

  public async readDailyNote(date?: string) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    try {
      const res = await this.cliAdapter.execute("daily:read", date ? [`date=${date}`] : []);
      return { content: res.stdout, date: targetDate };
    } catch {
      // Check standard daily note paths (e.g. YYYY-MM-DD.md)
      const potential = [
        `${targetDate}.md`,
        `Daily/${targetDate}.md`,
        `01-Daily/${targetDate}.md`,
      ];
      for (const p of potential) {
        const full = path.join(this.pathGuard.getVaultRoot(), p);
        if (fs.existsSync(full)) {
          return {
            path: p,
            content: fs.readFileSync(full, "utf-8"),
            date: targetDate,
          };
        }
      }
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Daily note for '${targetDate}' not found`, 404);
    }
  }

  public async appendDailyNote(content: string, date?: string, expectedRevision?: string) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const p = `${targetDate}.md`;
    const full = path.join(this.pathGuard.getVaultRoot(), p);

    if (fs.existsSync(full)) {
      const existing = fs.readFileSync(full, "utf-8");
      const currentRevision = crypto.createHash("sha1").update(existing).digest("hex");
      if (expectedRevision && expectedRevision !== currentRevision) {
        throw new ObsidianMcpError(
          ErrorCode.CONFLICT,
          `Concurrent edit detected on daily note. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
          409,
          { expectedRevision, actualRevision: currentRevision }
        );
      }
    } else if (expectedRevision) {
      throw new ObsidianMcpError(
        ErrorCode.NOT_FOUND,
        `Daily note for '${targetDate}' does not exist, but expectedRevision was supplied.`,
        404
      );
    }

    try {
      const args = [`content=${content}`];
      if (date) args.push(`date=${date}`);
      await this.cliAdapter.execute("daily:append", args);
      const postContent = fs.existsSync(full) ? fs.readFileSync(full, "utf-8") : content;
      const newRevision = crypto.createHash("sha1").update(postContent).digest("hex");
      return { appended: true, date: targetDate, newRevision };
    } catch {
      if (!fs.existsSync(full)) {
        fs.writeFileSync(full, `# ${targetDate}\n\n`, "utf-8");
      }
      fs.appendFileSync(full, `\n${content}`, "utf-8");
      const postContent = fs.readFileSync(full, "utf-8");
      const newRevision = crypto.createHash("sha1").update(postContent).digest("hex");
      return { appended: true, date: targetDate, newRevision };
    }
  }

  public async prependDailyNote(content: string, date?: string, expectedRevision?: string) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const p = `${targetDate}.md`;
    const full = path.join(this.pathGuard.getVaultRoot(), p);

    if (fs.existsSync(full)) {
      const existing = fs.readFileSync(full, "utf-8");
      const currentRevision = crypto.createHash("sha1").update(existing).digest("hex");
      if (expectedRevision && expectedRevision !== currentRevision) {
        throw new ObsidianMcpError(
          ErrorCode.CONFLICT,
          `Concurrent edit detected on daily note. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
          409,
          { expectedRevision, actualRevision: currentRevision }
        );
      }
      fs.writeFileSync(full, `${content}\n\n${existing}`, "utf-8");
    } else {
      if (expectedRevision) {
        throw new ObsidianMcpError(
          ErrorCode.NOT_FOUND,
          `Daily note for '${targetDate}' does not exist, but expectedRevision was supplied.`,
          404
        );
      }
      fs.writeFileSync(full, `# ${targetDate}\n\n${content}\n`, "utf-8");
    }

    const newContent = fs.readFileSync(full, "utf-8");
    const newRevision = crypto.createHash("sha1").update(newContent).digest("hex");
    return { prepended: true, date: targetDate, newRevision };
  }

  // --- TASKS DOMAIN ---

  public async listTasks(notePath?: string, status: string = "all") {
    try {
      // Enforce tasks all to prevent active file scope trap
      const args = ["all"];
      if (status !== "all") args.push(status);
      if (notePath) args.push(`file=${notePath}`);
      const res = await this.cliAdapter.execute("tasks", args);
      return { raw: res.stdout };
    } catch {
      // In-process scan for markdown task checkboxes
      const tasks: Array<{ path: string; line: number; text: string; status: string }> = [];
      const root = this.pathGuard.getVaultRoot();

      const scanFile = (rel: string, abs: string) => {
        const lines = fs.readFileSync(abs, "utf-8").split("\n");
        lines.forEach((l, idx) => {
          const match = l.match(/^(\s*[-*]\s*\[([ xX])\]\s*)(.+)/);
          if (match) {
            const isDone = match[2].toLowerCase() === "x";
            const taskStatus = isDone ? "done" : "todo";
            if (status === "all" || status === taskStatus) {
              tasks.push({
                path: rel,
                line: idx + 1,
                text: match[3],
                status: taskStatus,
              });
            }
          }
        });
      };

      if (notePath) {
        const safe = this.pathGuard.resolveSafePath(notePath);
        if (fs.existsSync(safe.absolutePath)) scanFile(safe.relativePath, safe.absolutePath);
      } else {
        const walk = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith(".")) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith(".md")) scanFile(path.relative(root, full), full);
          }
        };
        walk(root);
      }

      return { tasks };
    }
  }

  public async toggleTask(targetPath: string, lineNum: number, expectedRevision?: string, expectedText?: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const rawContent = fs.readFileSync(absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(rawContent).digest("hex");
    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected on task toggle. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    const lines = rawContent.split("\n");
    if (lineNum < 1 || lineNum > lines.length) {
      throw new ObsidianMcpError(ErrorCode.VALIDATION_ERROR, `Line ${lineNum} out of range in '${relativePath}'`, 400);
    }

    const targetLine = lines[lineNum - 1];
    if (expectedText && !targetLine.includes(expectedText)) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Task line content verification failed: line ${lineNum} does not contain expected text '${expectedText}'. Note lines may have shifted.`,
        409,
        { actualLine: targetLine, expectedText }
      );
    }

    if (targetLine.includes("- [ ]")) {
      lines[lineNum - 1] = targetLine.replace("- [ ]", "- [x]");
    } else if (targetLine.includes("- [x]") || targetLine.includes("- [X]")) {
      lines[lineNum - 1] = targetLine.replace(/- \[[xX]\]/, "- [ ]");
    }

    const updatedContent = lines.join("\n");
    fs.writeFileSync(absolutePath, updatedContent, "utf-8");
    const newRevision = crypto.createHash("sha1").update(updatedContent).digest("hex");

    return { path: relativePath, line: lineNum, toggled: true, newRevision };
  }

  // --- PROPERTIES DOMAIN ---

  public async getProperties(targetPath: string) {
    const note = await this.readNote(targetPath);
    return { path: note.path, properties: note.frontmatter };
  }

  public async getProperty(targetPath: string, name: string) {
    const note = await this.readNote(targetPath);
    const value = note.frontmatter[name];
    if (value === undefined) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Property '${name}' not found on note '${note.path}'`, 404);
    }
    return { path: note.path, name, value };
  }

  public async removeProperty(targetPath: string, name: string, expectedRevision?: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const content = fs.readFileSync(absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(content).digest("hex");
    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    const updated = removeFrontmatterProperty(content, name);
    fs.writeFileSync(absolutePath, updated, "utf-8");
    const newRevision = crypto.createHash("sha1").update(updated).digest("hex");
    return { path: relativePath, name, removed: true, newRevision };
  }

  public async setProperty(targetPath: string, name: string, value: any, expectedRevision?: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const content = fs.readFileSync(absolutePath, "utf-8");
    const currentRevision = crypto.createHash("sha1").update(content).digest("hex");
    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Concurrent edit detected. Expected revision '${expectedRevision}' but note is at '${currentRevision}'.`,
        409,
        { expectedRevision, actualRevision: currentRevision }
      );
    }

    const updated = setFrontmatterProperty(content, name, value);
    fs.writeFileSync(absolutePath, updated, "utf-8");
    const newRevision = crypto.createHash("sha1").update(updated).digest("hex");
    return { path: relativePath, name, value, updated: true, newRevision };
  }

  // --- LINKS & GRAPH DOMAIN ---

  public async getBacklinks(targetPath: string) {
    try {
      const res = await this.cliAdapter.execute("backlinks", [`path=${targetPath}`]);
      return { path: targetPath, backlinks: res.stdout.split("\n").filter(Boolean) };
    } catch {
      return { path: targetPath, backlinks: [] };
    }
  }

  public async getLinks(targetPath: string) {
    const note = await this.readNote(targetPath);
    const matches = note.content.matchAll(/\[\[(.*?)\]\]/g);
    const links: string[] = [];
    for (const match of matches) {
      const target = match[1].split("|")[0].split("#")[0].trim();
      if (target && !links.includes(target)) {
        links.push(target);
      }
    }
    return { path: note.path, links };
  }

  public async getLinkPath(fromPath: string, toPath: string, maxDepth: number = 6) {
    const fromSafe = this.pathGuard.resolveSafePath(fromPath);
    const toSafe = this.pathGuard.resolveSafePath(toPath);

    if (!fs.existsSync(fromSafe.absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Starting note '${fromSafe.relativePath}' does not exist`, 404);
    }
    if (!fs.existsSync(toSafe.absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Destination note '${toSafe.relativePath}' does not exist`, 404);
    }

    if (fromSafe.relativePath === toSafe.relativePath) {
      return {
        from: fromSafe.relativePath,
        to: toSafe.relativePath,
        found: true,
        distance: 0,
        path: [fromSafe.relativePath],
      };
    }

    const root = this.pathGuard.getVaultRoot();
    const noteLookup = new Map<string, string>();
    const noteContentCache = new Map<string, string>();

    const scanAllNotes = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanAllNotes(full);
        } else if (entry.name.endsWith(".md")) {
          const rel = path.relative(root, full);
          const base = path.basename(rel, ".md");
          const noExt = rel.replace(/\.md$/, "");

          noteLookup.set(rel.toLowerCase(), rel);
          noteLookup.set(noExt.toLowerCase(), rel);
          if (!noteLookup.has(base.toLowerCase())) {
            noteLookup.set(base.toLowerCase(), rel);
          }
        }
      }
    };
    scanAllNotes(root);

    const targetKey = toSafe.relativePath.toLowerCase();

    // BFS Queue
    const queue: Array<{ current: string; trail: string[] }> = [
      { current: fromSafe.relativePath, trail: [fromSafe.relativePath] },
    ];
    const visited = new Set<string>([fromSafe.relativePath.toLowerCase()]);

    while (queue.length > 0) {
      const { current, trail } = queue.shift()!;

      if (trail.length - 1 >= maxDepth) {
        continue;
      }

      const currentAbs = path.join(root, current);
      let content = noteContentCache.get(current);
      if (content === undefined && fs.existsSync(currentAbs)) {
        content = fs.readFileSync(currentAbs, "utf-8");
        noteContentCache.set(current, content);
      }

      if (!content) continue;

      const wikilinks = extractWikilinks(content);
      for (const rawLink of wikilinks) {
        const cleanLink = rawLink.split("|")[0].split("#")[0].trim().toLowerCase();
        const resolvedTarget = noteLookup.get(cleanLink) || noteLookup.get(`${cleanLink}.md`);

        if (resolvedTarget) {
          const resolvedKey = resolvedTarget.toLowerCase();
          if (resolvedKey === targetKey) {
            return {
              from: fromSafe.relativePath,
              to: toSafe.relativePath,
              found: true,
              distance: trail.length,
              path: [...trail, resolvedTarget],
            };
          }

          if (!visited.has(resolvedKey)) {
            visited.add(resolvedKey);
            queue.push({
              current: resolvedTarget,
              trail: [...trail, resolvedTarget],
            });
          }
        }
      }
    }

    return {
      from: fromSafe.relativePath,
      to: toSafe.relativePath,
      found: false,
      distance: -1,
      path: [],
    };
  }

  public async getOrphans() {
    try {
      const res = await this.cliAdapter.execute("orphans");
      return { orphans: res.stdout.split("\n").filter(Boolean) };
    } catch {
      return { orphans: [] };
    }
  }

  public async getUnresolvedLinks() {
    try {
      const res = await this.cliAdapter.execute("unresolved");
      return { unresolved: res.stdout.split("\n").filter(Boolean) };
    } catch {
      return { unresolved: [] };
    }
  }

  public async getDeadends() {
    try {
      const res = await this.cliAdapter.execute("deadends");
      return { deadends: res.stdout.split("\n").filter(Boolean) };
    } catch {
      return { deadends: [] };
    }
  }

  public async getTags() {
    try {
      // Enforce tags all counts scope trap workaround
      const res = await this.cliAdapter.execute("tags", ["all", "counts"]);
      return { raw: res.stdout };
    } catch {
      return { tags: {} };
    }
  }

  public async getTagNotes(tag: string) {
    const cleanTag = tag.startsWith("#") ? tag.slice(1) : tag;
    try {
      const res = await this.cliAdapter.execute("tag", [`tag=${cleanTag}`]);
      return { tag: cleanTag, notes: res.stdout.split("\n").filter(Boolean) };
    } catch {
      const root = this.pathGuard.getVaultRoot();
      const notes: string[] = [];
      const walk = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.name.endsWith(".md")) {
            const content = fs.readFileSync(full, "utf-8");
            const parsed = parseNoteContent(content);
            const noteTags = Array.isArray(parsed.frontmatter.tags)
              ? parsed.frontmatter.tags
              : typeof parsed.frontmatter.tags === "string"
              ? [parsed.frontmatter.tags]
              : [];
            const hasTag =
              noteTags.some((t: any) => String(t).toLowerCase() === cleanTag.toLowerCase()) ||
              content.includes(`#${cleanTag}`);

            if (hasTag) {
              notes.push(path.relative(root, full));
            }
          }
        }
      };
      walk(root);
      return { tag: cleanTag, notes };
    }
  }

  public async listBases() {
    const root = this.pathGuard.getVaultRoot();
    const bases: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".base")) bases.push(path.relative(root, full));
      }
    };
    walk(root);
    return { bases };
  }

  public async queryBase(targetPath: string, view?: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Base file '${relativePath}' not found`, 404);
    }

    try {
      const args = [`path=${relativePath}`];
      if (view) args.push(`view=${view}`);
      const res = await this.cliAdapter.execute("base:query", args);
      return { path: relativePath, data: res.stdout };
    } catch {
      const raw = fs.readFileSync(absolutePath, "utf-8");
      try {
        const parsed = JSON.parse(raw);
        return { path: relativePath, schema: parsed };
      } catch {
        return { path: relativePath, raw };
      }
    }
  }

  // --- ADVANCED ESCAPE HATCH ---

  public async executeCli(command: string, args: Record<string, string>) {
    if (!ALLOWED_CLI_COMMANDS.has(command)) {
      throw new ObsidianMcpError(
        ErrorCode.FORBIDDEN,
        `Command '${command}' is not in the Obsidian CLI allowlist. Permitted commands: ${Array.from(ALLOWED_CLI_COMMANDS).join(", ")}`,
        403,
        { command, allowedCommands: Array.from(ALLOWED_CLI_COMMANDS) }
      );
    }

    const argList = Object.entries(args).map(([k, v]) => `${k}=${v}`);
    const res = await this.cliAdapter.execute(command, argList);
    return {
      stdout: res.stdout,
      exitCode: res.exitCode,
    };
  }

  public async getNoteContext(
    targetPath: string,
    options?: {
      stripComments?: boolean;
      include?: {
        body?: boolean;
        frontmatter?: boolean;
        headings?: boolean;
        backlinks?: boolean;
        outgoingLinks?: boolean;
        relatedNotes?: boolean;
      };
      maxRelatedNotes?: number;
    }
  ) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const rawContent = fs.readFileSync(absolutePath, "utf-8");
    const revision = crypto.createHash("sha1").update(rawContent).digest("hex");
    const content = options?.stripComments ? stripObsidianComments(rawContent) : rawContent;
    const parsed = parseNoteContent(content);

    const inc = {
      body: options?.include?.body ?? true,
      frontmatter: options?.include?.frontmatter ?? true,
      headings: options?.include?.headings ?? true,
      backlinks: options?.include?.backlinks ?? true,
      outgoingLinks: options?.include?.outgoingLinks ?? true,
      relatedNotes: options?.include?.relatedNotes ?? true,
    };
    const maxRelated = options?.maxRelatedNotes ?? 10;

    const headings = inc.headings ? extractHeadings(content) : [];
    const outgoingLinks = inc.outgoingLinks ? extractWikilinks(content) : [];

    // Backlinks
    let backlinks: string[] = [];
    if (inc.backlinks) {
      try {
        const res = await this.cliAdapter.execute("backlinks", [`path=${relativePath}`]);
        backlinks = res.stdout.split("\n").filter(Boolean);
      } catch {
        // In-process backlinks scan
        const root = this.pathGuard.getVaultRoot();
        const noteBaseName = path.basename(relativePath, ".md");
        const notePathNoExt = relativePath.replace(/\.md$/, "");
        const walk = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".md") && full !== absolutePath) {
              const txt = fs.readFileSync(full, "utf-8");
              if (
                txt.includes(`[[${noteBaseName}]]`) ||
                txt.includes(`[[${relativePath}]]`) ||
                txt.includes(`[[${notePathNoExt}]]`)
              ) {
                backlinks.push(path.relative(root, full));
              }
            }
          }
        };
        walk(root);
      }
    }

    // Related notes sharing identical tags
    const relatedNotes: string[] = [];
    if (inc.relatedNotes) {
      const noteTags: string[] = Array.isArray(parsed.frontmatter.tags)
        ? parsed.frontmatter.tags
        : typeof parsed.frontmatter.tags === "string"
        ? [parsed.frontmatter.tags]
        : [];

      if (noteTags.length > 0) {
        for (const tag of noteTags) {
          try {
            const tagRes = await this.getTagNotes(tag);
            for (const n of tagRes.notes) {
              if (n !== relativePath && !relatedNotes.includes(n)) {
                relatedNotes.push(n);
                if (relatedNotes.length >= maxRelated) break;
              }
            }
          } catch {
            // Ignore tag scan errors
          }
          if (relatedNotes.length >= maxRelated) break;
        }
      }
    }

    return {
      path: relativePath,
      revision,
      etag: revision,
      obsidianUri: this.getObsidianUri(relativePath),
      frontmatter: inc.frontmatter ? parsed.frontmatter : undefined,
      headings: inc.headings ? headings : undefined,
      outgoingLinks: inc.outgoingLinks ? outgoingLinks : undefined,
      backlinks: inc.backlinks ? backlinks : undefined,
      relatedNotes: inc.relatedNotes ? relatedNotes : undefined,
      body: inc.body ? parsed.body.trim() : undefined,
    };
  }

  public async findNotes(filter: {
    query?: string;
    tag?: string;
    folder?: string;
    property?: { name: string; value?: any };
    limit?: number;
  }) {
    const limit = filter.limit ?? 20;
    const root = this.pathGuard.getVaultRoot();
    const targetDir = filter.folder ? this.pathGuard.resolveSafePath(filter.folder).absolutePath : root;

    if (!fs.existsSync(targetDir)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Folder '${filter.folder}' not found`, 404);
    }

    const results: Array<{ path: string; title: string; tags: string[]; mtime: string; size: number }> = [];

    const walk = (dir: string) => {
      if (results.length >= limit) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          const rel = path.relative(root, full);
          const raw = fs.readFileSync(full, "utf-8");
          const parsed = parseNoteContent(raw);

          // Query filter
          if (filter.query) {
            const q = filter.query.toLowerCase();
            const matchesTitle = path.basename(rel, ".md").toLowerCase().includes(q);
            const matchesBody = raw.toLowerCase().includes(q);
            if (!matchesTitle && !matchesBody) continue;
          }

          // Tag filter
          const noteTags: string[] = Array.isArray(parsed.frontmatter.tags)
            ? parsed.frontmatter.tags
            : typeof parsed.frontmatter.tags === "string"
            ? [parsed.frontmatter.tags]
            : [];

          if (filter.tag) {
            const cleanTag = filter.tag.replace(/^#/, "");
            const hasTag = noteTags.some((t) => t.toLowerCase() === cleanTag.toLowerCase()) || raw.includes(`#${cleanTag}`);
            if (!hasTag) continue;
          }

          // Property filter
          if (filter.property) {
            const val = parsed.frontmatter[filter.property.name];
            if (val === undefined) continue;
            if (filter.property.value !== undefined && val !== filter.property.value) continue;
          }

          const stat = fs.statSync(full);
          const title = typeof parsed.frontmatter.title === "string" ? parsed.frontmatter.title : path.basename(rel, ".md");

          results.push({
            path: rel,
            title,
            tags: noteTags,
            mtime: stat.mtime.toISOString(),
            size: stat.size,
          });
        }
      }
    };

    walk(targetDir);
    return { notes: results.slice(0, limit), total: results.length };
  }

  public async recentChanges(filter: {
    limit?: number;
    folder?: string;
    sinceDays?: number;
  }) {
    const limit = filter.limit ?? 20;
    const root = this.pathGuard.getVaultRoot();
    const targetDir = filter.folder ? this.pathGuard.resolveSafePath(filter.folder).absolutePath : root;

    if (!fs.existsSync(targetDir)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Folder '${filter.folder}' not found`, 404);
    }

    const cutoffTime = filter.sinceDays ? Date.now() - filter.sinceDays * 24 * 60 * 60 * 1000 : 0;
    const files: Array<{ path: string; mtime: string; mtimeMs: number; size: number }> = [];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          const stat = fs.statSync(full);
          if (stat.mtimeMs >= cutoffTime) {
            files.push({
              path: path.relative(root, full),
              mtime: stat.mtime.toISOString(),
              mtimeMs: stat.mtimeMs,
              size: stat.size,
            });
          }
        }
      }
    };

    walk(targetDir);

    // Sort newest first
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const sliced = files.slice(0, limit).map(({ path, mtime, size }) => ({ path, mtime, size }));

    return {
      recentChanges: sliced,
      total: sliced.length,
    };
  }
}
