import pg from "pg";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url });
const tables = ["users","waitlist_entries","projects","runtime_project_links","runtime_custom_domain_claims","runtime_releases","runtime_builder_turns","blog_posts","autoblogger_settings","seo_settings","site_pages","templates"];
const exported: Record<string, unknown[]> = {};
for (const table of tables) {
  const result = await pool.query(`SELECT * FROM "${table}" ORDER BY 1`);
  exported[table] = result.rows;
}
const payload = JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), tables: exported }, null, 2);
const manifest = { sha256: createHash("sha256").update(payload).digest("hex"), rowCounts: Object.fromEntries(Object.entries(exported).map(([k,v]) => [k,v.length])) };
await writeFile(process.argv[2] || "control-plane-export.json", JSON.stringify({ ...JSON.parse(payload), manifest }, null, 2), { mode: 0o600 });
await pool.end();
console.log(JSON.stringify(manifest));