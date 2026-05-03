import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWaitlistSchema, insertProjectSchema, insertBlogPostSchema, insertSitePageSchema } from "@shared/schema";
import bcrypt from "bcryptjs";
import { z } from "zod";

function getUserId(req: any): string | null {
  const header = req.headers["x-user-id"];
  return typeof header === "string" && header.length > 0 ? header : null;
}

async function requireAuth(req: any, res: any): Promise<string | null> {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ message: "Unauthorized" }); return null; }
  const user = await storage.getUser(userId);
  if (!user) { res.status(401).json({ message: "Unauthorized" }); return null; }
  return userId;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ── AUTH ───────────────────────────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) return res.status(400).json({ message: "Name, email and password are required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "An account with this email already exists" });
      const hashed = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username: name, email, password: hashed });
      const { password: _, ...safe } = user;
      return res.status(201).json(safe);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ message: "Invalid email or password" });
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ message: "Invalid email or password" });
      const { password: _, ...safe } = user;
      return res.json(safe);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const { password: _, ...safe } = user;
      return res.json(safe);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/auth/profile", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const { name, email } = req.body;
      if (!name && !email) return res.status(400).json({ message: "Nothing to update" });
      if (email) {
        const existing = await storage.getUserByEmail(email);
        if (existing && existing.id !== userId) return res.status(409).json({ message: "Email already in use" });
      }
      const updated = await storage.updateUser(userId, {
        ...(name ? { username: name } : {}),
        ...(email ? { email } : {}),
      });
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safe } = updated;
      return res.json(safe);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/auth/password", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ message: "Current and new passwords are required" });
      if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(401).json({ message: "Current password is incorrect" });
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(userId, { password: hashed });
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── ADMIN AUTH ─────────────────────────────────────────────────────────────
  app.post("/api/admin/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password are required" });
    const adminUser = process.env.ADMIN_USERNAME || "admin";
    const adminPass = process.env.ADMIN_PASSWORD || "Stayclassy99";
    if (username === adminUser && password === adminPass) return res.json({ success: true });
    return res.status(401).json({ message: "Invalid credentials" });
  });

  // ── WAITLIST ───────────────────────────────────────────────────────────────
  app.post("/api/waitlist", async (req, res) => {
    try {
      const parsed = insertWaitlistSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
      const entry = await storage.createWaitlistEntry(parsed.data);
      return res.status(201).json(entry);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/waitlist", async (req, res) => {
    try {
      return res.json(await storage.getAllWaitlistEntries());
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/waitlist/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      await storage.deleteWaitlistEntry(id);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/waitlist/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      if (isNaN(id) || !status) return res.status(400).json({ message: "Invalid request" });
      const updated = await storage.updateWaitlistEntryStatus(id, status);
      if (!updated) return res.status(404).json({ message: "Entry not found" });
      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── PROJECTS ───────────────────────────────────────────────────────────────
  app.get("/api/projects", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      return res.json(await storage.getProjectsByUser(userId));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const parsed = insertProjectSchema.safeParse({ ...req.body, userId });
      if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
      const project = await storage.createProject(parsed.data);
      return res.status(201).json(project);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      return res.json(project);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const updated = await storage.updateProject(project.id, req.body);
      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      await storage.deleteProject(project.id);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── BLOG POSTS ─────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/blog-posts", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      return res.json(await storage.getBlogPosts(project.id));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects/:id/blog-posts", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const slug = req.body.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `post-${Date.now()}`;
      const wordCount = req.body.content ? req.body.content.split(/\s+/).length : 0;
      const post = await storage.createBlogPost({ ...req.body, projectId: project.id, slug, wordCount });
      return res.status(201).json(post);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/projects/:id/blog-posts/:postId", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const wordCount = req.body.content ? req.body.content.split(/\s+/).length : undefined;
      const updated = await storage.updateBlogPost(parseInt(req.params.postId), { ...req.body, ...(wordCount !== undefined ? { wordCount } : {}) });
      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/projects/:id/blog-posts/:postId", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      await storage.deleteBlogPost(parseInt(req.params.postId));
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── AUTOBLOGGER ────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/autoblogger", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const settings = await storage.getAutobloggerSettings(project.id);
      return res.json(settings || { projectId: project.id, enabled: false, postsPerDay: 3, writingStyle: "neil-patel", minWordCount: 2000, keywords: "" });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/projects/:id/autoblogger", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const settings = await storage.upsertAutobloggerSettings(project.id, req.body);
      return res.json(settings);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── SEO ────────────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/seo", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const settings = await storage.getSeoSettings(project.id);
      return res.json(settings || { projectId: project.id, metaTitle: "", metaDescription: "", focusKeyword: "", schemaJson: "{}" });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/projects/:id/seo", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const settings = await storage.upsertSeoSettings(project.id, req.body);
      return res.json(settings);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── SITE PAGES ─────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/pages", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      return res.json(await storage.getSitePages(project.id));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects/:id/pages", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const page = await storage.createSitePage({ ...req.body, projectId: project.id });
      return res.status(201).json(page);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/projects/:id/pages/:pageId", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const updated = await storage.updateSitePage(parseInt(req.params.pageId), req.body);
      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/projects/:id/pages/:pageId", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      await storage.deleteSitePage(parseInt(req.params.pageId));
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── TEMPLATES ──────────────────────────────────────────────────────────────
  app.get("/api/templates", async (req, res) => {
    try {
      const allTemplates = await storage.getAllTemplates();
      if (allTemplates.length === 0) {
        await storage.seedTemplates();
        return res.json(await storage.getAllTemplates());
      }
      return res.json(allTemplates);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/templates/:slug", async (req, res) => {
    try {
      const template = await storage.getTemplateBySlug(req.params.slug);
      if (!template) return res.status(404).json({ message: "Template not found" });
      return res.json(template);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
