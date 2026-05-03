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
        name: "Portfolio Pro",
        slug: "simplefolio",
        category: "portfolio",
        description: "Clean, minimal portfolio with animated sections, project gallery, and contact form. Perfect for developers and designers.",
        framework: "HTML + CSS + JS",
        projectType: "website",
        tags: ["Vanilla JS", "Scroll Animations", "Contact Form"],
        color: "from-purple-500 to-pink-600",
        githubUrl: "https://github.com/cobiwave/simplefolio",
        forkUrl: "https://github.com/thegoldimport/simplefolio",
        featured: true,
        stars: 12800,
      },
      {
        name: "Dopefolio",
        slug: "dopefolio",
        category: "portfolio",
        description: "Dark, bold developer portfolio with project showcases, skills grid, and social links. Stands out from the crowd.",
        framework: "HTML + CSS",
        projectType: "website",
        tags: ["Dark Theme", "Responsive", "Performance"],
        color: "from-slate-600 to-gray-900",
        githubUrl: "https://github.com/rammcodes/Dopefolio",
        forkUrl: "https://github.com/thegoldimport/Dopefolio",
        featured: false,
        stars: 4200,
      },
      {
        name: "SaaS Dashboard",
        slug: "free-nextjs-admin-dashboard",
        category: "saas",
        description: "Fully-featured admin dashboard with charts, data tables, dark mode, and user management. Built with Next.js and Tailwind.",
        framework: "Next.js + Tailwind CSS",
        projectType: "saas",
        tags: ["Charts", "Dark Mode", "Auth", "Tables"],
        color: "from-cyan-500 to-blue-600",
        githubUrl: "https://github.com/TailAdmin/free-nextjs-admin-dashboard",
        forkUrl: "https://github.com/thegoldimport/free-nextjs-admin-dashboard",
        featured: true,
        stars: 5100,
      },
      {
        name: "SaaS Starter Kit",
        slug: "saas-starter-kit",
        category: "saas",
        description: "Production-ready SaaS boilerplate with auth, billing, teams, and RBAC. Jump straight to building your product.",
        framework: "Next.js + Prisma",
        projectType: "saas",
        tags: ["Auth", "Billing", "Teams", "RBAC"],
        color: "from-indigo-500 to-violet-600",
        githubUrl: "https://github.com/boxyhq/saas-starter-kit",
        forkUrl: "https://github.com/thegoldimport/saas-starter-kit",
        featured: true,
        stars: 3900,
      },
      {
        name: "AI Chat App",
        slug: "chatbot-ui",
        category: "saas",
        description: "Open-source ChatGPT-style interface with conversation history, model switching, and streaming responses.",
        framework: "Next.js + TypeScript",
        projectType: "app",
        tags: ["AI", "Streaming", "OpenAI", "History"],
        color: "from-violet-500 to-purple-600",
        githubUrl: "https://github.com/mckaywrigley/chatbot-ui",
        forkUrl: "https://github.com/thegoldimport/chatbot-ui",
        featured: true,
        stars: 28700,
      },
      {
        name: "E-Commerce Store",
        slug: "commerce",
        category: "ecommerce",
        description: "High-performance e-commerce storefront with cart, checkout, and headless CMS integration. Vercel-optimized.",
        framework: "Next.js + Shopify",
        projectType: "saas",
        tags: ["Cart", "Checkout", "Headless CMS", "ISR"],
        color: "from-emerald-500 to-teal-600",
        githubUrl: "https://github.com/vercel/commerce",
        forkUrl: "https://github.com/thegoldimport/commerce",
        featured: true,
        stars: 11200,
      },
      {
        name: "Startup Landing",
        slug: "tailwind-landing-page-template",
        category: "landing",
        description: "High-converting startup landing page with hero, features, testimonials, and pricing. React + Tailwind.",
        framework: "React + Tailwind CSS",
        projectType: "website",
        tags: ["CTA", "Pricing", "Responsive", "Animations"],
        color: "from-orange-500 to-red-600",
        githubUrl: "https://github.com/cruip/tailwind-landing-page-template",
        forkUrl: "https://github.com/thegoldimport/tailwind-landing-page-template",
        featured: false,
        stars: 6700,
      },
      {
        name: "Open Source Landing",
        slug: "open-react-template",
        category: "landing",
        description: "Modern React landing page for open-source projects and products. Clean design with feature grids and CTA sections.",
        framework: "React + Tailwind CSS",
        projectType: "website",
        tags: ["Open Source", "Features", "Clean Design"],
        color: "from-sky-500 to-blue-600",
        githubUrl: "https://github.com/cruip/open-react-template",
        forkUrl: "https://github.com/thegoldimport/open-react-template",
        featured: false,
        stars: 3300,
      },
      {
        name: "Dev Blog",
        slug: "tailwind-nextjs-starter-blog",
        category: "blog",
        description: "Markdown/MDX blog with syntax highlighting, tag filtering, RSS feed, and excellent SEO out of the box.",
        framework: "Next.js + MDX",
        projectType: "website",
        tags: ["Markdown", "SEO", "RSS", "Syntax Highlight"],
        color: "from-blue-500 to-indigo-600",
        githubUrl: "https://github.com/timlrx/tailwind-nextjs-starter-blog",
        forkUrl: "https://github.com/thegoldimport/tailwind-nextjs-starter-blog",
        featured: false,
        stars: 9400,
      },
      {
        name: "Astro Site Starter",
        slug: "astro-starter",
        category: "blog",
        description: "Blazing-fast static sites with Astro. Blog, docs, or marketing — ships near-zero JavaScript by default.",
        framework: "Astro",
        projectType: "website",
        tags: ["Static", "Fast", "SEO", "Islands"],
        color: "from-amber-500 to-orange-600",
        githubUrl: "https://github.com/withastro/astro",
        forkUrl: "https://github.com/thegoldimport/astro",
        featured: false,
        stars: 47000,
      },
      {
        name: "Job Board",
        slug: "nextjs-job-board",
        category: "business",
        description: "Full-stack job board with listings, applications, company profiles, and admin approval workflow.",
        framework: "Next.js + Prisma",
        projectType: "saas",
        tags: ["Listings", "Applications", "Admin", "Search"],
        color: "from-teal-500 to-cyan-600",
        githubUrl: "https://github.com/codinginflow/nextjs-job-board",
        forkUrl: "https://github.com/thegoldimport/nextjs-job-board",
        featured: false,
        stars: 2100,
      },
      {
        name: "2D Platformer Game",
        slug: "phaser-template-webpack",
        category: "game",
        description: "Side-scrolling platformer starter with Phaser 3, webpack bundling, physics engine, and sprite management.",
        framework: "Phaser 3 + Webpack",
        projectType: "game",
        tags: ["Canvas", "Physics", "Sprites", "Levels"],
        color: "from-yellow-500 to-orange-600",
        githubUrl: "https://github.com/phaserjs/template-webpack",
        forkUrl: "https://github.com/thegoldimport/template-webpack",
        featured: true,
        stars: 1800,
      },
      {
        name: "Next.js Starter Kit",
        slug: "precedent",
        category: "business",
        description: "Opinionated Next.js starter with auth, animations, modals, and Tailwind. Great foundation for any web app.",
        framework: "Next.js + Tailwind CSS",
        projectType: "website",
        tags: ["Auth", "Animations", "Modals", "TypeScript"],
        color: "from-rose-500 to-pink-600",
        githubUrl: "https://github.com/steven-tey/precedent",
        forkUrl: "https://github.com/thegoldimport/precedent",
        featured: false,
        stars: 5900,
      },
      {
        name: "Full-Stack App",
        slug: "taxonomy",
        category: "saas",
        description: "Shadcn-powered full-stack app with auth, subscriptions, dashboard, blog editor, and API. Ship your SaaS fast.",
        framework: "Next.js + Shadcn UI",
        projectType: "saas",
        tags: ["Auth", "Subscriptions", "Blog", "API"],
        color: "from-fuchsia-500 to-purple-600",
        githubUrl: "https://github.com/shadcn-ui/taxonomy",
        forkUrl: "https://github.com/thegoldimport/taxonomy",
        featured: false,
        stars: 18400,
      },
      {
        name: "AI Startup Landing",
        slug: "brainwave",
        category: "landing",
        description: "Stunning AI product landing page with glassmorphism effects, animated gradients, and modern UI components.",
        framework: "React + Tailwind CSS",
        projectType: "website",
        tags: ["Glassmorphism", "Gradients", "AI", "Modern"],
        color: "from-violet-600 to-indigo-700",
        githubUrl: "https://github.com/adrianhajdin/brainwave",
        forkUrl: "https://github.com/thegoldimport/brainwave",
        featured: true,
        stars: 6200,
      },
    ];

    for (const t of seed) {
      await this.upsertTemplate(t);
    }
  }
}

export const storage = new DatabaseStorage();
