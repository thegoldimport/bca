import {
  type User, type InsertUser,
  type WaitlistEntry, type InsertWaitlistEntry,
  type Project, type InsertProject,
  type BlogPost, type InsertBlogPost,
  type AutobloggerSettings, type SeoSettings,
  type SitePage, type InsertSitePage,
  type Template, type InsertTemplate,
  users, waitlistEntries, projects, blogPosts,
  autobloggerSettings, seoSettings, sitePages, templates,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  // Waitlist
  createWaitlistEntry(entry: InsertWaitlistEntry): Promise<WaitlistEntry>;
  getAllWaitlistEntries(): Promise<WaitlistEntry[]>;
  deleteWaitlistEntry(id: number): Promise<void>;
  updateWaitlistEntryStatus(id: number, status: string): Promise<WaitlistEntry | undefined>;
  // Projects
  getProjectsByUser(userId: string): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;
  // Blog Posts
  getBlogPosts(projectId: number): Promise<BlogPost[]>;
  getBlogPost(id: number): Promise<BlogPost | undefined>;
  createBlogPost(post: InsertBlogPost): Promise<BlogPost>;
  updateBlogPost(id: number, data: Partial<InsertBlogPost>): Promise<BlogPost | undefined>;
  deleteBlogPost(id: number): Promise<void>;
  // Autoblogger Settings
  getAutobloggerSettings(projectId: number): Promise<AutobloggerSettings | undefined>;
  upsertAutobloggerSettings(projectId: number, data: Partial<AutobloggerSettings>): Promise<AutobloggerSettings>;
  // SEO Settings
  getSeoSettings(projectId: number): Promise<SeoSettings | undefined>;
  upsertSeoSettings(projectId: number, data: Partial<SeoSettings>): Promise<SeoSettings>;
  // Site Pages
  getSitePages(projectId: number): Promise<SitePage[]>;
  createSitePage(page: InsertSitePage): Promise<SitePage>;
  updateSitePage(id: number, data: Partial<InsertSitePage>): Promise<SitePage | undefined>;
  deleteSitePage(id: number): Promise<void>;
  // Templates
  getAllTemplates(): Promise<Template[]>;
  getTemplateBySlug(slug: string): Promise<Template | undefined>;
  upsertTemplate(template: InsertTemplate): Promise<Template>;
  seedTemplates(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByUsername(username: string) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }
  async getUserByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }
  async createUser(insertUser: InsertUser) {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createWaitlistEntry(entry: InsertWaitlistEntry) {
    const [result] = await db.insert(waitlistEntries).values(entry).returning();
    return result;
  }
  async getAllWaitlistEntries() {
    return db.select().from(waitlistEntries).orderBy(desc(waitlistEntries.createdAt));
  }
  async deleteWaitlistEntry(id: number) {
    await db.delete(waitlistEntries).where(eq(waitlistEntries.id, id));
  }
  async updateWaitlistEntryStatus(id: number, status: string) {
    const [result] = await db.update(waitlistEntries).set({ status }).where(eq(waitlistEntries.id, id)).returning();
    return result;
  }

  async getProjectsByUser(userId: string) {
    return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
  }
  async getProject(id: number) {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }
  async createProject(project: InsertProject) {
    const [result] = await db.insert(projects).values(project).returning();
    return result;
  }
  async updateProject(id: number, data: Partial<InsertProject>) {
    const [result] = await db.update(projects).set({ ...data, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    return result;
  }
  async deleteProject(id: number) {
    await db.delete(projects).where(eq(projects.id, id));
  }

  async getBlogPosts(projectId: number) {
    return db.select().from(blogPosts).where(eq(blogPosts.projectId, projectId)).orderBy(desc(blogPosts.createdAt));
  }
  async getBlogPost(id: number) {
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    return post;
  }
  async createBlogPost(post: InsertBlogPost) {
    const [result] = await db.insert(blogPosts).values(post).returning();
    return result;
  }
  async updateBlogPost(id: number, data: Partial<InsertBlogPost>) {
    const [result] = await db.update(blogPosts).set(data).where(eq(blogPosts.id, id)).returning();
    return result;
  }
  async deleteBlogPost(id: number) {
    await db.delete(blogPosts).where(eq(blogPosts.id, id));
  }

  async getAutobloggerSettings(projectId: number) {
    const [result] = await db.select().from(autobloggerSettings).where(eq(autobloggerSettings.projectId, projectId));
    return result;
  }
  async upsertAutobloggerSettings(projectId: number, data: Partial<AutobloggerSettings>) {
    const existing = await this.getAutobloggerSettings(projectId);
    if (existing) {
      const [result] = await db.update(autobloggerSettings).set({ ...data, updatedAt: new Date() }).where(eq(autobloggerSettings.projectId, projectId)).returning();
      return result;
    } else {
      const [result] = await db.insert(autobloggerSettings).values({ projectId, ...data } as any).returning();
      return result;
    }
  }

  async getSeoSettings(projectId: number) {
    const [result] = await db.select().from(seoSettings).where(eq(seoSettings.projectId, projectId));
    return result;
  }
  async upsertSeoSettings(projectId: number, data: Partial<SeoSettings>) {
    const existing = await this.getSeoSettings(projectId);
    if (existing) {
      const [result] = await db.update(seoSettings).set({ ...data, updatedAt: new Date() }).where(eq(seoSettings.projectId, projectId)).returning();
      return result;
    } else {
      const [result] = await db.insert(seoSettings).values({ projectId, ...data } as any).returning();
      return result;
    }
  }

  async getSitePages(projectId: number) {
    return db.select().from(sitePages).where(eq(sitePages.projectId, projectId)).orderBy(sitePages.createdAt);
  }
  async createSitePage(page: InsertSitePage) {
    const [result] = await db.insert(sitePages).values(page).returning();
    return result;
  }
  async updateSitePage(id: number, data: Partial<InsertSitePage>) {
    const [result] = await db.update(sitePages).set(data).where(eq(sitePages.id, id)).returning();
    return result;
  }
  async deleteSitePage(id: number) {
    await db.delete(sitePages).where(eq(sitePages.id, id));
  }

  async getAllTemplates() {
    return db.select().from(templates).orderBy(templates.id);
  }
  async getTemplateBySlug(slug: string) {
    const [result] = await db.select().from(templates).where(eq(templates.slug, slug));
    return result;
  }
  async upsertTemplate(template: InsertTemplate) {
    const existing = await this.getTemplateBySlug(template.slug);
    if (existing) {
      const [result] = await db.update(templates).set(template).where(eq(templates.slug, template.slug)).returning();
      return result;
    }
    const [result] = await db.insert(templates).values(template).returning();
    return result;
  }
  async seedTemplates() {
    const seed: InsertTemplate[] = [
      {
        name: "Next.js SaaS Boilerplate",
        slug: "saas-boilerplate",
        category: "saas",
        description: "Production-ready SaaS starter — auth, Stripe billing, dashboard, i18n, and Tailwind. Skip the setup, build the product.",
        framework: "Next.js + Stripe + TypeScript",
        projectType: "saas",
        tags: ["Auth", "Stripe", "Dashboard", "i18n"],
        color: "from-cyan-500 to-blue-600",
        githubUrl: "https://github.com/ixartz/SaaS-Boilerplate",
        forkUrl: "https://github.com/thegoldimport/SaaS-Boilerplate",
        featured: true,
        stars: 3500,
      },
      {
        name: "T3 Stack App",
        slug: "create-t3-app",
        category: "saas",
        description: "The gold standard full-stack TypeScript starter — tRPC, Prisma, NextAuth, and Tailwind wired together perfectly.",
        framework: "Next.js + tRPC + Prisma",
        projectType: "saas",
        tags: ["TypeScript", "tRPC", "Prisma", "NextAuth"],
        color: "from-violet-500 to-purple-700",
        githubUrl: "https://github.com/t3-oss/create-t3-app",
        forkUrl: "https://github.com/thegoldimport/create-t3-app",
        featured: true,
        stars: 24000,
      },
      {
        name: "Multi-Tenant SaaS Platform",
        slug: "platforms",
        category: "saas",
        description: "Build your own Notion, Hashnode, or Webflow. Multi-tenant Next.js with custom subdomains and per-tenant routing.",
        framework: "Next.js + Vercel",
        projectType: "saas",
        tags: ["Multi-tenant", "Subdomains", "Auth", "CMS"],
        color: "from-black to-gray-700",
        githubUrl: "https://github.com/vercel/platforms",
        forkUrl: "https://github.com/thegoldimport/platforms",
        featured: true,
        stars: 10000,
      },
      {
        name: "Full-Stack SaaS App",
        slug: "taxonomy",
        category: "saas",
        description: "Shadcn/ui-powered app with auth, Stripe subscriptions, markdown blog editor, and REST API. The complete SaaS blueprint.",
        framework: "Next.js + Shadcn UI + Stripe",
        projectType: "saas",
        tags: ["Auth", "Subscriptions", "Blog Editor", "API"],
        color: "from-fuchsia-500 to-purple-600",
        githubUrl: "https://github.com/shadcn-ui/taxonomy",
        forkUrl: "https://github.com/thegoldimport/taxonomy",
        featured: false,
        stars: 18400,
      },
      {
        name: "NextChat — AI Chat App",
        slug: "nextchat",
        category: "ai",
        description: "ChatGPT-style interface with multi-model support, conversation history, prompt templates, and self-hosted API key management.",
        framework: "Next.js + TypeScript",
        projectType: "app",
        tags: ["AI", "Multi-model", "Streaming", "Self-hosted"],
        color: "from-blue-500 to-indigo-600",
        githubUrl: "https://github.com/ChatGPTNextWeb/NextChat",
        forkUrl: "https://github.com/thegoldimport/NextChat",
        featured: true,
        stars: 78000,
      },
      {
        name: "Novel — AI Writing Editor",
        slug: "novel",
        category: "ai",
        description: "Notion-style WYSIWYG editor with AI autocomplete. Slash commands, rich text, and OpenAI streaming built in.",
        framework: "Next.js + Tiptap",
        projectType: "app",
        tags: ["AI Autocomplete", "Rich Text", "Tiptap", "OpenAI"],
        color: "from-emerald-500 to-teal-600",
        githubUrl: "https://github.com/steven-tey/novel",
        forkUrl: "https://github.com/thegoldimport/novel",
        featured: true,
        stars: 13000,
      },
      {
        name: "Chatbot UI",
        slug: "chatbot-ui",
        category: "ai",
        description: "Open-source ChatGPT UI with conversation folders, model switching, system prompts, and streaming. Clean and extensible.",
        framework: "Next.js + TypeScript",
        projectType: "app",
        tags: ["ChatGPT UI", "Streaming", "Folders", "OpenAI"],
        color: "from-violet-500 to-purple-600",
        githubUrl: "https://github.com/mckaywrigley/chatbot-ui",
        forkUrl: "https://github.com/thegoldimport/chatbot-ui",
        featured: false,
        stars: 28700,
      },
      {
        name: "Chatwoot — Customer Support",
        slug: "chatwoot",
        category: "saas",
        description: "Open-source Intercom & Zendesk alternative. Multi-channel inbox, live chat, canned responses, reports, and team inbox.",
        framework: "Rails + Vue.js",
        projectType: "saas",
        tags: ["Live Chat", "Inbox", "Multi-channel", "Reports"],
        color: "from-teal-500 to-cyan-600",
        githubUrl: "https://github.com/chatwoot/chatwoot",
        forkUrl: "https://github.com/thegoldimport/chatwoot",
        featured: false,
        stars: 22000,
      },
      {
        name: "Infisical — Secrets Manager",
        slug: "infisical",
        category: "devtools",
        description: "Open-source HashiCorp Vault alternative. Manage env vars and secrets across teams, environments, and CI/CD pipelines.",
        framework: "Next.js + Node.js + MongoDB",
        projectType: "saas",
        tags: ["Secrets", "Env Vars", "CI/CD", "Team Access"],
        color: "from-yellow-500 to-orange-600",
        githubUrl: "https://github.com/Infisical/infisical",
        forkUrl: "https://github.com/thegoldimport/infisical",
        featured: false,
        stars: 16000,
      },
      {
        name: "Ignite — React Native Starter",
        slug: "ignite",
        category: "mobile",
        description: "Battle-tested React Native boilerplate from Infinite Red. Navigation, state, auth, and testing all pre-wired.",
        framework: "React Native + Expo",
        projectType: "app",
        tags: ["React Native", "Navigation", "MobX-State-Tree", "Expo"],
        color: "from-rose-500 to-red-600",
        githubUrl: "https://github.com/infinitered/ignite",
        forkUrl: "https://github.com/thegoldimport/ignite",
        featured: true,
        stars: 18000,
      },
      {
        name: "Desktop App Starter",
        slug: "electron-react-boilerplate",
        category: "desktop",
        description: "Electron + React boilerplate with webpack, hot reload, auto-update, and native packaging. Ship cross-platform desktop apps fast.",
        framework: "Electron + React + Webpack",
        projectType: "app",
        tags: ["Electron", "Cross-platform", "Auto-update", "Native"],
        color: "from-slate-500 to-gray-700",
        githubUrl: "https://github.com/electron-react-boilerplate/electron-react-boilerplate",
        forkUrl: "https://github.com/thegoldimport/electron-react-boilerplate",
        featured: false,
        stars: 22000,
      },
      {
        name: "Medusa — Headless Commerce",
        slug: "medusa",
        category: "ecommerce",
        description: "Open-source Shopify alternative. Modular headless commerce engine with payments, inventory, fulfillment, and a storefront.",
        framework: "Node.js + Next.js",
        projectType: "saas",
        tags: ["Shopify Alternative", "Payments", "Inventory", "Headless"],
        color: "from-emerald-600 to-green-700",
        githubUrl: "https://github.com/medusajs/medusa",
        forkUrl: "https://github.com/thegoldimport/medusa",
        featured: true,
        stars: 24000,
      },
      {
        name: "Hoppscotch — API Tool",
        slug: "hoppscotch",
        category: "devtools",
        description: "Open-source Postman alternative. REST, GraphQL, WebSocket, and SSE testing in a beautiful browser-first interface.",
        framework: "Vue.js + TypeScript",
        projectType: "app",
        tags: ["REST", "GraphQL", "WebSocket", "API Testing"],
        color: "from-green-500 to-emerald-600",
        githubUrl: "https://github.com/hoppscotch/hoppscotch",
        forkUrl: "https://github.com/thegoldimport/hoppscotch",
        featured: true,
        stars: 65000,
      },
      {
        name: "Excalidraw — Whiteboard",
        slug: "excalidraw",
        category: "app",
        description: "Virtual collaborative whiteboard with hand-drawn style. Real-time multiplayer, infinite canvas, and exportable diagrams.",
        framework: "React + TypeScript",
        projectType: "app",
        tags: ["Collaborative", "Real-time", "Infinite Canvas", "Diagrams"],
        color: "from-amber-500 to-yellow-600",
        githubUrl: "https://github.com/excalidraw/excalidraw",
        forkUrl: "https://github.com/thegoldimport/excalidraw",
        featured: true,
        stars: 89000,
      },
      {
        name: "Actual — Personal Finance",
        slug: "actual",
        category: "app",
        description: "Local-first personal finance app with budgeting, account sync, and reports. A privacy-first YNAB/Mint alternative.",
        framework: "React + Node.js",
        projectType: "app",
        tags: ["Budgeting", "Local-first", "Privacy", "Finance"],
        color: "from-indigo-500 to-blue-700",
        githubUrl: "https://github.com/actualbudget/actual",
        forkUrl: "https://github.com/thegoldimport/actual",
        featured: false,
        stars: 14000,
      },
    ];

    for (const t of seed) {
      await this.upsertTemplate(t);
    }
  }
}

export const storage = new DatabaseStorage();
