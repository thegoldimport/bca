CREATE TABLE IF NOT EXISTS "runtime_project_links" (
  "project_id" integer PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "agent_id" text NOT NULL UNIQUE,
  "preview_url" text,
  "deployment_url" text,
  "hosting_provider" text DEFAULT 'buildcustom' NOT NULL,
  "custom_domain" text,
  "custom_origin" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "runtime_releases" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "commit_hash" text NOT NULL,
  "deployment_url" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "runtime_builder_turns" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "mode" text DEFAULT 'build' NOT NULL,
  "prompt" text NOT NULL,
  "response" text NOT NULL,
  "changed_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "activity" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "commit_hash" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);