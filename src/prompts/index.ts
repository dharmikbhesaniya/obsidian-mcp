import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  // 1. daily-work-report
  server.registerPrompt(
    "daily-work-report",
    {
      description: "Generates a structured daily work report from the daily note and tasks",
      argsSchema: { date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)") },
    },
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
  server.registerPrompt(
    "knowledge-capture",
    {
      description: "Extracts permanent architectural lessons and decisions from a note into 03-Knowledge/",
      argsSchema: { sourceNote: z.string().describe("Relative path of the source note to extract knowledge from") },
    },
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
  server.registerPrompt(
    "weekly-review",
    {
      description: "Conducts a weekly review across tasks, project progress, and priorities",
    },
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
  server.registerPrompt(
    "monthly-review",
    {
      description: "Conducts a high-level monthly retrospective across vault deliverables",
      argsSchema: { month: z.string().optional().describe("Month in YYYY-MM format") },
    },
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
  server.registerPrompt(
    "project-review",
    {
      description: "Evaluates project status, related tasks, backlinks, and milestone state",
      argsSchema: { projectPath: z.string().describe("Relative path of the project note or folder") },
    },
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
  server.registerPrompt(
    "meeting-summary",
    {
      description: "Extracts action items and decision records from raw meeting notes",
      argsSchema: { meetingNote: z.string().describe("Relative path of the raw meeting note") },
    },
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
  server.registerPrompt(
    "vault-health-check",
    {
      description: "Audits vault hygiene for broken wikilinks and orphan notes",
    },
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
