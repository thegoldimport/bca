import { chmod, readFile, writeFile } from "node:fs/promises";

const source = process.argv[2];
const destination = process.argv[3];
if (!source || !destination) {
  throw new Error("Usage: tsx scripts/build-d1-import.ts <export.json> <import.sql>");
}

const input = JSON.parse(await readFile(source, "utf8")) as {
  tables: Record<string, Array<Record<string, unknown>>>;
};

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replaceAll("'", "''")}'`;
}

const orderedTables = [
  "users",
  "waitlist_entries",
  "projects",
  "runtime_project_links",
  "runtime_custom_domain_claims",
  "runtime_releases",
  "runtime_builder_turns",
  "blog_posts",
  "autoblogger_settings",
  "seo_settings",
  "site_pages",
  "templates",
];

const statements = ["PRAGMA foreign_keys = ON;"];
for (const table of orderedTables) {
  for (const original of input.tables[table] || []) {
    const row = { ...original };
    if (table === "runtime_project_links") row.agent_is_imported = row.agent_id ? 1 : 0;
    const columns = Object.keys(row);
    statements.push(
      `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map((column) => sqlValue(row[column])).join(",")});`,
    );
  }
}
statements.push("PRAGMA foreign_key_check;");

await writeFile(destination, `${statements.join("\n")}\n`, { mode: 0o600 });
await chmod(destination, 0o600);
console.log(JSON.stringify({
  tables: orderedTables.length,
  rows: orderedTables.reduce((total, table) => total + (input.tables[table]?.length || 0), 0),
}));