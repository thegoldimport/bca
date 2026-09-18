import { sql } from "drizzle-orm";
import { db } from "./db";

export async function ensureRuntimeSchema() {
  await db.execute(sql`ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'free'`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS runtime_project_links (
      project_id integer PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      agent_id text NOT NULL UNIQUE,
      preview_url text,
      deployment_url text,
      deployment_origin_url text,
      deployment_script_name text,
      subdomain_slug text UNIQUE,
      hosting_provider text NOT NULL DEFAULT 'buildcustom',
      custom_domain text,
      custom_origin text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS deployment_origin_url text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ALTER COLUMN agent_id DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS deployment_script_name text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS subdomain_slug text`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS runtime_project_links_subdomain_slug_unique ON runtime_project_links (subdomain_slug) WHERE subdomain_slug IS NOT NULL`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS hosting_provider text NOT NULL DEFAULT 'buildcustom'`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_origin text`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS favicon_data text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS canonical_url text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS og_title text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS og_description text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS og_image_url text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS allow_indexing boolean NOT NULL DEFAULT true`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS runtime_builder_turns (
      id serial PRIMARY KEY,
      project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      mode text NOT NULL DEFAULT 'build',
      prompt text NOT NULL,
      response text NOT NULL,
      changed_files jsonb NOT NULL DEFAULT '[]'::jsonb,
      activity jsonb NOT NULL DEFAULT '[]'::jsonb,
      commit_hash text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    ALTER TABLE runtime_builder_turns
    ADD COLUMN IF NOT EXISTS activity jsonb NOT NULL DEFAULT '[]'::jsonb
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS runtime_releases (
      id serial PRIMARY KEY,
      project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      commit_hash text NOT NULL,
      deployment_url text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
}