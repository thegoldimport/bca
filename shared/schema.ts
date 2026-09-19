import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique().default(""),
  plan: text("plan").notNull().default("free"),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const waitlistEntries = pgTable("waitlist_entries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  source: text("source").notNull().default("waitlist"),
  status: text("status").notNull().default("Pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("website"),
  status: text("status").notNull().default("draft"),
  description: text("description").notNull().default(""),
  framework: text("framework").notNull().default("React + TailwindCSS"),
  url: text("url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const runtimeProjectLinks = pgTable("runtime_project_links", {
  projectId: integer("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  agentId: text("agent_id").unique(),
  previewUrl: text("preview_url"),
  deploymentUrl: text("deployment_url"),
  deploymentOriginUrl: text("deployment_origin_url"),
  deploymentScriptName: text("deployment_script_name"),
  subdomainSlug: text("subdomain_slug").unique(),
  hostingProvider: text("hosting_provider").notNull().default("buildcustom"),
  customDomain: text("custom_domain").unique(),
  customOrigin: text("custom_origin"),
  customDomainCloudflareId: text("custom_domain_cloudflare_id").unique(),
  customDomainStatus: text("custom_domain_status"),
  customDomainSslStatus: text("custom_domain_ssl_status"),
  customDomainDnsRecords: jsonb("custom_domain_dns_records").$type<Array<{ type: string; name: string; value: string }>>().notNull().default([]),
  customDomainError: text("custom_domain_error"),
  customDomainCheckedAt: timestamp("custom_domain_checked_at"),
  customDomainSecondary: text("custom_domain_secondary").unique(),
  customDomainSecondaryCloudflareId: text("custom_domain_secondary_cloudflare_id").unique(),
  customDomainSecondaryStatus: text("custom_domain_secondary_status"),
  customDomainSecondarySslStatus: text("custom_domain_secondary_ssl_status"),
  customDomainSecondaryDnsRecords: jsonb("custom_domain_secondary_dns_records").$type<Array<{ type: string; name: string; value: string }>>().notNull().default([]),
  customDomainSecondaryError: text("custom_domain_secondary_error"),
  customDomainSecondaryCheckedAt: timestamp("custom_domain_secondary_checked_at"),
  customDomainMigrationState: jsonb("custom_domain_migration_state").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const runtimeCustomDomainClaims = pgTable("runtime_custom_domain_claims", {
  hostname: text("hostname").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  source: text("source").notNull().default("custom"),
  purpose: text("purpose").notNull().default("website"),
  hostnameKind: text("hostname_kind").notNull().default("subdomain"),
  isPrimary: boolean("is_primary").notNull().default(false),
  redirectTo: text("redirect_to"),
  cloudflareId: text("cloudflare_id").unique(),
  status: text("status"),
  sslStatus: text("ssl_status"),
  dnsRecords: jsonb("dns_records").$type<Array<{ type: string; name: string; value: string }>>().notNull().default([]),
  error: text("error"),
  checkedAt: timestamp("checked_at"),
  migrationState: jsonb("migration_state").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const runtimeReleases = pgTable("runtime_releases", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  commitHash: text("commit_hash").notNull(),
  deploymentUrl: text("deployment_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const runtimeBuilderTurns = pgTable("runtime_builder_turns", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("build"),
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  changedFiles: jsonb("changed_files").$type<Array<{ path: string; change: string; size: number }>>().notNull().default([]),
  activity: jsonb("activity").$type<Array<{ type: string; label: string; path?: string; status?: string; createdAt: string }>>().notNull().default([]),
  commitHash: text("commit_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blogPosts = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  content: text("content").notNull().default(""),
  status: text("status").notNull().default("draft"),
  keyword: text("keyword").notNull().default(""),
  wordCount: integer("word_count").notNull().default(0),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const autobloggerSettings = pgTable("autoblogger_settings", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  postsPerDay: integer("posts_per_day").notNull().default(3),
  writingStyle: text("writing_style").notNull().default("neil-patel"),
  minWordCount: integer("min_word_count").notNull().default(2000),
  keywords: text("keywords").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const seoSettings = pgTable("seo_settings", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
  metaTitle: text("meta_title").notNull().default(""),
  metaDescription: text("meta_description").notNull().default(""),
  focusKeyword: text("focus_keyword").notNull().default(""),
  seoKeywords: text("seo_keywords").notNull().default(""),
  longTailKeywords: text("long_tail_keywords").notNull().default(""),
  schemaJson: text("schema_json").notNull().default("{}"),
  faviconData: text("favicon_data").notNull().default(""),
  canonicalUrl: text("canonical_url").notNull().default(""),
  ogTitle: text("og_title").notNull().default(""),
  ogDescription: text("og_description").notNull().default(""),
  ogImageUrl: text("og_image_url").notNull().default(""),
  previewImageData: text("preview_image_data").notNull().default(""),
  socialImageData: text("social_image_data").notNull().default(""),
  allowIndexing: boolean("allow_indexing").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sitePages = pgTable("site_pages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("draft"),
  pageType: text("page_type").notNull().default("standard"),
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  framework: text("framework").notNull().default(""),
  projectType: text("project_type").notNull().default("website"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  color: text("color").notNull().default("from-cyan-500 to-blue-600"),
  githubUrl: text("github_url").notNull().default(""),
  forkUrl: text("fork_url").notNull().default(""),
  featured: boolean("featured").notNull().default(false),
  stars: integer("stars").notNull().default(0),
});

export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true, email: true });
export const insertWaitlistSchema = createInsertSchema(waitlistEntries).pick({ name: true, email: true, source: true });
export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBlogPostSchema = createInsertSchema(blogPosts).omit({ id: true, createdAt: true });
export const insertSitePageSchema = createInsertSchema(sitePages).omit({ id: true, createdAt: true });
export const insertTemplateSchema = createInsertSchema(templates).omit({ id: true });
export type Template = typeof templates.$inferSelect;
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistSchema>;
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
export type RuntimeProjectLink = typeof runtimeProjectLinks.$inferSelect;
export type RuntimeRelease = typeof runtimeReleases.$inferSelect;
export type RuntimeBuilderTurn = typeof runtimeBuilderTurns.$inferSelect;
export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;
export type BlogPost = typeof blogPosts.$inferSelect;
export type AutobloggerSettings = typeof autobloggerSettings.$inferSelect;
export type SeoSettings = typeof seoSettings.$inferSelect;
export type SitePage = typeof sitePages.$inferSelect;
export type InsertSitePage = z.infer<typeof insertSitePageSchema>;
