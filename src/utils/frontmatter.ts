/**
 * Robust YAML Frontmatter parser and serializer for Obsidian Markdown notes.
 * Preserves structured data types (strings, numbers, booleans, arrays, nested mappings).
 */

export interface ParsedNote {
  frontmatter: Record<string, any>;
  body: string;
  hasFrontmatter: boolean;
}

export interface HeadingItem {
  level: number;
  text: string;
}

/**
 * Parses scalar YAML values into corresponding JS primitives.
 */
function parseScalar(val: string): any {
  const trimmed = val.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true" || trimmed === "True") return true;
  if (trimmed === "false" || trimmed === "False") return false;
  if (!isNaN(Number(trimmed)) && !trimmed.startsWith("0x")) {
    return Number(trimmed);
  }

  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Flow array e.g. [a, b, "c"]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseScalar(s.trim()));
  }

  return trimmed;
}

/**
 * Parses YAML frontmatter text into a JavaScript object.
 */
export function parseYaml(yamlText: string): Record<string, any> {
  const lines = yamlText.split(/\r?\n/);
  const result: Record<string, any> = {};

  let currentKey: string | null = null;
  let currentList: any[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();

    // Ignore comment or empty lines
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    // Check for list item e.g. "  - item"
    const listMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!currentList) {
        currentList = [];
        result[currentKey] = currentList;
      }
      currentList.push(parseScalar(listMatch[2]));
      continue;
    }

    // Check for key: value
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const valStr = line.slice(colonIdx + 1).trim();

      currentKey = key;
      currentList = null;

      if (valStr === "") {
        // May be followed by a block list
        result[key] = [];
        currentList = result[key];
      } else {
        result[key] = parseScalar(valStr);
      }
    }
  }

  return result;
}

/**
 * Serializes a value into YAML format.
 */
function serializeValue(val: any, indent: number = 0): string {
  const pad = "  ".repeat(indent);
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean" || typeof val === "number") return String(val);

  if (typeof val === "string") {
    // If string contains colons, hashes, newlines, or quotes, wrap with double quotes
    if (/[:#\[\]\{\},\n"]/.test(val) || val.trim() !== val) {
      return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return val;
  }

  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    return val
      .map((item) => `\n${pad}  - ${serializeValue(item, indent + 1)}`)
      .join("");
  }

  if (typeof val === "object") {
    return Object.entries(val)
      .map(([k, v]) => `\n${pad}  ${k}: ${serializeValue(v, indent + 1)}`)
      .join("");
  }

  return String(val);
}

/**
 * Serializes a JavaScript object into YAML frontmatter string (without delimiters).
 */
export function stringifyYaml(data: Record<string, any>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${serializeValue(item)}`);
        }
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [nestedKey, nestedVal] of Object.entries(value)) {
        lines.push(`  ${nestedKey}: ${serializeValue(nestedVal)}`);
      }
    } else {
      lines.push(`${key}: ${serializeValue(value)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Parses markdown note content into structured frontmatter and markdown body.
 */
export function parseNoteContent(rawContent: string): ParsedNote {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    const yamlString = match[1];
    const body = rawContent.slice(match[0].length);
    return {
      frontmatter: parseYaml(yamlString),
      body,
      hasFrontmatter: true,
    };
  }

  return {
    frontmatter: {},
    body: rawContent,
    hasFrontmatter: false,
  };
}

/**
 * Sets or updates a frontmatter property and returns the reconstructed note text.
 */
export function setFrontmatterProperty(rawContent: string, key: string, value: any): string {
  const parsed = parseNoteContent(rawContent);
  parsed.frontmatter[key] = value;
  const yamlText = stringifyYaml(parsed.frontmatter);

  if (parsed.body.length > 0 && !parsed.body.startsWith("\n")) {
    return `---\n${yamlText}\n---\n\n${parsed.body.trimStart()}`;
  }
  return `---\n${yamlText}\n---\n${parsed.body}`;
}

/**
 * Removes a frontmatter property and returns the reconstructed note text.
 */
export function removeFrontmatterProperty(rawContent: string, key: string): string {
  const parsed = parseNoteContent(rawContent);
  delete parsed.frontmatter[key];

  if (Object.keys(parsed.frontmatter).length === 0) {
    // If no properties left, return body directly
    return parsed.body.trimStart();
  }

  const yamlText = stringifyYaml(parsed.frontmatter);
  if (parsed.body.length > 0 && !parsed.body.startsWith("\n")) {
    return `---\n${yamlText}\n---\n\n${parsed.body.trimStart()}`;
  }
  return `---\n${yamlText}\n---\n${parsed.body}`;
}

/**
 * Extracts headings from markdown content.
 */
export function extractHeadings(content: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = content.split(/\r?\n/);
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
      });
    }
  }

  return headings;
}

/**
 * Extracts all internal wikilinks [[link]] from markdown content.
 */
export function extractWikilinks(content: string): string[] {
  const matches = content.matchAll(/\[\[(.*?)\]\]/g);
  const links: string[] = [];
  for (const match of matches) {
    const target = match[1].split("|")[0].split("#")[0].trim();
    if (target && !links.includes(target)) {
      links.push(target);
    }
  }
  return links;
}
