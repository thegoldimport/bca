import {
  type User, type InsertUser,
  type WaitlistEntry, type InsertWaitlistEntry,
  type Project, type InsertProject,
  type BlogPost, type InsertBlogPost,
  type AutobloggerSettings, type SeoSettings,
  type SitePage, type InsertSitePage,
  users, waitlistEntries, projects, blogPosts,
  autobloggerSettings, seoSettings, sitePages,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
