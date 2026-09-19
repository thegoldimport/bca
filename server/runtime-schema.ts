import { sql } from "drizzle-orm";
import { db } from "./db";

export async function ensureRuntimeSchema() {
  await db.execute(sql`ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'free'`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_single_super_admin ON users (role) WHERE role = 'super_admin'`);
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
      custom_domain text UNIQUE,
      custom_origin text,
      custom_domain_cloudflare_id text UNIQUE,
      custom_domain_status text,
      custom_domain_ssl_status text,
      custom_domain_dns_records jsonb NOT NULL DEFAULT '[]'::jsonb,
      custom_domain_error text,
      custom_domain_checked_at timestamp,
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
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS runtime_project_links_custom_domain_unique ON runtime_project_links (custom_domain) WHERE custom_domain IS NOT NULL`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_cloudflare_id text`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS runtime_project_links_custom_domain_cloudflare_id_unique ON runtime_project_links (custom_domain_cloudflare_id) WHERE custom_domain_cloudflare_id IS NOT NULL`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_status text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_ssl_status text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_dns_records jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_error text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_checked_at timestamp`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS favicon_data text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS seo_keywords text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS long_tail_keywords text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS canonical_url text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS og_title text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS og_description text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS og_image_url text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS preview_image_data text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE seo_settings ADD COLUMN IF NOT EXISTS social_image_data text NOT NULL DEFAULT ''`);
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