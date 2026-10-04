import { describe, it, expect } from "vitest";
import {
  parseYaml,
  stringifyYaml,
  parseNoteContent,
  setFrontmatterProperty,
  removeFrontmatterProperty,
  extractHeadings,
  extractWikilinks,
} from "../../src/utils/frontmatter.js";

describe("Frontmatter Utility", () => {
  it("should parse scalar properties correctly including strings with colons", () => {
    const yaml = `
title: "Architecture: System Design"
status: active
count: 42
rating: 9.5
verified: true
pending: false
notes: null
`;
    const parsed = parseYaml(yaml);
    expect(parsed.title).toBe("Architecture: System Design");
    expect(parsed.status).toBe("active");
    expect(parsed.count).toBe(42);
    expect(parsed.rating).toBe(9.5);
    expect(parsed.verified).toBe(true);
    expect(parsed.pending).toBe(false);
    expect(parsed.notes).toBe(null);
  });

  it("should parse block lists and flow lists", () => {
    const yaml = `
tags:
  - backend
  - security
  - typescript
aliases: [api, server]
`;
    const parsed = parseYaml(yaml);
    expect(parsed.tags).toEqual(["backend", "security", "typescript"]);
    expect(parsed.aliases).toEqual(["api", "server"]);
  });

  it("should parse note content separating frontmatter and body", () => {
    const content = `---
title: Sample Note
tags:
  - doc
---

# Introduction
This is the body of the note.`;

    const parsed = parseNoteContent(content);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter.title).toBe("Sample Note");
    expect(parsed.frontmatter.tags).toEqual(["doc"]);
    expect(parsed.body).toContain("# Introduction");
  });

  it("should update and serialize frontmatter properties accurately", () => {
    const original = `---
title: Original Note
tags:
  - general
---

# Content`;

    const updated = setFrontmatterProperty(original, "status", "reviewed");
    const reparsed = parseNoteContent(updated);
    expect(reparsed.frontmatter.title).toBe("Original Note");
    expect(reparsed.frontmatter.status).toBe("reviewed");
    expect(reparsed.frontmatter.tags).toEqual(["general"]);
    expect(reparsed.body).toContain("# Content");
  });

  it("should remove frontmatter property cleanly", () => {
    const original = `---
title: Note With Tags
tags:
  - a
  - b
deprecated: true
---

Body text`;

    const cleaned = removeFrontmatterProperty(original, "deprecated");
    const reparsed = parseNoteContent(cleaned);
    expect(reparsed.frontmatter.deprecated).toBeUndefined();
    expect(reparsed.frontmatter.title).toBe("Note With Tags");
    expect(reparsed.frontmatter.tags).toEqual(["a", "b"]);
  });

  it("should extract headings excluding markdown code blocks", () => {
    const md = `
# Main Title
Intro text

\`\`\`python
# This is a comment in code
\`\`\`

## Section 1
Content

### Subsection 1.1
More content
`;
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: "Main Title" });
    expect(headings[1]).toEqual({ level: 2, text: "Section 1" });
    expect(headings[2]).toEqual({ level: 3, text: "Subsection 1.1" });
  });

  it("should extract internal wikilinks without duplicates or aliases", () => {
    const md = `
Refer to [[Architecture/System Design|Arch Doc]] and [[Database Schema]] as well as [[Architecture/System Design#Section]].
`;
    const links = extractWikilinks(md);
    expect(links).toEqual(["Architecture/System Design", "Database Schema"]);
  });
});
