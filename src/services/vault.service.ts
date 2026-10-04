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

import {
  ALLOWED_CLI_COMMANDS,
  isCliCommandAllowed,
  getCliCommandMetadata,
} from "../config/commands.js";

export { ALLOWED_CLI_COMMANDS, isCliCommandAllowed, getCliCommandMetadata };

export function stripObsidianComments(content: string): string {
  return content.replace(/%%[\s\S]*?%%/g, "");
}

export interface VaultInstance {
  name: string;
  root: string;
  pathGuard: PathGuard;
  trashManager: TrashManager;
  isDefault: boolean;
}

export class VaultService {
  private readonly vaults: Map<string, VaultInstance> = new Map();
  private defaultVaultName: string = "default";
  private readonly cliAdapter: ObsidianCliAdapter;

  constructor(
    vaultsOrPathGuard: PathGuard | Record<string, string> | Map<string, string>,
    cliAdapter: ObsidianCliAdapter,
    trashManager?: TrashManager,
    defaultVault?: string
  ) {
    this.cliAdapter = cliAdapter;

    if (vaultsOrPathGuard instanceof PathGuard) {
      const root = vaultsOrPathGuard.getVaultRoot();
      const name = defaultVault || path.basename(root) || "default";
      const tm = trashManager ?? new TrashManager(root);
      this.defaultVaultName = name;
      const instance: VaultInstance = {
        name,
        root,
        pathGuard: vaultsOrPathGuard,
        trashManager: tm,
        isDefault: true,
      };
      this.vaults.set(name, instance);
      if (name !== "default") {
        this.vaults.set("default", instance);
      }
    } else {
      const entries =
        vaultsOrPathGuard instanceof Map
          ? Array.from(vaultsOrPathGuard.entries())
          : Object.entries(vaultsOrPathGuard);

      if (entries.length === 0) {
        throw new Error("At least one vault must be configured.");
      }

      this.defaultVaultName = defaultVault || entries[0][0];

      for (const [name, vaultPath] of entries) {
        const resolvedPath = path.resolve(vaultPath);
        const pg = new PathGuard(resolvedPath);
        const tm = new TrashManager(resolvedPath);
        const isDef = name === this.defaultVaultName;
        this.vaults.set(name, {
          name,
          root: resolvedPath,
          pathGuard: pg,
          trashManager: tm,
          isDefault: isDef,
        });
      }

      if (!this.vaults.has("default") && this.vaults.has(this.defaultVaultName)) {
        this.vaults.set("default", this.vaults.get(this.defaultVaultName)!);
      }
    }
  }

  public resolveVault(vaultName?: string): VaultInstance {
    if (!vaultName || vaultName.trim() === "") {
      const def = this.vaults.get(this.defaultVaultName) || this.vaults.get("default");
      if (!def) {
        throw new ObsidianMcpError(ErrorCode.NOT_FOUND, "No default vault configured", 404);
      }
      return def;
    }

    const trimmed = vaultName.trim();
    const vault = this.vaults.get(trimmed);
    if (!vault) {
      const available = Array.from(new Set(this.vaults.keys())).join(", ");
      throw new ObsidianMcpError(
        ErrorCode.NOT_FOUND,
        `Vault '${trimmed}' not found. Available vaults: [${available}]`,
        404
      );
    }
    return vault;
  }

  public get pathGuard(): PathGuard {
    return this.resolveVault().pathGuard;
  }

  public get trashManager(): TrashManager {
    return this.resolveVault().trashManager;
  }

  public getPathGuard(vaultName?: string): PathGuard {
    return this.resolveVault(vaultName).pathGuard;
  }

  public getTrashManager(vaultName?: string): TrashManager {
    return this.resolveVault(vaultName).trashManager;
  }

  public getObsidianUri(relativePath: string, vaultName?: string): string {
    const vault = this.resolveVault(vaultName);
    return `obsidian://open?vault=${encodeURIComponent(vault.name)}&file=${encodeURIComponent(relativePath)}`;
  }

  // --- VAULT DOMAIN ---

  public async listVaults() {
    const list: Array<{ name: string; path: string; isDefault: boolean; totalFiles: number }> = [];
    const seenNames = new Set<string>();
    const seenRoots = new Set<string>();

    for (const [name, instance] of this.vaults.entries()) {
      if (name === "default" && this.vaults.size > 1 && instance.name !== "default") {
        continue;
      }
      if (seenNames.has(instance.name) || seenRoots.has(instance.root)) continue;
      seenNames.add(instance.name);
      seenRoots.add(instance.root);

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
        walk(instance.root);
      } catch {
        // Fallback
      }

      list.push({
        name: instance.name,
        path: instance.root,
        isDefault: instance.name === this.defaultVaultName,
        totalFiles,
      });
    }

    return {
      defaultVault: this.defaultVaultName,
      totalVaults: list.length,
      vaults: list,
    };
  }

  public async getVault(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const root = vault.pathGuard.getVaultRoot();
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
      vaultId: vault.name,
      name: vault.name,
      path: root,
      isDefault: vault.name === this.defaultVaultName,
      status: cliReachable ? "connected" : "degraded",
      vaultAccessible: true,
      obsidianCli: cliReachable ? "connected" : "unavailable",
      totalFiles,
    };
  }

  public async listFiles(
    folder?: string,
    recursive: boolean = false,
    vaultName?: string,
    extension?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const target = folder ? vault.pathGuard.resolveSafePath(folder).absolutePath : vault.pathGuard.getVaultRoot();
    if (!fs.existsSync(target)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Directory '${folder || ""}' not found`, 404);
    }

    const files: Array<{ path: string; type: "file" | "folder" }> = [];
    const root = vault.pathGuard.getVaultRoot();
    const cleanExt = extension
      ? extension.startsWith(".")
        ? extension.slice(1).toLowerCase()
        : extension.toLowerCase()
      : null;

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(root, fullPath);
        if (entry.isDirectory()) {
          if (!cleanExt) {
            files.push({ path: relPath, type: "folder" });
          }
          if (recursive) walk(fullPath);
        } else {
          if (!cleanExt || entry.name.toLowerCase().endsWith(`.${cleanExt}`)) {
            files.push({ path: relPath, type: "file" });
          }
        }
      }
    };

    walk(target);
    return { files, totalFiles: files.length };
  }

  public async getFileInfo(targetPath: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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

  public async readNote(targetPath: string, stripComments: boolean = false, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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
      obsidianUri: this.getObsidianUri(relativePath, vault.name),
    };
  }

  public async createNote(
    targetPath: string,
    content: string = "",
    template?: string,
    overwrite: boolean = false,
    expectedRevision?: string,
    vaultName?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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
      const args = [`vault=${vault.name}`, `path=${relativePath}`, "silent", `template=${template}`];
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
      obsidianUri: this.getObsidianUri(relativePath, vault.name),
    };
  }

  public async appendNote(
    targetPath: string,
    content: string,
    ensureNewline: boolean = true,
    expectedRevision?: string,
    vaultName?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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
      obsidianUri: this.getObsidianUri(relativePath, vault.name),
    };
  }

  public async prependNote(targetPath: string, content: string, expectedRevision?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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
      obsidianUri: this.getObsidianUri(relativePath, vault.name),
    };
  }

  public async updateNote(targetPath: string, content: string, expectedRevision?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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
      obsidianUri: this.getObsidianUri(relativePath, vault.name),
    };
  }

  public async patchNote(
    targetPath: string,
    target?: { type: "heading" | "block" | "string" | "regex"; value: string },
    operation: "replace" | "append" | "prepend" = "replace",
    content?: string,
    expectedRevision?: string,
    vaultName?: string,
    search?: string,
    replace?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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

    const searchNeedle = search ?? (target?.type === "string" || target?.type === "regex" ? target.value : undefined);
    const replacementText = content !== undefined ? content : replace ?? "";

    if (!target && searchNeedle === undefined) {
      throw new ObsidianMcpError(
        ErrorCode.VALIDATION_ERROR,
        "Either 'target' ({ type, value }) or 'search' string must be provided for obsidian_patch_note.",
        400
      );
    }

    if (searchNeedle !== undefined) {
      const isRegex = target?.type === "regex";
      const regex = isRegex ? new RegExp(searchNeedle) : null;

      if (isRegex) {
        if (!regex!.test(existingContent)) {
          throw new ObsidianMcpError(
            ErrorCode.NOT_FOUND,
            `Pattern '${searchNeedle}' not found in note '${relativePath}'.`,
            404
          );
        }
      } else {
        if (!existingContent.includes(searchNeedle)) {
          throw new ObsidianMcpError(
            ErrorCode.NOT_FOUND,
            `Search string '${searchNeedle}' not found in note '${relativePath}'.`,
            404
          );
        }
      }

      let patchedContent: string;
      if (isRegex) {
        if (operation === "replace") {
          patchedContent = existingContent.replace(regex!, replacementText);
        } else if (operation === "append") {
          patchedContent = existingContent.replace(regex!, (m) => `${m}\n${replacementText}`);
        } else {
          patchedContent = existingContent.replace(regex!, (m) => `${replacementText}\n${m}`);
        }
      } else {
        if (operation === "replace") {
          patchedContent = existingContent.replace(searchNeedle, replacementText);
        } else if (operation === "append") {
          patchedContent = existingContent.replace(searchNeedle, `${searchNeedle}\n${replacementText}`);
        } else {
          patchedContent = existingContent.replace(searchNeedle, `${replacementText}\n${searchNeedle}`);
        }
      }

      AtomicFs.writeFileSync(absolutePath, patchedContent, "utf-8");
      const newRev = crypto.createHash("sha1").update(patchedContent).digest("hex");
      return {
        path: relativePath,
        patched: true,
        target: target || { type: isRegex ? "regex" : "string", value: searchNeedle },
        operation,
        newRevision: newRev,
        etag: newRev,
        obsidianUri: this.getObsidianUri(relativePath, vault.name),
      };
    }

    const resolvedTarget = target!;
    const lines = existingContent.split("\n");
    let updatedLines: string[] = [];

    if (resolvedTarget.type === "heading") {
      const cleanTargetHeading = resolvedTarget.value.replace(/^#+\s*/, "").trim().toLowerCase();
      let headingIndex = -1;
      let headingLevel = 0;
      let matchedHeadingText = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          const currentText = match[2].trim().toLowerCase();
          if (currentText === cleanTargetHeading) {
            headingIndex = i;
            headingLevel = match[1].length;
            matchedHeadingText = lines[i];
            break;
          }
        }
      }

      if (headingIndex === -1) {
        throw new ObsidianMcpError(
          ErrorCode.NOT_FOUND,
          `Heading '${resolvedTarget.value}' not found in note '${relativePath}'`,
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
      const insertText = content !== undefined ? content : replace ?? "";

      if (operation === "replace") {
        if (/^#{1,6}\s+/.test(insertText.trim())) {
          updatedLines = [...beforeSection, insertText.trim(), ...(afterSection.length > 0 ? [""] : []), ...afterSection];
        } else {
          updatedLines = [...beforeSection, matchedHeadingText, "", insertText.trim(), ...(afterSection.length > 0 ? [""] : []), ...afterSection];
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
          insertText.trim(),
          "",
          ...afterSection,
        ];
      } else if (operation === "prepend") {
        updatedLines = [
          ...beforeSection,
          matchedHeadingText,
          "",
          insertText.trim(),
          "",
          ...sectionLines,
          ...afterSection,
        ];
      }
    } else if (resolvedTarget.type === "block") {
      const cleanBlockId = resolvedTarget.value.replace(/^\^/, "").trim();
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
      const insertText = content !== undefined ? content : replace ?? "";

      if (operation === "replace") {
        let newBlock = insertText.trim();
        if (!newBlock.includes(`^${cleanBlockId}`)) {
          newBlock = `${newBlock} ^${cleanBlockId}`;
        }
        updatedLines = [...beforeBlock, newBlock, ...afterBlock];
      } else if (operation === "append") {
        updatedLines = [...beforeBlock, targetLine, insertText.trim(), ...afterBlock];
      } else if (operation === "prepend") {
        updatedLines = [...beforeBlock, insertText.trim(), targetLine, ...afterBlock];
      }
    }

    const normalizedContent = updatedLines.join("\n").replace(/\n{3,}/g, "\n\n");
    AtomicFs.writeFileSync(absolutePath, normalizedContent, "utf-8");
    const newRevision = crypto.createHash("sha1").update(normalizedContent).digest("hex");

    return {
      path: relativePath,
      patched: true,
      target: resolvedTarget,
      operation,
      newRevision,
      etag: newRevision,
      obsidianUri: this.getObsidianUri(relativePath, vault.name),
    };
  }

  public async moveNote(
    sourcePath: string,
    targetPath: string,
    expectedRevision?: string,
    updateBacklinks: boolean = true,
    vaultName?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const src = vault.pathGuard.resolveSafePath(sourcePath);
    const dest = vault.pathGuard.resolveSafePath(targetPath);

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

    const root = vault.pathGuard.getVaultRoot();
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
      obsidianUri: this.getObsidianUri(dest.relativePath, vault.name),
    };
  }

  public async deleteNote(targetPath: string, permanent: boolean = false, expectedRevision?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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
      const res = vault.trashManager.moveToTrash(absolutePath, relativePath, currentRevision);
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

  public async search(query: string, limit: number = 50, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    try {
      const res = await this.cliAdapter.execute("search", [`vault=${vault.name}`, `query=${query}`, "format=json", "matches"]);
      let parsed = JSON.parse(res.stdout);
      if (Array.isArray(parsed)) {
        return { matches: parsed.slice(0, limit) };
      }
    } catch {
      // In-process BM25 lexical ranking fallback
    }

    const root = vault.pathGuard.getVaultRoot();
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

  public async searchContext(query: string, contextLines: number = 2, limit: number = 30, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const root = vault.pathGuard.getVaultRoot();
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
          const lines = fs.readFileSync(full, "utf-8").split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              const start = Math.max(0, i - contextLines);
              const end = Math.min(lines.length, i + contextLines + 1);
              const snippet = lines.slice(start, end).join("\n");
              results.push({
                path: path.relative(root, full),
                snippet,
              });
              if (results.length >= limit) return;
            }
          }
        }
      }
    };

    walk(root);
    return { results };
  }

  // --- DAILY NOTES DOMAIN ---

  public async readDailyNote(date?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const targetDate = date || new Date().toISOString().slice(0, 10);
    try {
      const res = await this.cliAdapter.execute("daily:read", date ? [`vault=${vault.name}`, `date=${date}`] : [`vault=${vault.name}`]);
      return { content: res.stdout, date: targetDate };
    } catch {
      // Check standard daily note paths (e.g. YYYY-MM-DD.md)
      const potential = [
        `${targetDate}.md`,
        `Daily/${targetDate}.md`,
        `01-Daily/${targetDate}.md`,
      ];
      for (const p of potential) {
        const full = path.join(vault.pathGuard.getVaultRoot(), p);
        if (fs.existsSync(full)) {
          return {
            path: p,
            content: fs.readFileSync(full, "utf-8"),
            date: targetDate,
            obsidianUri: this.getObsidianUri(p, vault.name),
          };
        }
      }
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Daily note for '${targetDate}' not found`, 404);
    }
  }

  public async appendDailyNote(content: string, date?: string, expectedRevision?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const p = `${targetDate}.md`;
    const full = path.join(vault.pathGuard.getVaultRoot(), p);

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
      const args = [`vault=${vault.name}`, `content=${content}`];
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

  public async prependDailyNote(content: string, date?: string, expectedRevision?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const p = `${targetDate}.md`;
    const full = path.join(vault.pathGuard.getVaultRoot(), p);

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

  public async listTasks(notePath?: string, status: string = "all", vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    try {
      const args = [`vault=${vault.name}`, "all"];
      if (status !== "all") args.push(status);
      if (notePath) args.push(`file=${notePath}`);
      const res = await this.cliAdapter.execute("tasks", args);
      return { raw: res.stdout };
    } catch {
      // In-process scan for markdown task checkboxes
      const tasks: Array<{ path: string; line: number; text: string; status: string }> = [];
      const root = vault.pathGuard.getVaultRoot();

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
        const safe = vault.pathGuard.resolveSafePath(notePath);
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

  public async toggleTask(
    targetPath: string,
    lineNum: number,
    expectedRevision?: string,
    expectedText?: string,
    vaultName?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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

  public async getProperties(targetPath: string, vaultName?: string) {
    const note = await this.readNote(targetPath, false, vaultName);
    return { path: note.path, properties: note.frontmatter };
  }

  public async getProperty(targetPath: string, name: string, vaultName?: string) {
    const note = await this.readNote(targetPath, false, vaultName);
    const value = note.frontmatter[name];
    if (value === undefined) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Property '${name}' not found on note '${note.path}'`, 404);
    }
    return { path: note.path, name, value };
  }

  public async removeProperty(targetPath: string, name: string, expectedRevision?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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

  public async setProperty(targetPath: string, name: string, value: any, expectedRevision?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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

  public async getBacklinks(targetPath: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath } = vault.pathGuard.resolveSafePath(targetPath);
    try {
      const res = await this.cliAdapter.execute("backlinks", [`vault=${vault.name}`, `path=${relativePath}`]);
      return { path: relativePath, backlinks: res.stdout.split("\n").filter(Boolean) };
    } catch {
      // In-process backlinks scan fallback across notes in this vault
      const { files } = await this.listFiles(undefined, true, vault.name);
      const backlinks: string[] = [];
      const noteBaseName = path.basename(relativePath, ".md");
      const notePathNoExt = relativePath.replace(/\.md$/, "");

      for (const f of files) {
        if (!f.path.endsWith(".md") || f.path === relativePath) continue;
        try {
          const noteData = await this.readNote(f.path, false, vault.name);
          const links = extractWikilinks(noteData.content);
          if (
            links.some(
              (l) =>
                l === relativePath ||
                l === noteBaseName ||
                l === notePathNoExt
            )
          ) {
            backlinks.push(f.path);
          }
        } catch {
          // ignore read error
        }
      }
      return { path: relativePath, backlinks };
    }
  }

  public async getLinks(targetPath: string, vaultName?: string) {
    const note = await this.readNote(targetPath, false, vaultName);
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

  public async getLinkPath(fromPath: string, toPath: string, maxDepth: number = 6, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const fromSafe = vault.pathGuard.resolveSafePath(fromPath);
    const toSafe = vault.pathGuard.resolveSafePath(toPath);

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

    const root = vault.pathGuard.getVaultRoot();

    // In-memory adjacency graph building
    const adjacency: Map<string, Set<string>> = new Map();
    const normalizeTarget = (linkTarget: string): string => {
      const clean = linkTarget.split("|")[0].split("#")[0].trim();
      return clean.endsWith(".md") ? clean : `${clean}.md`;
    };

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          const rel = path.relative(root, full);
          const content = fs.readFileSync(full, "utf-8");
          const links = extractWikilinks(content);
          const neighbors = new Set<string>();

          for (const link of links) {
            const normalized = normalizeTarget(link);
            neighbors.add(normalized);
          }
          adjacency.set(rel, neighbors);
        }
      }
    };

    walk(root);

    // Breadth-First Search (BFS) to guarantee shortest path
    const queue: Array<{ current: string; path: string[] }> = [
      { current: fromSafe.relativePath, path: [fromSafe.relativePath] },
    ];
    const visited = new Set<string>([fromSafe.relativePath]);

    while (queue.length > 0) {
      const { current, path: currentPath } = queue.shift()!;

      if (currentPath.length - 1 >= maxDepth) {
        continue;
      }

      const neighbors = adjacency.get(current) || new Set<string>();
      for (const neighbor of neighbors) {
        // Resolve neighbor against existing notes
        let matchedTarget: string | null = null;
        if (adjacency.has(neighbor)) {
          matchedTarget = neighbor;
        } else {
          // Attempt match by basename
          for (const key of adjacency.keys()) {
            if (path.basename(key) === path.basename(neighbor)) {
              matchedTarget = key;
              break;
            }
          }
        }

        if (!matchedTarget) continue;

        if (matchedTarget === toSafe.relativePath) {
          const fullResultPath = [...currentPath, matchedTarget];
          return {
            from: fromSafe.relativePath,
            to: toSafe.relativePath,
            found: true,
            distance: fullResultPath.length - 1,
            path: fullResultPath,
          };
        }

        if (!visited.has(matchedTarget)) {
          visited.add(matchedTarget);
          queue.push({
            current: matchedTarget,
            path: [...currentPath, matchedTarget],
          });
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

  public async getOrphans(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    try {
      const res = await this.cliAdapter.execute("orphans", [`vault=${vault.name}`]);
      return { orphans: res.stdout.split("\n").filter(Boolean) };
    } catch {
      return { orphans: [] };
    }
  }

  public async getUnresolvedLinks(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    try {
      const res = await this.cliAdapter.execute("unresolved", [`vault=${vault.name}`]);
      return { unresolved: res.stdout.split("\n").filter(Boolean) };
    } catch {
      return { unresolved: [] };
    }
  }

  public async getDeadends(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    try {
      const res = await this.cliAdapter.execute("deadends", [`vault=${vault.name}`]);
      return { deadends: res.stdout.split("\n").filter(Boolean) };
    } catch {
      return { deadends: [] };
    }
  }

  public async getTags(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    try {
      const res = await this.cliAdapter.execute("tags", [`vault=${vault.name}`, "all", "counts"]);
      return { raw: res.stdout };
    } catch {
      return { tags: {} };
    }
  }

  public async getTagNotes(tag: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const cleanTag = tag.startsWith("#") ? tag.slice(1) : tag;
    try {
      const res = await this.cliAdapter.execute("tag", [`vault=${vault.name}`, `tag=${cleanTag}`]);
      return { tag: cleanTag, notes: res.stdout.split("\n").filter(Boolean) };
    } catch {
      const root = vault.pathGuard.getVaultRoot();
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

  public async listBases(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const root = vault.pathGuard.getVaultRoot();
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

  public async queryBase(targetPath: string, view?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Base file '${relativePath}' not found`, 404);
    }

    try {
      const args = [`vault=${vault.name}`, `path=${relativePath}`];
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

  public async executeCli(command: string, args: Record<string, string>, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    if (!ALLOWED_CLI_COMMANDS.has(command)) {
      throw new ObsidianMcpError(
        ErrorCode.FORBIDDEN,
        `Command '${command}' is not in the Obsidian CLI allowlist. Permitted commands: ${Array.from(ALLOWED_CLI_COMMANDS).join(", ")}`,
        403,
        { command, allowedCommands: Array.from(ALLOWED_CLI_COMMANDS) }
      );
    }

    const argList = [`vault=${vault.name}`, ...Object.entries(args).map(([k, v]) => `${k}=${v}`)];
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
    },
    vaultName?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
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
        const res = await this.cliAdapter.execute("backlinks", [`vault=${vault.name}`, `path=${relativePath}`]);
        backlinks = res.stdout.split("\n").filter(Boolean);
      } catch {
        const root = vault.pathGuard.getVaultRoot();
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
            const tagRes = await this.getTagNotes(tag, vault.name);
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
      obsidianUri: this.getObsidianUri(relativePath, vault.name),
      frontmatter: inc.frontmatter ? parsed.frontmatter : undefined,
      headings: inc.headings ? headings : undefined,
      outgoingLinks: inc.outgoingLinks ? outgoingLinks : undefined,
      backlinks: inc.backlinks ? backlinks : undefined,
      relatedNotes: inc.relatedNotes ? relatedNotes : undefined,
      body: inc.body ? parsed.body.trim() : undefined,
    };
  }

  public async findNotes(
    filter: {
      query?: string;
      tag?: string;
      folder?: string;
      property?: { name: string; value?: any };
      limit?: number;
    },
    vaultName?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const limit = filter.limit ?? 20;
    const root = vault.pathGuard.getVaultRoot();
    const targetDir = filter.folder ? vault.pathGuard.resolveSafePath(filter.folder).absolutePath : root;

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

  public async recentChanges(
    filter: {
      limit?: number;
      folder?: string;
      sinceDays?: number;
    },
    vaultName?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const limit = filter.limit ?? 20;
    const root = vault.pathGuard.getVaultRoot();
    const targetDir = filter.folder ? vault.pathGuard.resolveSafePath(filter.folder).absolutePath : root;

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

  // --- BOOKMARKS DOMAIN ---

  public async listBookmarks(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    try {
      const res = await this.cliAdapter.execute("bookmarks", [`vault=${vault.name}`, "verbose", "format=json"]);
      const parsed = JSON.parse(res.stdout);
      return { bookmarks: parsed };
    } catch {
      const bookmarkFile = path.join(vault.pathGuard.getVaultRoot(), ".obsidian", "bookmarks.json");
      if (fs.existsSync(bookmarkFile)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(bookmarkFile, "utf-8"));
          return { bookmarks: parsed.items || parsed || [] };
        } catch {
          // ignore parse error
        }
      }
      return { bookmarks: [] };
    }
  }

  public async createBookmark(targetPath: string, subpath?: string, title?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `File '${relativePath}' not found to bookmark`, 404);
    }
    const bookmarkTitle = title || path.basename(relativePath, ".md");
    try {
      const args = [`vault=${vault.name}`, `file=${relativePath}`, `title=${bookmarkTitle}`];
      if (subpath) args.push(`subpath=${subpath}`);
      await this.cliAdapter.execute("bookmark", args);
      return { bookmarked: true, path: relativePath, title: bookmarkTitle };
    } catch {
      const dotObsidian = path.join(vault.pathGuard.getVaultRoot(), ".obsidian");
      fs.mkdirSync(dotObsidian, { recursive: true });
      const bookmarkFile = path.join(dotObsidian, "bookmarks.json");
      let data: { items: any[] } = { items: [] };
      if (fs.existsSync(bookmarkFile)) {
        try {
          data = JSON.parse(fs.readFileSync(bookmarkFile, "utf-8"));
          if (!Array.isArray(data.items)) data.items = [];
        } catch {
          data = { items: [] };
        }
      }
      data.items.push({
        type: "file",
        path: relativePath,
        subpath: subpath || undefined,
        title: bookmarkTitle,
        ctime: Date.now(),
      });
      AtomicFs.writeFileSync(bookmarkFile, JSON.stringify(data, null, 2), "utf-8");
      return { bookmarked: true, path: relativePath, title: bookmarkTitle };
    }
  }

  // --- OUTLINE DOMAIN ---

  public async getOutline(targetPath: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist`, 404);
    }
    const content = fs.readFileSync(absolutePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const outline: Array<{ level: number; text: string; line: number }> = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        outline.push({
          level: match[1].length,
          text: match[2].trim(),
          line: i + 1,
        });
      }
    }
    return { path: relativePath, totalHeadings: outline.length, headings: outline };
  }

  // --- ALIASES DOMAIN ---

  public async listAliases(targetPath?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    if (targetPath) {
      const note = await this.readNote(targetPath, false, vault.name);
      const rawAliases = note.frontmatter.aliases ?? note.frontmatter.alias;
      const aliases = Array.isArray(rawAliases)
        ? rawAliases.map(String)
        : typeof rawAliases === "string"
        ? [rawAliases]
        : [];
      return { path: note.path, aliases };
    }

    const root = vault.pathGuard.getVaultRoot();
    const aliasMap: Record<string, string> = {};
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".md")) {
          const content = fs.readFileSync(full, "utf-8");
          const parsed = parseNoteContent(content);
          const rawAliases = parsed.frontmatter.aliases ?? parsed.frontmatter.alias;
          const aliases = Array.isArray(rawAliases)
            ? rawAliases.map(String)
            : typeof rawAliases === "string"
            ? [rawAliases]
            : [];
          const rel = path.relative(root, full);
          for (const a of aliases) {
            aliasMap[a] = rel;
          }
        }
      }
    };
    walk(root);
    return { totalAliases: Object.keys(aliasMap).length, aliases: aliasMap };
  }

  // --- TEMPLATES DOMAIN ---

  public async listTemplates(folder?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const root = vault.pathGuard.getVaultRoot();
    const searchDirs: string[] = [];
    if (folder) {
      searchDirs.push(vault.pathGuard.resolveSafePath(folder).absolutePath);
    } else {
      const candidates = ["Templates", "templates", "00-Templates", "_templates", "Template"];
      for (const c of candidates) {
        const full = path.join(root, c);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
          searchDirs.push(full);
        }
      }
      if (searchDirs.length === 0) {
        searchDirs.push(root);
      }
    }

    const templates: string[] = [];
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isFile() && e.name.endsWith(".md")) {
          templates.push(path.relative(root, full));
        }
      }
    }
    return { templates };
  }

  public async readTemplate(name: string, title?: string, resolve: boolean = true, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const root = vault.pathGuard.getVaultRoot();
    let templatePath = "";

    try {
      const safe = vault.pathGuard.resolveSafePath(name);
      if (fs.existsSync(safe.absolutePath)) {
        templatePath = safe.absolutePath;
      }
    } catch {
      // ignore
    }

    if (!templatePath) {
      const cleanName = name.endsWith(".md") ? name : `${name}.md`;
      const walk = (dir: string) => {
        if (templatePath) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.name === cleanName || path.basename(e.name, ".md") === name) {
            templatePath = full;
            return;
          }
        }
      };
      walk(root);
    }

    if (!templatePath || !fs.existsSync(templatePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Template '${name}' not found in vault`, 404);
    }

    let rawContent = fs.readFileSync(templatePath, "utf-8");
    if (resolve) {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const resolvedTitle = title || path.basename(name, ".md");
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

      rawContent = rawContent
        .replace(/{{title}}/g, resolvedTitle)
        .replace(/{{date}}/g, dateStr)
        .replace(/{{time}}/g, timeStr)
        .replace(/{{date:YYYY-MM-DD}}/g, dateStr)
        .replace(/{{date:YYYYMMDD}}/g, `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`);
    }

    return {
      template: path.relative(root, templatePath),
      content: rawContent,
      resolved: resolve,
    };
  }

  // --- STATS & WORD COUNT DOMAIN ---

  public async wordCount(targetPath: string, vaultName?: string) {
    const note = await this.readNote(targetPath, true, vaultName);
    const content = note.content;
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const characters = content.length;
    const charactersWithoutSpaces = content.replace(/\s+/g, "").length;
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
    const readingTimeMinutes = Math.ceil(words / 200);

    return {
      path: note.path,
      words,
      characters,
      charactersWithoutSpaces,
      sentences,
      paragraphs,
      readingTimeMinutes,
    };
  }

  // --- RANDOM & DISCOVERY DOMAIN ---

  public async randomNote(folder?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { files } = await this.listFiles(folder, true, vault.name);
    const mdFiles = files.filter((f) => f.type === "file" && f.path.endsWith(".md"));
    if (mdFiles.length === 0) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `No markdown notes found to select a random note`, 404);
    }
    const chosen = mdFiles[Math.floor(Math.random() * mdFiles.length)];
    return this.readNote(chosen.path, false, vault.name);
  }

  // --- UNIQUE / ZETTELKASTEN DOMAIN ---

  public async createUniqueNote(
    title: string = "",
    content: string = "",
    folder?: string,
    vaultName?: string
  ) {
    const vault = this.resolveVault(vaultName);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const baseId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const randSuffix = crypto.randomBytes(2).toString("hex");
    const id = `${baseId}-${randSuffix}`;
    const cleanTitle = title.trim();

    let noteName = cleanTitle ? `${id} ${cleanTitle}.md` : `${id}.md`;
    let targetPath = folder ? path.join(folder, noteName) : noteName;

    // Guaranteed uniqueness invariant: check existence and increment counter if needed
    let counter = 1;
    while (fs.existsSync(vault.pathGuard.resolveSafePath(targetPath).absolutePath)) {
      noteName = cleanTitle ? `${id}-${counter} ${cleanTitle}.md` : `${id}-${counter}.md`;
      targetPath = folder ? path.join(folder, noteName) : noteName;
      counter++;
    }

    return this.createNote(targetPath, content, undefined, false, undefined, vaultName);
  }

  // --- DESKTOP INTEGRATION DOMAIN ---

  public async openNote(targetPath: string, newTab: boolean = false, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const { relativePath, absolutePath } = vault.pathGuard.resolveSafePath(targetPath);
    if (!fs.existsSync(absolutePath)) {
      throw new ObsidianMcpError(ErrorCode.NOT_FOUND, `Note '${relativePath}' does not exist to open`, 404);
    }
    const uri = this.getObsidianUri(relativePath, vault.name);
    let opened = false;
    let message = "";
    try {
      const args = [`vault=${vault.name}`, `file=${relativePath}`];
      if (newTab) args.push("newtab");
      await this.cliAdapter.execute("open", args);
      opened = true;
      message = "Note successfully opened in Obsidian desktop application";
    } catch {
      opened = false;
      message = "Obsidian CLI is not currently running or reachable; provided obsidianUri for application opening";
    }
    return {
      path: relativePath,
      opened,
      obsidianUri: uri,
      message,
    };
  }

  // --- PLUGINS & SNIPPETS DOMAIN ---

  public async listPlugins(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const dotObsidian = path.join(vault.pathGuard.getVaultRoot(), ".obsidian");
    let communityPlugins: string[] = [];
    let corePlugins: Record<string, boolean> = {};

    const commFile = path.join(dotObsidian, "community-plugins.json");
    if (fs.existsSync(commFile)) {
      try {
        communityPlugins = JSON.parse(fs.readFileSync(commFile, "utf-8"));
      } catch {
        // ignore
      }
    }

    const coreFile = path.join(dotObsidian, "core-plugins.json");
    if (fs.existsSync(coreFile)) {
      try {
        corePlugins = JSON.parse(fs.readFileSync(coreFile, "utf-8"));
      } catch {
        // ignore
      }
    }

    return {
      communityPlugins,
      corePlugins,
      totalCommunity: communityPlugins.length,
    };
  }

  public async listSnippets(vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const dotObsidian = path.join(vault.pathGuard.getVaultRoot(), ".obsidian");
    const snippetsDir = path.join(dotObsidian, "snippets");
    let enabledSnippets: string[] = [];

    const appearanceFile = path.join(dotObsidian, "appearance.json");
    if (fs.existsSync(appearanceFile)) {
      try {
        const appJson = JSON.parse(fs.readFileSync(appearanceFile, "utf-8"));
        if (Array.isArray(appJson.enabledCssSnippets)) {
          enabledSnippets = appJson.enabledCssSnippets;
        }
      } catch {
        // ignore
      }
    }

    const snippets: Array<{ name: string; enabled: boolean }> = [];
    if (fs.existsSync(snippetsDir)) {
      const entries = fs.readdirSync(snippetsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.endsWith(".css")) {
          const snippetName = path.basename(e.name, ".css");
          snippets.push({
            name: snippetName,
            enabled: enabledSnippets.includes(snippetName),
          });
        }
      }
    }

    return { totalSnippets: snippets.length, snippets };
  }

  // --- COMMANDS DOMAIN ---

  public async listCommands(filter?: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const args = [`vault=${vault.name}`];
    if (filter) args.push(`filter=${filter}`);
    const res = await this.cliAdapter.execute("commands", args);
    const commands = res.stdout.split("\n").filter(Boolean);
    return { total: commands.length, commands };
  }

  public async executeCommand(commandId: string, vaultName?: string) {
    const vault = this.resolveVault(vaultName);
    const res = await this.cliAdapter.execute("command", [`vault=${vault.name}`, `id=${commandId}`]);
    return { commandId, executed: true, output: res.stdout };
  }
}
