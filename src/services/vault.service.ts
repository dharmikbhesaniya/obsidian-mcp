import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PathGuard } from "../security/path-guard.js";
import { ObsidianCliAdapter } from "../adapters/obsidian/cli.adapter.js";
import { ErrorCode, ObsidianMcpError } from "../schemas/errors.js";

export class VaultService {
  private readonly pathGuard: PathGuard;
  private readonly cliAdapter: ObsidianCliAdapter;

  constructor(pathGuard: PathGuard, cliAdapter: ObsidianCliAdapter) {
    this.pathGuard = pathGuard;
    this.cliAdapter = cliAdapter;
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

    return {
      name: path.basename(root),
      status: "connected",
      totalFiles,
      vaultPath: root,
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

  public async readNote(targetPath: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const content = fs.readFileSync(absolutePath, "utf-8");
    const revision = crypto.createHash("sha1").update(content).digest("hex");

    // Extract frontmatter properties if present
    const frontmatter: Record<string, any> = {};
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const lines = fmMatch[1].split("\n");
      for (const line of lines) {
        const parts = line.split(":");
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join(":").trim();
          frontmatter[key] = val;
        }
      }
    }

    return {
      path: relativePath,
      content,
      revision,
      frontmatter,
    };
  }

  public async createNote(targetPath: string, content: string = "", template?: string, overwrite: boolean = false) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (fs.existsSync(absolutePath) && !overwrite) {
      throw new ObsidianMcpError(
        ErrorCode.CONFLICT,
        `Note '${relativePath}' already exists. Specify overwrite=true to replace.`,
        409
      );
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    // Use CLI create command with silent flag if CLI is available, otherwise direct fs write
    try {
      const args = [`path=${relativePath}`, "silent"];
      if (template) args.push(`template=${template}`);
      await this.cliAdapter.execute("create", args);
      if (content) {
        fs.writeFileSync(absolutePath, content, "utf-8");
      }
    } catch {
      fs.writeFileSync(absolutePath, content, "utf-8");
    }

    return { path: relativePath, created: true };
  }

  public async appendNote(targetPath: string, content: string, ensureNewline: boolean = true) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    let existing = fs.readFileSync(absolutePath, "utf-8");
    const toAppend = ensureNewline && !existing.endsWith("\n") ? `\n${content}` : content;
    fs.appendFileSync(absolutePath, toAppend, "utf-8");

    return { path: relativePath, appended: true };
  }

  public async prependNote(targetPath: string, content: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const existing = fs.readFileSync(absolutePath, "utf-8");
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

    fs.writeFileSync(absolutePath, updated, "utf-8");
    return { path: relativePath, prepended: true };
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

    fs.writeFileSync(absolutePath, content, "utf-8");
    const newRevision = crypto.createHash("sha1").update(content).digest("hex");

    return {
      path: relativePath,
      updated: true,
      newRevision,
    };
  }

  public async moveNote(sourcePath: string, targetPath: string) {
    const src = this.pathGuard.resolveSafePath(sourcePath);
    const dest = this.pathGuard.resolveSafePath(targetPath);

    if (!fs.existsSync(src.absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Source note '${src.relativePath}' does not exist`, 404);
    }
    if (fs.existsSync(dest.absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.CONFLICT, `Target note '${dest.relativePath}' already exists`, 409);
    }

    fs.mkdirSync(path.dirname(dest.absolutePath), { recursive: true });
    fs.renameSync(src.absolutePath, dest.absolutePath);

    return {
      sourcePath: src.relativePath,
      targetPath: dest.relativePath,
      moved: true,
    };
  }

  public async deleteNote(targetPath: string, permanent: boolean = false) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    if (permanent) {
      fs.unlinkSync(absolutePath);
    } else {
      // Move to .trash folder inside vault
      const trashDir = path.join(this.pathGuard.getVaultRoot(), ".trash");
      fs.mkdirSync(trashDir, { recursive: true });
      const trashDest = path.join(trashDir, `${Date.now()}_${path.basename(absolutePath)}`);
      fs.renameSync(absolutePath, trashDest);
    }

    return { path: relativePath, deleted: true };
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
      // Fallback: fast in-process full text search over markdown files
    }

    const matches: Array<{ path: string; lines: number[] }> = [];
    const root = this.pathGuard.getVaultRoot();

    const walk = (dir: string) => {
      if (matches.length >= limit) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          const content = fs.readFileSync(full, "utf-8");
          const lines = content.split("\n");
          const hitLines: number[] = [];
          lines.forEach((l, idx) => {
            if (l.toLowerCase().includes(query.toLowerCase())) {
              hitLines.push(idx + 1);
            }
          });
          if (hitLines.length > 0) {
            matches.push({ path: path.relative(root, full), lines: hitLines });
          }
        }
      }
    };

    walk(root);
    return { matches: matches.slice(0, limit) };
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

  public async appendDailyNote(content: string, date?: string) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    try {
      const args = [`content=${content}`];
      if (date) args.push(`date=${date}`);
      await this.cliAdapter.execute("daily:append", args);
      return { appended: true, date: targetDate };
    } catch {
      // Find or create daily note file
      const p = `${targetDate}.md`;
      const full = path.join(this.pathGuard.getVaultRoot(), p);
      if (!fs.existsSync(full)) {
        fs.writeFileSync(full, `# ${targetDate}\n\n`, "utf-8");
      }
      fs.appendFileSync(full, `\n${content}`, "utf-8");
      return { appended: true, date: targetDate };
    }
  }

  public async prependDailyNote(content: string, date?: string) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const p = `${targetDate}.md`;
    const full = path.join(this.pathGuard.getVaultRoot(), p);
    if (!fs.existsSync(full)) {
      fs.writeFileSync(full, `# ${targetDate}\n\n${content}\n`, "utf-8");
    } else {
      const existing = fs.readFileSync(full, "utf-8");
      fs.writeFileSync(full, `${content}\n\n${existing}`, "utf-8");
    }
    return { prepended: true, date: targetDate };
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

  public async toggleTask(targetPath: string, lineNum: number) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    try {
      await this.cliAdapter.execute("task", [`path=${relativePath}`, `line=${lineNum}`, "toggle"]);
      return { path: relativePath, line: lineNum, toggled: true };
    } catch {
      const lines = fs.readFileSync(absolutePath, "utf-8").split("\n");
      if (lineNum < 1 || lineNum > lines.length) {
        throw new ObsidianMcpError(ErrorCode.VALIDATION_ERROR, `Line ${lineNum} out of range in '${relativePath}'`, 400);
      }
      const targetLine = lines[lineNum - 1];
      if (targetLine.includes("- [ ]")) {
        lines[lineNum - 1] = targetLine.replace("- [ ]", "- [x]");
      } else if (targetLine.includes("- [x]") || targetLine.includes("- [X]")) {
        lines[lineNum - 1] = targetLine.replace(/- \[[xX]\]/, "- [ ]");
      }
      fs.writeFileSync(absolutePath, lines.join("\n"), "utf-8");
      return { path: relativePath, line: lineNum, toggled: true };
    }
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

  public async removeProperty(targetPath: string, name: string) {
    const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }

    const content = fs.readFileSync(absolutePath, "utf-8");
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const fmLines = fmMatch[1].split("\n").filter((l) => !l.startsWith(`${name}:`));
      const rest = content.slice(fmMatch[0].length);
      const updated = `---\n${fmLines.join("\n")}\n---${rest}`;
      fs.writeFileSync(absolutePath, updated, "utf-8");
    }
    return { path: relativePath, name, removed: true };
  }

  public async setProperty(targetPath: string, name: string, value: any) {
    try {
      await this.cliAdapter.execute("property:set", [
        `path=${targetPath}`,
        `name=${name}`,
        `value=${String(value)}`,
      ]);
      return { path: targetPath, name, updated: true };
    } catch {
      const { relativePath, absolutePath } = this.pathGuard.resolveSafePath(targetPath);
      const content = fs.readFileSync(absolutePath, "utf-8");
      // Add or update frontmatter
      let updated = "";
      if (content.startsWith("---")) {
        const endFm = content.indexOf("\n---", 3);
        if (endFm !== -1) {
          const fm = content.slice(4, endFm);
          const rest = content.slice(endFm + 4);
          updated = `---\n${fm}\n${name}: ${value}\n---${rest}`;
        } else {
          updated = `---\n${name}: ${value}\n---\n\n${content}`;
        }
      } else {
        updated = `---\n${name}: ${value}\n---\n\n${content}`;
      }
      fs.writeFileSync(absolutePath, updated, "utf-8");
      return { path: relativePath, name, updated: true };
    }
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
            if (content.includes(`#${cleanTag}`) || content.includes(`tags: ${cleanTag}`)) {
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
    const argList = Object.entries(args).map(([k, v]) => `${k}=${v}`);
    const res = await this.cliAdapter.execute(command, argList);
    return {
      stdout: res.stdout,
      exitCode: res.exitCode,
    };
  }
}
