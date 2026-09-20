import { readFile } from "node:fs/promises";
const file = process.argv[2] || "control-plane-export.json";
const input = JSON.parse(await readFile(file, "utf8"));
const tables = input.tables || {};
const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, (rows as unknown[]).length]));
for (const [name, expected] of Object.entries(input.manifest?.rowCounts || {})) {
  if (counts[name] !== expected) throw new Error(`ROW_COUNT_MISMATCH:${name}`);
}
const projects = (tables.projects || []) as Array<{id:number;user_id:string}>;
const users = new Set((tables.users || []).map((u: any) => u.id));
for (const project of projects) if (!users.has(project.user_id)) throw new Error(`FOREIGN_KEY_MISMATCH:projects.user_id:${project.id}`);
console.log(JSON.stringify({ valid: true, rowCounts: counts, importedAgentIds: (tables.runtime_project_links || []).filter((l: any) => l.agent_id).length }));