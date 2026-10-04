import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  // 1. daily-work-report
  server.prompt(
    "daily-work-report",
    { date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)") },
    ({ date }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please generate a structured daily work report for ${date || "today"}. First, invoke obsidian_read_daily_note to read the raw log. Then list completed tasks, identify blockers, extract reusable knowledge, and synthesize the report.`,
          },
        },
      ],
    })
  );

  // 2. knowledge-capture
  server.prompt(
    "knowledge-capture",
    { sourceNote: z.string().describe("Relative path of the source note to extract knowledge from") },
    ({ sourceNote }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Analyze '${sourceNote}' using obsidian_read_note. Identify permanent knowledge, decisions, or architectural lessons. Create a new note under 03-Knowledge/ using obsidian_create_note and link back to '${sourceNote}'.`,
          },
        },
      ],
    })
  );

  // 3. weekly-review
  server.prompt(
    "weekly-review",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Conduct a weekly review across the Obsidian vault. Use obsidian_list_tasks to review completed and pending tasks, summarize project progress, and suggest priorities for next week.`,
          },
        },
      ],
    })
  );

  // 4. monthly-review
  server.prompt(
    "monthly-review",
    { month: z.string().optional().describe("Month in YYYY-MM format") },
    ({ month }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Conduct a comprehensive monthly retrospective for ${month || "this month"}. Review key decisions, completed deliverables, recurring patterns, and high-level progress across the vault.`,
          },
        },
      ],
    })
  );

  // 5. project-review
  server.prompt(
    "project-review",
    { projectPath: z.string().describe("Relative path of the project note or folder") },
    ({ projectPath }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Review the project at '${projectPath}'. Read the project note, query related tasks with obsidian_list_tasks, examine incoming backlinks with obsidian_get_backlinks, and summarize current milestone status.`,
          },
        },
      ],
    })
  );

  // 6. meeting-summary
  server.prompt(
    "meeting-summary",
    { meetingNote: z.string().describe("Relative path of the raw meeting note") },
    ({ meetingNote }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Extract action items, decisions, and key takeaways from '${meetingNote}'. Append action items as checkboxes and create linked decision records where appropriate.`,
          },
        },
      ],
    })
  );

  // 7. vault-health-check
  server.prompt(
    "vault-health-check",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Run an audit of vault hygiene. Query obsidian_get_unresolved_links to identify broken wikilinks, and obsidian_get_orphans to find unlinked notes. Present a clean remediation checklist.`,
          },
        },
      ],
    })
  );
}
