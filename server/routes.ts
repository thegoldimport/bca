import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWaitlistSchema, insertProjectSchema, insertBlogPostSchema, insertSitePageSchema } from "@shared/schema";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { isRuntimeConfigured, runtimeAdapter, RuntimeAdapterError, type RuntimeImageAttachment } from "./runtime-adapter";
import { getPlanEntitlement } from "@shared/plans";
import {
  deploymentScriptName,
  getPublishedProjectRouteValue,
  publishedProjectUrl,
  removePublishedProjectRoute,
  restorePublishedProjectRouteValue,
  setPublishedProjectRoute,
} from "./published-routes";

const RESERVED_SUBDOMAINS = new Set(["www", "api", "app", "apps", "admin", "billing", "support", "status", "docs", "mail", "customers"]);

function projectSubdomainSlug(name: string) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "project";
}

async function availableProjectSubdomain(projectId: number, name: string) {
  const base = RESERVED_SUBDOMAINS.has(projectSubdomainSlug(name)) ? `${projectSubdomainSlug(name)}-${projectId}` : projectSubdomainSlug(name);
  const existing = await storage.getRuntimeProjectLinkBySubdomainSlug(base);
  return !existing || existing.projectId === projectId ? base : `${base.slice(0, Math.max(1, 62 - String(projectId).length))}-${projectId}`;
}

function getUserId(req: any): string | null {
  const header = req.headers["x-user-id"];
  return typeof header === "string" && header.length > 0 ? header : null;
}

async function requireProject(req: any, res: any) {
  const userId = await requireAuth(req, res);
  if (!userId) return null;
  const projectId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(projectId)) { res.status(400).json({ message: "Invalid project ID" }); return null; }
  const project = await storage.getProject(projectId);
  if (!project || project.userId !== userId) { res.status(404).json({ message: "Project not found" }); return null; }
  return project;
}

function runtimeError(err: unknown, res: any) {
  if (err instanceof RuntimeAdapterError) {
    return res.status(err.status).json({ message: err.message, code: err.code });
  }
  return res.status(502).json({ message: "VibeSDK runtime request failed", code: "RUNTIME_UPSTREAM_ERROR" });
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
      const projects = await storage.getProjectsByUser(userId);
      const runtimeLinks = await Promise.all(projects.map((project) => storage.getRuntimeProjectLink(project.id)));
      return res.json(projects.map((project, index) => ({
        ...project,
        deploymentUrl: runtimeLinks[index]?.deploymentUrl || null,
      })));
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
      const link = await storage.getRuntimeProjectLink(project.id);
      const routeValue = link?.subdomainSlug && link.deploymentUrl
        ? await getPublishedProjectRouteValue(link.subdomainSlug)
        : null;
      if (link?.subdomainSlug && link.deploymentUrl) await removePublishedProjectRoute(link.subdomainSlug);
      try {
        await storage.deleteProject(project.id);
      } catch (error) {
        if (link?.subdomainSlug && routeValue !== null) {
          try {
            await restorePublishedProjectRouteValue(link.subdomainSlug, routeValue);
          } catch (restoreError) {
            console.error("Project deletion and published-route restoration both failed", {
              projectId: project.id,
              subdomainSlug: link.subdomainSlug,
              deleteError: error,
              restoreError,
            });
            throw new RuntimeAdapterError(
              "Project deletion failed and its public route could not be restored. Support has been alerted.",
              "RUNTIME_UPSTREAM_ERROR",
            );
          }
        }
        throw error;
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── VIBESDK RUNTIME ─────────────────────────────────────────────────────────
  async function runtimeProject(project: any) {
    const link = await storage.getRuntimeProjectLink(project.id);
    return { id: project.id, name: project.name, type: project.type, description: project.description, agentId: link?.agentId || undefined };
  }

  app.get("/api/projects/:id/runtime/status", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    if (!isRuntimeConfigured()) {
      return res.status(503).json({ configured: false, code: "RUNTIME_UNCONFIGURED", message: "The VibeSDK runtime is not configured." });
    }
    try {
      const [status, link] = await Promise.all([
        runtimeAdapter.status(await runtimeProject(project)),
        storage.getRuntimeProjectLink(project.id),
      ]);
      return res.json({
        ...status,
        previewUrl: (status.state as any)?.previewUrl || link?.previewUrl || null,
        deploymentUrl: link?.deploymentUrl || null,
      });
    } catch (err) { return runtimeError(err, res); }
  });

  app.get("/api/projects/:id/runtime/files", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try { return res.json(await runtimeAdapter.files(await runtimeProject(project))); } catch (err) { return runtimeError(err, res); }
  });

  app.get("/api/projects/:id/runtime/files/content", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    const path = typeof req.query.path === "string" ? req.query.path : "";
    if (!path || path.includes("..")) return res.status(400).json({ message: "A safe file path is required" });
    try { return res.json(await runtimeAdapter.fileContent(await runtimeProject(project), path)); } catch (err) { return runtimeError(err, res); }
  });

  app.get("/api/projects/:id/runtime/console", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      const status = await runtimeAdapter.status(await runtimeProject(project));
      const state = status.state as any;
      const generation = state?.generation?.status || "idle";
      return res.json({
        lines: [
          {
            time: new Date().toLocaleTimeString(),
            type: state?.lastError ? "error" : status.connected ? "success" : "info",
            msg: state?.lastError || `Agent ${status.connected ? "connected" : "not connected"}; generation ${generation}; ${status.files} workspace files.`,
          },
        ],
      });
    } catch (err) { return runtimeError(err, res); }
  });

  app.post("/api/projects/:id/runtime/messages", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ message: "A message is required" });
    const rawImages = req.body?.images;
    if (rawImages !== undefined && !Array.isArray(rawImages)) {
      return res.status(400).json({ message: "Images must be an array" });
    }
    if ((rawImages?.length || 0) > 4) {
      return res.status(400).json({ message: "Attach no more than 4 images at a time" });
    }
    const images: RuntimeImageAttachment[] = [];
    let totalImageBytes = 0;
    for (const image of rawImages || []) {
      const validMime = ["image/png", "image/jpeg", "image/webp"].includes(image?.mimeType);
      const validFields = typeof image?.id === "string"
        && typeof image?.filename === "string"
        && image.filename.length <= 255
        && typeof image?.base64Data === "string"
        && image.base64Data.length <= 5_600_000
        && Number.isFinite(image?.size)
        && image.size >= 0
        && image.size <= 4_000_000;
      if (!validMime || !validFields) {
        return res.status(400).json({ message: "Attach PNG, JPEG, or WebP images up to 4 MB each" });
      }
      totalImageBytes += image.size;
      images.push(image as RuntimeImageAttachment);
    }
    if (totalImageBytes > 8_000_000) {
      return res.status(400).json({ message: "Image attachments must be 8 MB or less in total" });
    }
    try {
      const displayPrompt = typeof req.body?.displayMessage === "string" && req.body.displayMessage.trim()
        ? req.body.displayMessage.trim()
        : message;
      if (req.body?.mode === "plan") {
        const ref = await runtimeProject(project);
        const result = await runtimeAdapter.plan(
          ref,
          message,
          async () => (await storage.getRuntimeProjectLink(project.id))?.agentId || undefined,
          async (agentId) => (await storage.claimRuntimeProjectLink(project.id, agentId)).agentId,
          images,
        );
        const turn = await storage.createRuntimeBuilderTurn({
          projectId: project.id, mode: "plan", prompt: displayPrompt,
          response: result.message, changedFiles: [], commitHash: null,
          activity: [],
        });
        return res.json({ ...result, turn });
      }
      const ref = await runtimeProject(project);
      const result = await runtimeAdapter.generate(
        ref,
        message,
        async () => (await storage.getRuntimeProjectLink(project.id))?.agentId || undefined,
        async (agentId) => (await storage.claimRuntimeProjectLink(project.id, agentId)).agentId,
        images,
      );
      const turn = await storage.createRuntimeBuilderTurn({
        projectId: project.id, mode: "build", prompt: displayPrompt,
        response: result.message, changedFiles: result.changedFiles, commitHash: result.commitHash,
        activity: result.activity,
      });
      return res.json({ ...result, turn });
    } catch (err) { return runtimeError(err, res); }
  });

  app.get("/api/projects/:id/runtime/turns", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    return res.json({ turns: await storage.getRuntimeBuilderTurns(project.id) });
  });

  app.post("/api/projects/:id/runtime/turns/:turnId/restore", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    const turn = await storage.getRuntimeBuilderTurn(Number(req.params.turnId));
    if (!turn || turn.projectId !== project.id || !turn.commitHash) {
      return res.status(404).json({ message: "Restorable checkpoint not found" });
    }
    try {
      const result = await runtimeAdapter.restore(await runtimeProject(project), turn.commitHash);
      await storage.upsertRuntimeProjectLink(project.id, { previewUrl: result.previewUrl });
      return res.json({ ...result, turn });
    } catch (err) { return runtimeError(err, res); }
  });

  app.post("/api/projects/:id/runtime/previews", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      const result = await runtimeAdapter.preview(await runtimeProject(project));
      await storage.upsertRuntimeProjectLink(project.id, { previewUrl: result.url });
      return res.status(201).json(result);
    } catch (err) { return runtimeError(err, res); }
  });

  app.post("/api/projects/:id/runtime/stop", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      return res.json(await runtimeAdapter.stop(await runtimeProject(project)));
    } catch (err) { return runtimeError(err, res); }
  });

  app.post("/api/projects/:id/runtime/deployments", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      const settings = await storage.getRuntimeProjectLink(project.id);
      if (settings?.hostingProvider === "custom") {
        return res.status(409).json({ message: "Automatic publishing is available with BuildCustom.Ai Hosting. External hosting uses your provider's deployment process." });
      }
      if (!settings?.deploymentUrl) {
        const user = await storage.getUser(project.userId);
        const entitlement = getPlanEntitlement(user?.plan);
        const liveProjects = await storage.countLiveRuntimeProjects(project.userId);
        if (liveProjects >= entitlement.liveProjectLimit) {
          return res.status(403).json({
            code: "LIVE_PROJECT_LIMIT_REACHED",
            message: `${entitlement.name} includes ${entitlement.liveProjectLimit} live ${entitlement.liveProjectLimit === 1 ? "project" : "projects"}. Upgrade your plan or take another project offline before publishing.`,
          });
        }
      }
      const subdomainSlug = settings?.subdomainSlug || await availableProjectSubdomain(project.id, project.name);
      if (!settings?.subdomainSlug) {
        await storage.upsertRuntimeProjectLink(project.id, {
          subdomainSlug,
        });
      }
      const result = await runtimeAdapter.deploy(await runtimeProject(project));
      const scriptName = deploymentScriptName(result.workersUrl, result.url);
      const publicUrl = publishedProjectUrl(subdomainSlug);
      const seo = await storage.getSeoSettings(project.id);
      await setPublishedProjectRoute(subdomainSlug, scriptName, seo ? {
        title: seo.metaTitle,
        description: seo.metaDescription,
        canonicalUrl: seo.canonicalUrl,
        ogTitle: seo.ogTitle,
        ogDescription: seo.ogDescription,
        ogImageUrl: seo.ogImageUrl,
        faviconData: seo.faviconData,
        allowIndexing: seo.allowIndexing,
        schemaJson: seo.schemaJson,
      } : undefined);
      let release;
      try {
        ({ release } = await storage.finalizeRuntimePublish(project.id, {
          deploymentUrl: publicUrl,
          deploymentOriginUrl: result.url,
          deploymentScriptName: scriptName,
        }, result.commitHash));
      } catch (error) {
        if (settings?.deploymentScriptName) {
          await setPublishedProjectRoute(subdomainSlug, settings.deploymentScriptName, seo ? {
            title: seo.metaTitle,
            description: seo.metaDescription,
            canonicalUrl: seo.canonicalUrl,
            ogTitle: seo.ogTitle,
            ogDescription: seo.ogDescription,
            ogImageUrl: seo.ogImageUrl,
            faviconData: seo.faviconData,
            allowIndexing: seo.allowIndexing,
            schemaJson: seo.schemaJson,
          } : undefined).catch(() => undefined);
        } else {
          await removePublishedProjectRoute(subdomainSlug).catch(() => undefined);
        }
        throw error;
      }
      return res.status(201).json({ ...result, url: publicUrl, originUrl: result.url, release });
    } catch (err) { return runtimeError(err, res); }
  });

  app.get("/api/projects/:id/runtime/publishing-settings", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    const link = await storage.getRuntimeProjectLink(project.id);
    return res.json({
      subdomainSlug: link?.subdomainSlug || await availableProjectSubdomain(project.id, project.name),
      hostingProvider: !link?.hostingProvider || link.hostingProvider === "cloudflare" ? "buildcustom" : link.hostingProvider,
      customDomain: link?.customDomain || "",
      customOrigin: link?.customOrigin || "",
    });
  });

  app.put("/api/projects/:id/runtime/publishing-settings", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    const hostingProvider = ["buildcustom", "custom"].includes(req.body?.hostingProvider) ? req.body.hostingProvider : null;
    const subdomainSlug = typeof req.body?.subdomainSlug === "string" ? req.body.subdomainSlug.trim().toLowerCase() : "";
    const customDomain = typeof req.body?.customDomain === "string"
      ? req.body.customDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
      : "";
    const customOrigin = typeof req.body?.customOrigin === "string"
      ? req.body.customOrigin.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
      : "";
    if (!hostingProvider) return res.status(400).json({ message: "Choose a supported hosting provider" });
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomainSlug)) {
      return res.status(400).json({ message: "Use 1–63 lowercase letters, numbers, or hyphens for the BuildCustom.Ai subdomain" });
    }
    if (RESERVED_SUBDOMAINS.has(subdomainSlug)) {
      return res.status(400).json({ message: "That BuildCustom.Ai subdomain is reserved. Choose another name." });
    }
    const existingSubdomain = await storage.getRuntimeProjectLinkBySubdomainSlug(subdomainSlug);
    if (existingSubdomain && existingSubdomain.projectId !== project.id) {
      return res.status(409).json({ message: "That BuildCustom.Ai subdomain is already in use. Choose another name." });
    }
    if (customDomain && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(customDomain)) {
      return res.status(400).json({ message: "Enter a valid domain such as app.example.com" });
    }
    if (hostingProvider === "custom" && !customOrigin) {
      return res.status(400).json({ message: "Enter the origin hostname supplied by your external hosting provider" });
    }
    if (customOrigin && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(customOrigin)) {
      return res.status(400).json({ message: "Enter a valid hosting hostname such as project.hosting-provider.com" });
    }
    if (hostingProvider === "buildcustom" && customDomain) {
      const user = await storage.getUser(project.userId);
      const entitlement = getPlanEntitlement(user?.plan);
      if (!entitlement.managedCustomDomains) {
        return res.status(403).json({
          code: "MANAGED_CUSTOM_DOMAIN_REQUIRES_PAID_PLAN",
          message: "BuildCustom.Ai-hosted custom domains are available on Launch, Pro, and Agency plans. You can still use external hosting on the Free plan.",
        });
      }
    }
    const currentLink = await storage.getRuntimeProjectLink(project.id);
    const previousSlug = currentLink?.subdomainSlug;
    if (currentLink?.deploymentUrl && previousSlug && previousSlug !== subdomainSlug) {
      return res.status(409).json({
        code: "PUBLISHED_SUBDOMAIN_LOCKED",
        message: "The included project address is locked after the first publish.",
      });
    }
    const link = await storage.upsertRuntimeProjectLink(project.id, {
      subdomainSlug,
      hostingProvider,
      customDomain: customDomain || null,
      customOrigin: customOrigin || null,
    });
    return res.json({
      subdomainSlug: link.subdomainSlug,
      hostingProvider: link.hostingProvider,
      customDomain: link.customDomain || "",
      customOrigin: link.customOrigin || "",
    });
  });

  app.get("/api/projects/:id/runtime/releases", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    return res.json({ releases: await storage.getRuntimeReleases(project.id) });
  });

  app.post("/api/projects/:id/runtime/releases/:releaseId/restore", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    const release = await storage.getRuntimeRelease(Number(req.params.releaseId));
    if (!release || release.projectId !== project.id) return res.status(404).json({ message: "Release not found" });
    try {
      const result = await runtimeAdapter.restore(await runtimeProject(project), release.commitHash);
      await storage.upsertRuntimeProjectLink(project.id, { previewUrl: result.previewUrl });
      return res.json({ ...result, release });
    } catch (err) { return runtimeError(err, res); }
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
      return res.json(settings || {
        projectId: project.id,
        metaTitle: "",
        metaDescription: "",
        focusKeyword: "",
        schemaJson: "{}",
        faviconData: "",
        canonicalUrl: "",
        ogTitle: "",
        ogDescription: "",
        ogImageUrl: "",
        allowIndexing: true,
      });
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
      const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined;
      const update = {
        metaTitle: text(req.body?.metaTitle, 120),
        metaDescription: text(req.body?.metaDescription, 500),
        focusKeyword: text(req.body?.focusKeyword, 120),
        schemaJson: text(req.body?.schemaJson, 50_000),
        faviconData: text(req.body?.faviconData, 350_000),
        canonicalUrl: text(req.body?.canonicalUrl, 2_000),
        ogTitle: text(req.body?.ogTitle, 120),
        ogDescription: text(req.body?.ogDescription, 500),
        ogImageUrl: text(req.body?.ogImageUrl, 2_000),
        allowIndexing: typeof req.body?.allowIndexing === "boolean" ? req.body.allowIndexing : undefined,
      };
      const clean = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
      if (update.faviconData && !/^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|svg\+xml|webp);base64,/i.test(update.faviconData)) {
        return res.status(400).json({ message: "Upload a PNG, ICO, SVG, or WebP favicon." });
      }
      if (update.canonicalUrl) {
        try { new URL(update.canonicalUrl); } catch { return res.status(400).json({ message: "Enter a valid canonical URL." }); }
      }
      if (update.ogImageUrl) {
        try { new URL(update.ogImageUrl); } catch { return res.status(400).json({ message: "Enter a valid social image URL." }); }
      }
      if (update.schemaJson && update.schemaJson !== "{}") {
        try { JSON.parse(update.schemaJson); } catch { return res.status(400).json({ message: "Structured data must be valid JSON." }); }
      }
      const settings = await storage.upsertSeoSettings(project.id, clean);
      const link = await storage.getRuntimeProjectLink(project.id);
      if (link?.subdomainSlug && link.deploymentScriptName) {
        await setPublishedProjectRoute(link.subdomainSlug, link.deploymentScriptName, {
          title: settings.metaTitle,
          description: settings.metaDescription,
          canonicalUrl: settings.canonicalUrl,
          ogTitle: settings.ogTitle,
          ogDescription: settings.ogDescription,
          ogImageUrl: settings.ogImageUrl,
          faviconData: settings.faviconData,
          allowIndexing: settings.allowIndexing,
          schemaJson: settings.schemaJson,
        });
      }
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
