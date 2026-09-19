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
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_secondary text`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS runtime_project_links_custom_domain_secondary_unique ON runtime_project_links (custom_domain_secondary) WHERE custom_domain_secondary IS NOT NULL`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_secondary_cloudflare_id text`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS runtime_project_links_custom_domain_secondary_cloudflare_id_unique ON runtime_project_links (custom_domain_secondary_cloudflare_id) WHERE custom_domain_secondary_cloudflare_id IS NOT NULL`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_secondary_status text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_secondary_ssl_status text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_secondary_dns_records jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_secondary_error text`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_secondary_checked_at timestamp`);
  await db.execute(sql`ALTER TABLE runtime_project_links ADD COLUMN IF NOT EXISTS custom_domain_migration_state jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS runtime_custom_domain_claims (
      hostname text PRIMARY KEY,
      project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('primary', 'secondary')),
      source text NOT NULL DEFAULT 'custom',
      purpose text NOT NULL DEFAULT 'website',
      hostname_kind text NOT NULL DEFAULT 'subdomain',
      is_primary boolean NOT NULL DEFAULT false,
      redirect_to text,
      cloudflare_id text,
      status text,
      ssl_status text,
      dns_records jsonb NOT NULL DEFAULT '[]'::jsonb,
      error text,
      checked_at timestamp,
      migration_state jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims DROP CONSTRAINT IF EXISTS runtime_custom_domain_claims_role_check`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'custom'`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'website'`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS hostname_kind text NOT NULL DEFAULT 'subdomain'`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS redirect_to text`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS cloudflare_id text`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS runtime_custom_domain_claims_cloudflare_id_unique ON runtime_custom_domain_claims (cloudflare_id) WHERE cloudflare_id IS NOT NULL`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS status text`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS ssl_status text`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS dns_records jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS error text`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS checked_at timestamp`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS migration_state jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await db.execute(sql`ALTER TABLE runtime_custom_domain_claims ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now()`);
  await db.execute(sql`
    INSERT INTO runtime_custom_domain_claims (hostname, project_id, role)
    SELECT custom_domain, project_id, 'primary' FROM runtime_project_links WHERE custom_domain IS NOT NULL
    ON CONFLICT (hostname) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO runtime_custom_domain_claims (hostname, project_id, role)
    SELECT custom_domain_secondary, project_id, 'secondary' FROM runtime_project_links WHERE custom_domain_secondary IS NOT NULL
    ON CONFLICT (hostname) DO NOTHING
  `);
  await db.execute(sql`
    UPDATE runtime_custom_domain_claims claims SET
      source = 'website_wizard',
      role = CASE WHEN claims.hostname = links.custom_domain_secondary THEN 'redirect' ELSE 'primary' END,
      purpose = CASE WHEN claims.hostname = links.custom_domain_secondary THEN 'redirect' ELSE 'website' END,
      is_primary = claims.hostname = links.custom_domain,
      redirect_to = CASE WHEN claims.hostname = links.custom_domain_secondary THEN links.custom_domain ELSE NULL END,
      cloudflare_id = CASE WHEN claims.hostname = links.custom_domain_secondary THEN links.custom_domain_secondary_cloudflare_id ELSE links.custom_domain_cloudflare_id END,
      status = CASE WHEN claims.hostname = links.custom_domain_secondary THEN links.custom_domain_secondary_status ELSE links.custom_domain_status END,
      ssl_status = CASE WHEN claims.hostname = links.custom_domain_secondary THEN links.custom_domain_secondary_ssl_status ELSE links.custom_domain_ssl_status END,
      dns_records = CASE WHEN claims.hostname = links.custom_domain_secondary THEN links.custom_domain_secondary_dns_records ELSE links.custom_domain_dns_records END,
      error = CASE WHEN claims.hostname = links.custom_domain_secondary THEN links.custom_domain_secondary_error ELSE links.custom_domain_error END,
      checked_at = CASE WHEN claims.hostname = links.custom_domain_secondary THEN links.custom_domain_secondary_checked_at ELSE links.custom_domain_checked_at END,
      migration_state = links.custom_domain_migration_state,
      hostname_kind = CASE
        WHEN claims.hostname LIKE 'www.%' THEN 'www'
        WHEN links.custom_domain_migration_state->>'registrableDomain' = claims.hostname THEN 'apex'
        ELSE 'subdomain'
      END,
      updated_at = now()
    FROM runtime_project_links links
    WHERE claims.project_id = links.project_id
      AND claims.source = 'custom'
      AND (claims.hostname = links.custom_domain OR claims.hostname = links.custom_domain_secondary)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS runtime_custom_domain_claims_one_primary_per_project
    ON runtime_custom_domain_claims (project_id)
    WHERE is_primary = true
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM runtime_project_links links
        LEFT JOIN runtime_custom_domain_claims primary_claim ON primary_claim.hostname = links.custom_domain
        LEFT JOIN runtime_custom_domain_claims secondary_claim ON secondary_claim.hostname = links.custom_domain_secondary
        WHERE (links.custom_domain IS NOT NULL AND primary_claim.project_id IS DISTINCT FROM links.project_id)
           OR (links.custom_domain_secondary IS NOT NULL AND secondary_claim.project_id IS DISTINCT FROM links.project_id)
      ) THEN
        RAISE EXCEPTION 'Conflicting custom-domain claims require manual resolution';
      END IF;
    END $$;
  `);
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