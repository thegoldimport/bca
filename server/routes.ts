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
  removePublishedCustomHostname,
  setPublishedProjectPreviewImage,
  setPublishedCustomHostname,
  setPublishedProjectRoute,
} from "./published-routes";
import { generateSeoSuggestions, isSeoContextPath, rankSeoContextPath } from "./seo-suggestions";
import { deleteProjectAndPublishedRoute, PublishedRouteRestoreError } from "./project-deletion";
import { savePublishingSettings } from "./publishing-settings";
import { captureProjectPreviewImage } from "./project-preview-image";
import { pool } from "./db";
import {
  createCustomHostname,
  customDomainUpdate,
  deleteCustomHostname,
  getCustomHostname,
  normalizeCustomDomain,
  classifyHostname,
  inspectPublicDns,
  parseCloudflareDnsImport,
  compareCloudflareDnsImport,
  validateExpectedNameservers,
  checkNameserverActivation,
  routingStatusAfterVerification,
  verifyCustomDomainRouting,
  validateApplicationHostname,
} from "./custom-domains";
import {
  configurePrimaryDomainPair,
  domainRoutingContext,
  listDomains,
  updateDomainLifecycle,
} from "./domain-service";

const RESERVED_SUBDOMAINS = new Set(["www", "api", "app", "apps", "admin", "billing", "support", "status", "docs", "mail", "customers"]);
const CUSTOM_DOMAIN_LOCK_NAMESPACE = 1_116_313_668;

async function withCustomDomainLock<T>(projectId: number, operation: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [CUSTOM_DOMAIN_LOCK_NAMESPACE, projectId]);
    return await operation();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [CUSTOM_DOMAIN_LOCK_NAMESPACE, projectId]).catch(() => undefined);
    client.release();
  }
}

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

function publicSocialImageUrl(projectId: number, version?: number) {
  const base = (process.env.BUILDCUSTOM_PUBLIC_URL?.trim() || "https://buildcustom.ai").replace(/\/$/, "");
  return `${base}/api/public/projects/${projectId}/social-image${version ? `?v=${version}` : ""}`;
}

function publicPreviewImageUrl(projectId: number, version?: number) {
  const base = (process.env.BUILDCUSTOM_PUBLIC_URL?.trim() || "https://buildcustom.ai").replace(/\/$/, "");
  return `${base}/api/public/projects/${projectId}/preview-image${version ? `?v=${version}` : ""}`;
}

function publishedPreviewImageUrl(deploymentUrl: string, version?: number) {
  return `${deploymentUrl.replace(/\/$/, "")}/_buildcustom/preview-image${version ? `?v=${version}` : ""}`;
}

function seoResponse(settings: any) {
  if (!settings) return settings;
  const { socialImageData, previewImageData, ...safe } = settings;
  return {
    ...safe,
    hasSocialImage: Boolean(socialImageData),
    hasPreviewImage: Boolean(previewImageData),
    previewImageUrl: previewImageData ? publicPreviewImageUrl(settings.projectId, settings.updatedAt?.getTime?.()) : "",
  };
}

function sendStoredImage(res: any, data: string | null | undefined) {
  const match = data?.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return res.status(404).send("Image not found");
  const image = Buffer.from(match[2], "base64");
  res.set({
    "Content-Type": match[1].toLowerCase(),
    "Content-Length": String(image.length),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  return res.send(image);
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

function customDomainResponse(link: any) {
  const primaryStatus = link?.customDomainStatus || null;
  const secondaryStatus = link?.customDomainSecondary ? link?.customDomainSecondaryStatus || null : "live";
  const status = primaryStatus === "live" && secondaryStatus === "live"
    ? "live"
    : primaryStatus === "error" || secondaryStatus === "error"
      ? "error"
      : primaryStatus === "connecting" || secondaryStatus === "connecting"
        ? "connecting"
        : primaryStatus;
  return {
    hostname: link?.customDomain || "",
    status,
    sslStatus: link?.customDomainSslStatus || null,
    dnsRecords: link?.customDomainDnsRecords || [],
    error: link?.customDomainError || null,
    checkedAt: link?.customDomainCheckedAt || null,
    managedUrl: link?.deploymentUrl || "",
    canConnect: Boolean(link?.deploymentUrl && link?.subdomainSlug),
    migration: link?.customDomainMigrationState || {},
    secondary: link?.customDomainSecondary ? {
      hostname: link.customDomainSecondary,
      status: link.customDomainSecondaryStatus,
      sslStatus: link.customDomainSecondarySslStatus,
      dnsRecords: link.customDomainSecondaryDnsRecords || [],
      error: link.customDomainSecondaryError,
      checkedAt: link.customDomainSecondaryCheckedAt,
      redirectTo: link.customDomain,
    } : null,
  };
}

function applicationDomainResponse(domain: any) {
  if (!domain) return null;
  return {
    hostname: domain.hostname,
    purpose: "application",
    role: "direct",
    status: domain.status || null,
    sslStatus: domain.sslStatus || null,
    dnsRecords: domain.dnsRecords || [],
    error: domain.error || null,
    checkedAt: domain.checkedAt || null,
    migration: domain.migrationState || {},
  };
}

async function customDomainResponseWithApplication(projectId: number, link: any) {
  const domains = await storage.getRuntimeCustomDomains(projectId);
  return {
    ...customDomainResponse(link),
    appDomain: applicationDomainResponse(domains.find((domain) =>
      domain.purpose === "application" && domain.role === "direct")),
  };
}

async function persistVerifiedCustomDomain(projectId: number, hostname: string, slug: string, cloudflareHostname: any, migrationState: any = {}) {
  if (normalizeCustomDomain(String(cloudflareHostname?.hostname || "")) !== hostname) {
    throw new RuntimeAdapterError("Cloudflare returned a different hostname than the requested primary domain.", "RUNTIME_UPSTREAM_ERROR", 502);
  }
  const update = customDomainUpdate(cloudflareHostname);
  let migration = { ...migrationState };
  if (update.customDomainStatus === "live") {
    const classification = classifyHostname(hostname);
    if ((classification.kind === "apex" || migration.pairedHostnames === true) && (migration.strategy !== "customer_cloudflare" || migration.nameserversActive !== true)) {
      await removePublishedCustomHostname(hostname);
      update.customDomainStatus = "pending_dns" as any;
      update.customDomainError = "Root domains must finish the customer-owned Cloudflare DNS migration before they can go live.";
      migration = { ...migration, lifecycleLabel: "Waiting for Nameservers", routingActive: false };
      const saved = await storage.upsertRuntimeProjectLink(projectId, { ...update, customDomainMigrationState: migration });
      await updateDomainLifecycle(projectId, hostname, {
        cloudflareId: update.customDomainCloudflareId,
        status: update.customDomainStatus,
        sslStatus: update.customDomainSslStatus,
        dnsRecords: update.customDomainDnsRecords,
        error: update.customDomainError,
        checkedAt: update.customDomainCheckedAt,
        migrationState: migration,
      });
      return saved;
    }
    const routing = await domainRoutingContext(projectId, hostname);
    await setPublishedCustomHostname(hostname, slug, undefined, routing || undefined);
    const routingVerified = await verifyCustomDomainRouting(hostname, slug, null, routing || undefined);
    update.customDomainStatus = routingStatusAfterVerification(update.customDomainStatus, routingVerified) as any;
    if (!routingVerified) {
      update.customDomainError = "DNS and SSL are active. BuildCustom is waiting for the project route to finish propagating.";
      migration = { ...migration, lifecycleLabel: "Connecting Website", routingActive: false };
    } else {
      migration = { ...migration, lifecycleLabel: "Live", routingActive: true };
    }
  } else {
    await removePublishedCustomHostname(hostname);
  }
  const saved = await storage.upsertRuntimeProjectLink(projectId, { ...update, customDomainMigrationState: migration });
  await updateDomainLifecycle(projectId, hostname, {
    cloudflareId: update.customDomainCloudflareId,
    status: update.customDomainStatus,
    sslStatus: update.customDomainSslStatus,
    dnsRecords: update.customDomainDnsRecords,
    error: update.customDomainError,
    checkedAt: update.customDomainCheckedAt,
    migrationState: migration,
  });
  return saved;
}

async function persistVerifiedSecondaryDomain(projectId: number, hostname: string, primaryHostname: string, slug: string, cloudflareHostname: any) {
  if (normalizeCustomDomain(String(cloudflareHostname?.hostname || "")) !== hostname) {
    throw new RuntimeAdapterError("Cloudflare returned a different hostname than the requested secondary domain.", "RUNTIME_UPSTREAM_ERROR", 502);
  }
  const update = customDomainUpdate(cloudflareHostname);
  if (update.customDomainStatus === "live") {
    const routing = await domainRoutingContext(projectId, hostname);
    await setPublishedCustomHostname(hostname, slug, primaryHostname, routing || undefined);
    const routingVerified = await verifyCustomDomainRouting(hostname, slug, primaryHostname, routing || undefined);
    update.customDomainStatus = routingStatusAfterVerification(update.customDomainStatus, routingVerified) as any;
    if (!routingVerified) {
      update.customDomainError = "DNS and SSL are active. BuildCustom is waiting for the redirect route to finish propagating.";
    }
  } else {
    await removePublishedCustomHostname(hostname);
  }
  const saved = await storage.upsertRuntimeProjectLink(projectId, {
    customDomainSecondaryCloudflareId: update.customDomainCloudflareId,
    customDomainSecondaryStatus: update.customDomainStatus,
    customDomainSecondarySslStatus: update.customDomainSslStatus,
    customDomainSecondaryDnsRecords: update.customDomainDnsRecords,
    customDomainSecondaryError: update.customDomainError,
    customDomainSecondaryCheckedAt: update.customDomainCheckedAt,
  });
  await updateDomainLifecycle(projectId, hostname, {
    cloudflareId: update.customDomainCloudflareId,
    status: update.customDomainStatus,
    sslStatus: update.customDomainSslStatus,
    dnsRecords: update.customDomainDnsRecords,
    error: update.customDomainError,
    checkedAt: update.customDomainCheckedAt,
  });
  return saved;
}

async function persistApplicationDomain(projectId: number, claim: any, slug: string, cloudflareHostname: any) {
  if (normalizeCustomDomain(String(cloudflareHostname?.hostname || "")) !== claim.hostname) {
    throw new RuntimeAdapterError("Cloudflare returned a different hostname than the requested app domain.", "RUNTIME_UPSTREAM_ERROR", 502);
  }
  const update = customDomainUpdate(cloudflareHostname);
  let migrationState = { ...(claim.migrationState || {}) };
  if (update.customDomainStatus === "live") {
    const routing = await domainRoutingContext(projectId, claim.hostname);
    await setPublishedCustomHostname(claim.hostname, slug, undefined, {
      ...(routing || {}),
      purpose: "application",
      role: "direct",
    });
    const routingVerified = await verifyCustomDomainRouting(claim.hostname, slug, null, {
      ...(routing || {}),
      purpose: "application",
      role: "direct",
    });
    update.customDomainStatus = routingStatusAfterVerification(update.customDomainStatus, routingVerified) as any;
    migrationState = {
      ...migrationState,
      lifecycleLabel: routingVerified ? "Live" : "Connecting Application",
      routingActive: routingVerified,
    };
    if (!routingVerified) update.customDomainError = "DNS and SSL are active. BuildCustom is waiting for the app route to finish propagating.";
  } else {
    await removePublishedCustomHostname(claim.hostname).catch(() => undefined);
  }
  return updateDomainLifecycle(projectId, claim.hostname, {
    cloudflareId: update.customDomainCloudflareId,
    status: update.customDomainStatus,
    sslStatus: update.customDomainSslStatus,
    dnsRecords: update.customDomainDnsRecords,
    error: update.customDomainError,
    checkedAt: update.customDomainCheckedAt,
    migrationState,
  });
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
      const [runtimeLinks, seoSettings] = await Promise.all([
        Promise.all(projects.map((project) => storage.getRuntimeProjectLink(project.id))),
        Promise.all(projects.map((project) => storage.getSeoSettings(project.id))),
      ]);
      return res.json(projects.map((project, index) => ({
        ...project,
        deploymentUrl: runtimeLinks[index]?.deploymentUrl || null,
        previewImageUrl: seoSettings[index]?.previewImageData && runtimeLinks[index]?.deploymentUrl
          ? publishedPreviewImageUrl(runtimeLinks[index]!.deploymentUrl!, seoSettings[index]?.updatedAt?.getTime())
          : null,
      })));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const requestedName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      let name = requestedName;
      if (!name) {
        const existingProjects = await storage.getProjectsByUser(userId);
        const usedNumbers = new Set(
          existingProjects
            .map((project) => project.name.match(/^Project(\d+)$/i)?.[1])
            .filter(Boolean)
            .map(Number),
        );
        let nextNumber = 1;
        while (usedNumbers.has(nextNumber)) nextNumber += 1;
        name = `Project${nextNumber}`;
      }
      const parsed = insertProjectSchema.safeParse({ ...req.body, name, userId });
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
      await withCustomDomainLock(project.id, async () => {
      const [link, domains] = await Promise.all([
        storage.getRuntimeProjectLink(project.id),
        listDomains(project.id),
      ]);
      const aliases = await Promise.all(domains.map(async (domain) => ({
        domain,
        value: await getPublishedProjectRouteValue(`hostname:${domain.hostname}`),
        removed: false,
      })));
      try {
        for (const alias of aliases) {
          await removePublishedCustomHostname(alias.domain.hostname);
          alias.removed = true;
        }
        await deleteProjectAndPublishedRoute(project.id, link, {
          getRouteValue: getPublishedProjectRouteValue,
          removeRoute: removePublishedProjectRoute,
          restoreRouteValue: restorePublishedProjectRouteValue,
          deleteProject: (projectId) => storage.deleteProject(projectId),
        });
      } catch (error) {
        for (const alias of aliases) {
          if (!alias.removed || alias.value === null) continue;
          await restorePublishedProjectRouteValue(`hostname:${alias.domain.hostname}`, alias.value).catch((restoreError) => {
            console.error("Project deletion failed and a custom-hostname alias could not be restored", {
              projectId: project.id,
              hostname: alias.domain.hostname,
              restoreError,
            });
          });
        }
        if (error instanceof PublishedRouteRestoreError) {
          console.error("Project deletion and published-route restoration both failed", {
            projectId: project.id,
            subdomainSlug: link?.subdomainSlug,
            deleteError: error.deleteError,
            restoreError: error.restoreError,
          });
          throw new RuntimeAdapterError(
            "Project deletion failed and its public route could not be restored. Support has been alerted.",
            "RUNTIME_UPSTREAM_ERROR",
          );
        }
        throw error;
      }
      for (const domain of domains) {
        if (!domain.cloudflareId) continue;
        await deleteCustomHostname(domain.cloudflareId).catch((error) => {
          console.error("Deleted project left an orphaned Cloudflare custom hostname", {
            projectId: project.id,
            hostname: domain.hostname,
            cloudflareId: domain.cloudflareId,
            error,
          });
        });
      }
      });
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
      const [status, link, seo] = await Promise.all([
        runtimeAdapter.status(await runtimeProject(project)),
        storage.getRuntimeProjectLink(project.id),
        storage.getSeoSettings(project.id),
      ]);
      return res.json({
        ...status,
        previewUrl: (status.state as any)?.previewUrl || link?.previewUrl || null,
        deploymentUrl: link?.deploymentUrl || null,
        previewImageUrl: seo?.previewImageData && link?.deploymentUrl
          ? publishedPreviewImageUrl(link.deploymentUrl, seo.updatedAt?.getTime())
          : null,
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
      try {
        const previewImageData = await captureProjectPreviewImage(publicUrl);
        await setPublishedProjectPreviewImage(subdomainSlug, previewImageData);
        const currentSeo = await storage.getSeoSettings(project.id);
        const updatedSeo = await storage.upsertSeoSettings(project.id, {
          previewImageData,
          ...(!currentSeo?.socialImageData ? { ogImageUrl: publishedPreviewImageUrl(publicUrl, Date.now()) } : {}),
        });
        await setPublishedProjectRoute(subdomainSlug, scriptName, {
          title: updatedSeo.metaTitle,
          description: updatedSeo.metaDescription,
          canonicalUrl: updatedSeo.canonicalUrl,
          ogTitle: updatedSeo.ogTitle,
          ogDescription: updatedSeo.ogDescription,
          ogImageUrl: updatedSeo.ogImageUrl,
          faviconData: updatedSeo.faviconData,
          allowIndexing: updatedSeo.allowIndexing,
          schemaJson: updatedSeo.schemaJson,
        });
      } catch (error) {
        console.warn("Published project preview screenshot could not be refreshed", { projectId: project.id, error });
      }
      return res.status(201).json({ ...result, url: publicUrl, originUrl: result.url, release });
    } catch (err) { return runtimeError(err, res); }
  });

  app.get("/api/projects/:id/runtime/custom-domain", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    return res.json(await customDomainResponseWithApplication(project.id, await storage.getRuntimeProjectLink(project.id)));
  });

  app.get("/api/projects/:id/runtime/domains", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    return res.json(await listDomains(project.id));
  });

  app.post("/api/projects/:id/runtime/application-domain", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      const hostname = normalizeCustomDomain(typeof req.body?.hostname === "string" ? req.body.hostname : "");
      const link = await storage.getRuntimeProjectLink(project.id);
      if (!link?.deploymentUrl || !link.subdomainSlug) {
        return res.status(409).json({ code: "PROJECT_NOT_PUBLISHED", message: "Publish this project before connecting an app domain." });
      }
      const user = await storage.getUser(project.userId);
      if (!getPlanEntitlement(user?.plan).managedCustomDomains) {
        return res.status(403).json({ code: "MANAGED_CUSTOM_DOMAIN_REQUIRES_PAID_PLAN", message: "Custom domains are available on Launch, Pro, Agency, and Admin plans." });
      }
      const classification = validateApplicationHostname(hostname);
      const result = await withCustomDomainLock(project.id, async () => {
        const existing = await storage.getRuntimeCustomDomainClaim(hostname);
        if (existing && existing.projectId !== project.id) {
          throw new RuntimeAdapterError("That domain is already connected to another project.", "RUNTIME_UPSTREAM_ERROR", 409);
        }
        const claim = await storage.claimRuntimeApplicationDomain(project.id, hostname);
        if (claim.cloudflareId) {
          const currentHostname = await getCustomHostname(claim.cloudflareId);
          return { domain: await persistApplicationDomain(project.id, claim, link.subdomainSlug!, currentHostname), created: false };
        }
        let cloudflareHostname: Awaited<ReturnType<typeof createCustomHostname>> | null = null;
        try {
          cloudflareHostname = await createCustomHostname(hostname);
          const saved = await updateDomainLifecycle(project.id, hostname, {
            cloudflareId: cloudflareHostname.id || null,
            status: customDomainUpdate(cloudflareHostname).customDomainStatus,
            sslStatus: customDomainUpdate(cloudflareHostname).customDomainSslStatus,
            dnsRecords: customDomainUpdate(cloudflareHostname).customDomainDnsRecords,
            error: customDomainUpdate(cloudflareHostname).customDomainError,
            checkedAt: customDomainUpdate(cloudflareHostname).customDomainCheckedAt,
          });
          return { domain: await persistApplicationDomain(project.id, saved || claim, link.subdomainSlug!, cloudflareHostname), created: true };
        } catch (error) {
          if (cloudflareHostname?.id) await deleteCustomHostname(cloudflareHostname.id).catch(() => undefined);
          await storage.releaseRuntimeApplicationDomain(project.id, hostname);
          throw error;
        }
      });
      return res.status(result.created ? 201 : 200).json({
        ...(await customDomainResponseWithApplication(project.id, await storage.getRuntimeProjectLink(project.id))),
      });
    } catch (err: any) {
      if (err?.message === "APPLICATION_DOMAIN_EXISTS") {
        return res.status(409).json({ code: "APPLICATION_DOMAIN_EXISTS", message: "This project already has an app/login domain. Remove it before adding a different one." });
      }
      if (err?.message === "CUSTOM_DOMAIN_IN_USE") {
        return res.status(409).json({ code: "CUSTOM_DOMAIN_IN_USE", message: "That domain is already connected to another project." });
      }
      if (err?.message === "CUSTOM_DOMAIN_ROLE_CONFLICT") {
        return res.status(409).json({ code: "CUSTOM_DOMAIN_ROLE_CONFLICT", message: "That hostname is already used for a different domain purpose." });
      }
      return runtimeError(err, res);
    }
  });

  app.post("/api/projects/:id/runtime/application-domain/refresh", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      const result = await withCustomDomainLock(project.id, async () => {
        const hostname = normalizeCustomDomain(typeof req.body?.hostname === "string" ? req.body.hostname : "");
        const claim = await storage.getRuntimeCustomDomainClaim(hostname);
        const link = await storage.getRuntimeProjectLink(project.id);
        if (!claim || claim.projectId !== project.id || claim.purpose !== "application" || !claim.cloudflareId || !link?.subdomainSlug) {
          return null;
        }
        const cloudflareHostname = await getCustomHostname(claim.cloudflareId);
        return persistApplicationDomain(project.id, claim, link.subdomainSlug, cloudflareHostname);
      });
      if (!result) return res.status(404).json({ message: "No app domain is connected." });
      return res.json({ appDomain: applicationDomainResponse(result) });
    } catch (err) { return runtimeError(err, res); }
  });

  app.delete("/api/projects/:id/runtime/application-domain", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      const hostname = normalizeCustomDomain(typeof req.body?.hostname === "string" ? req.body.hostname : String(req.query.hostname || ""));
      await withCustomDomainLock(project.id, async () => {
        const claim = await storage.getRuntimeCustomDomainClaim(hostname);
        if (!claim || claim.projectId !== project.id || claim.purpose !== "application") return;
        await removePublishedCustomHostname(hostname).catch(() => undefined);
        if (claim.cloudflareId) await deleteCustomHostname(claim.cloudflareId).catch(() => undefined);
        await storage.releaseRuntimeApplicationDomain(project.id, hostname);
      });
      return res.status(204).end();
    } catch (err) { return runtimeError(err, res); }
  });

  // Read-only discovery used by the safe apex migration wizard.
  app.post("/api/projects/:id/runtime/custom-domain/inspect", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      return await withCustomDomainLock(project.id, async () => {
      const inspection = await inspectPublicDns(typeof req.body?.hostname === "string" ? req.body.hostname : "");
      const link = await storage.getRuntimeProjectLink(project.id);
      const prior = link?.customDomainMigrationState?.hostname === inspection.hostname
        ? link.customDomainMigrationState
        : {};
      const inventoryChanged = JSON.stringify(prior.dnsInventory || []) !== JSON.stringify(inspection.records);
      const migrationBase = { ...prior };
      if (inventoryChanged) {
        delete migrationBase.acknowledgedAt;
        delete migrationBase.cloudflareImportComparison;
        delete migrationBase.cloudflareImportCheckedAt;
        delete migrationBase.cloudflareImportFilename;
      }
      const migration: any = {
        ...migrationBase,
        hostname: inspection.hostname,
        hostnameKind: inspection.kind,
        registrableDomain: inspection.registrableDomain,
        dnsInventory: inspection.records,
        dnsScannedAt: inspection.scannedAt,
        dnsComplete: inspection.complete,
        warnings: inspection.warnings,
        emailRiskFlags: inspection.emailRiskFlags,
        replacementPlan: inspection.replacementPlan,
        proposedRecords: inspection.proposedRecords,
      };
      const updated = await storage.upsertRuntimeProjectLink(project.id, { customDomainMigrationState: migration });
      return res.json({ ...inspection, migration: updated.customDomainMigrationState });
      });
    } catch (err) { return runtimeError(err, res); }
  });

  // Compares customer-provided Cloudflare scan/export data without Cloudflare account access.
  app.post("/api/projects/:id/runtime/custom-domain/import-dns", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      return await withCustomDomainLock(project.id, async () => {
      const hostname = normalizeCustomDomain(typeof req.body?.hostname === "string" ? req.body.hostname : "");
      const link = await storage.getRuntimeProjectLink(project.id);
      const prior = link?.customDomainMigrationState?.hostname === hostname
        ? link.customDomainMigrationState
        : null;
      if (!prior || !Array.isArray(prior.dnsInventory) || !prior.dnsScannedAt) {
        return res.status(409).json({
          code: "PUBLIC_DNS_SCAN_REQUIRED",
          message: "Inspect the existing public DNS records before comparing the Cloudflare import.",
        });
      }
      const importedRecords = parseCloudflareDnsImport(
        typeof req.body?.content === "string" ? req.body.content : "",
        hostname,
      );
      const comparison = compareCloudflareDnsImport(prior.dnsInventory, importedRecords, hostname);
      const comparisonChanged = JSON.stringify(prior.cloudflareImportComparison || null) !== JSON.stringify(comparison);
      const migration: any = {
        ...prior,
        cloudflareImportComparison: comparison,
        cloudflareImportCheckedAt: new Date().toISOString(),
        cloudflareImportFilename: typeof req.body?.filename === "string"
          ? req.body.filename.slice(0, 200)
          : null,
      };
      if (comparisonChanged) delete migration.acknowledgedAt;
      const updated = await storage.upsertRuntimeProjectLink(project.id, { customDomainMigrationState: migration });
      return res.json({ hostname, comparison, migration: updated.customDomainMigrationState });
      });
    } catch (err) {
      return runtimeError(err, res);
    }
  });

  // Saves wizard decisions only. It never creates a customer zone or changes DNS.
  app.post("/api/projects/:id/runtime/custom-domain/configure", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      return await withCustomDomainLock(project.id, async () => {
      const link = await storage.getRuntimeProjectLink(project.id);
      const hostname = normalizeCustomDomain(typeof req.body?.hostname === "string"
        ? req.body.hostname : String(link?.customDomain || ""));
      if (!link?.deploymentUrl || !link.subdomainSlug) {
        return res.status(409).json({ code: "PROJECT_NOT_PUBLISHED", message: "Publish this project before connecting a custom domain." });
      }
      const user = await storage.getUser(project.userId);
      if (!getPlanEntitlement(user?.plan).managedCustomDomains) {
        return res.status(403).json({ code: "MANAGED_CUSTOM_DOMAIN_REQUIRES_PAID_PLAN", message: "Custom domains are available on Launch, Pro, Agency, and Admin plans." });
      }
      const claimed = await storage.getRuntimeProjectLinkByCustomDomain(hostname);
      if (claimed && claimed.projectId !== project.id) {
        return res.status(409).json({ code: "CUSTOM_DOMAIN_IN_USE", message: "That domain is already connected to another project." });
      }
      const classification = classifyHostname(hostname);
      const strategy = req.body?.strategy === "customer_cloudflare" ? "customer_cloudflare" : req.body?.strategy === "current_dns" ? "current_dns" : null;
      if (!strategy) return res.status(400).json({ code: "INVALID_DNS_STRATEGY", message: "Choose whether to keep your current DNS or use customer-owned Cloudflare DNS." });
      if (classification.kind === "apex" && strategy !== "customer_cloudflare") {
        return res.status(409).json({ code: "APEX_REQUIRES_CUSTOMER_CLOUDFLARE", message: "Root domains must use the safe customer-owned Cloudflare DNS migration." });
      }
      const prior = link?.customDomainMigrationState?.hostname === hostname ? link.customDomainMigrationState : {};
      const pairedHostnames = strategy === "customer_cloudflare" && ["apex", "www"].includes(classification.kind);
      const rootHostname = classification.registrableDomain;
      const wwwHostname = `www.${classification.registrableDomain}`;
      const requestedPrimary = pairedHostnames && typeof req.body?.primaryHostname === "string"
        ? normalizeCustomDomain(req.body.primaryHostname)
        : hostname;
      if (pairedHostnames && ![rootHostname, wwwHostname].includes(requestedPrimary)) {
        return res.status(400).json({ code: "INVALID_PRIMARY_HOSTNAME", message: "Choose either the root domain or www as the primary hostname." });
      }
      const primaryHostname = pairedHostnames ? requestedPrimary : hostname;
      const secondaryHostname = pairedHostnames ? (primaryHostname === rootHostname ? wwwHostname : rootHostname) : null;
      const changesProvisionedPrimary = Boolean(link?.customDomainCloudflareId) && link.customDomain !== primaryHostname;
      const changesProvisionedSecondary = Boolean(link?.customDomainSecondaryCloudflareId) &&
        (link.customDomainSecondary || null) !== secondaryHostname;
      if (changesProvisionedPrimary || changesProvisionedSecondary) {
        return res.status(409).json({ code: "REMOVE_DOMAIN_BEFORE_REBIND", message: "Remove the existing custom domain before changing the primary or secondary hostname." });
      }
      const hasCurrentInventory = prior.hostname === hostname && prior.dnsScannedAt && Array.isArray(prior.dnsInventory);
      if (pairedHostnames && (!hasCurrentInventory || (req.body?.acknowledged !== true && !prior.acknowledgedAt))) {
        return res.status(409).json({ code: "DNS_REVIEW_ACKNOWLEDGEMENT_REQUIRED", message: "Review the discovered DNS records and acknowledge that missing records can affect email or other services." });
      }
      const expectedNameservers = req.body?.expectedNameservers === undefined ? prior.expectedNameservers : validateExpectedNameservers(req.body.expectedNameservers);
      if (pairedHostnames && (!Array.isArray(expectedNameservers) || expectedNameservers.length !== 2)) {
        return res.status(400).json({ code: "CLOUDFLARE_NAMESERVERS_REQUIRED", message: "Enter the two Cloudflare nameservers assigned to your zone." });
      }
      const migration = {
        ...prior, hostname: primaryHostname, inspectedHostname: hostname, hostnameKind: classifyHostname(primaryHostname).kind, registrableDomain: classification.registrableDomain,
        strategy, expectedNameservers,
        pairedHostnames, primaryHostname, secondaryHostname,
        ...(req.body?.acknowledged === true ? { acknowledgedAt: new Date().toISOString() } : {}),
        lifecycleLabel: "Getting Started",
      };
      let updated;
      try {
        updated = await configurePrimaryDomainPair({
          projectId: project.id,
          primaryHostname,
          secondaryHostname,
          migration,
        });
      } catch (error: any) {
        if (error?.message === "CUSTOM_DOMAIN_IN_USE") {
          return res.status(409).json({ code: "CUSTOM_DOMAIN_IN_USE", message: "The root or www hostname is already connected to another project." });
        }
        if (error?.message === "CUSTOM_DOMAIN_ROLE_CONFLICT") {
          return res.status(409).json({
            code: "CUSTOM_DOMAIN_ROLE_CONFLICT",
            message: "That hostname already has a different purpose in this project. Change its role explicitly before using it as the website domain.",
          });
        }
        throw error;
      }
      return res.json(customDomainResponse(updated));
      });
    } catch (err) { return runtimeError(err, res); }
  });

  app.post("/api/projects/:id/runtime/custom-domain", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      const hostname = normalizeCustomDomain(typeof req.body?.hostname === "string" ? req.body.hostname : "");
      const link = await storage.getRuntimeProjectLink(project.id);
      if (!link?.deploymentUrl || !link.subdomainSlug) {
        return res.status(409).json({ code: "PROJECT_NOT_PUBLISHED", message: "Publish this project before connecting a custom domain." });
      }
      const user = await storage.getUser(project.userId);
      if (!getPlanEntitlement(user?.plan).managedCustomDomains) {
        return res.status(403).json({
          code: "MANAGED_CUSTOM_DOMAIN_REQUIRES_PAID_PLAN",
          message: "BuildCustom.Ai-hosted custom domains are available on Launch, Pro, and Agency plans.",
        });
      }
      const result = await withCustomDomainLock(project.id, async () => {
        const current = await storage.getRuntimeProjectLink(project.id);
        const claim = await storage.getRuntimeCustomDomainClaim(hostname);
        if (current?.customDomain !== hostname || claim?.projectId !== project.id || claim.role !== "primary") {
          throw new RuntimeAdapterError("Configure and claim this hostname before provisioning it.", "RUNTIME_UPSTREAM_ERROR", 409);
        }
        const classification = classifyHostname(hostname);
        if (classification.kind === "apex" || current.customDomainMigrationState?.pairedHostnames === true) {
          const migration = current.customDomainMigrationState || {};
          if (migration.hostname !== hostname || migration.strategy !== "customer_cloudflare" || !migration.acknowledgedAt || migration.nameserversActive !== true) {
            throw new RuntimeAdapterError("Complete the safe customer-owned Cloudflare DNS migration before connecting this root domain.", "RUNTIME_UPSTREAM_ERROR", 409);
          }
        }
        if (current?.customDomainCloudflareId) {
          const existingHostname = await getCustomHostname(current.customDomainCloudflareId);
          return {
            link: await persistVerifiedCustomDomain(project.id, hostname, current.subdomainSlug!, existingHostname, current.customDomainMigrationState),
            created: false,
          };
        }
        const cloudflareHostname = await createCustomHostname(hostname);
        try {
          const saved = await storage.upsertRuntimeProjectLink(project.id, {
            hostingProvider: "buildcustom",
            customDomain: hostname,
            customOrigin: null,
            ...customDomainUpdate(cloudflareHostname),
          });
          return {
            link: await persistVerifiedCustomDomain(
              project.id,
              hostname,
              current!.subdomainSlug!,
              cloudflareHostname,
              saved.customDomainMigrationState,
            ),
            created: true,
          };
        } catch (error) {
          if (cloudflareHostname.id) await deleteCustomHostname(cloudflareHostname.id).catch(() => undefined);
          await removePublishedCustomHostname(hostname).catch(() => undefined);
          throw error;
        }
      });
      return res.status(result.created ? 201 : 200).json(customDomainResponse(result.link));
    } catch (err) {
      return runtimeError(err, res);
    }
  });

  app.post("/api/projects/:id/runtime/custom-domain/refresh", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      return await withCustomDomainLock(project.id, async () => {
      const link = await storage.getRuntimeProjectLink(project.id);
      if (link?.customDomain && !link.customDomainCloudflareId && link.customDomainMigrationState?.expectedNameservers) {
        const expected = link.customDomainMigrationState.expectedNameservers as string[];
        const nameserverCheck = await checkNameserverActivation(link.customDomain, expected);
        const { currentNameservers, active } = nameserverCheck;
        const migration = {
          ...link.customDomainMigrationState, currentNameservers, nameserversActive: active,
          nameserverCheckSource: nameserverCheck.checkSource,
          nameserversAuthoritative: nameserverCheck.authoritativeActive,
          lifecycleLabel: active ? "Cloudflare DNS Active" : "Waiting for Nameservers",
          lastCheckedAt: new Date().toISOString(),
        };
        if (active && link.subdomainSlug) {
          const migrationHostname = link.customDomain;
          const migrationSlug = link.subdomainSlug;
          const current = await storage.getRuntimeProjectLink(project.id);
          const createdPrimary = !current?.customDomainCloudflareId;
          const cloudflareHostname = current?.customDomainCloudflareId
              ? await getCustomHostname(current.customDomainCloudflareId)
              : await createCustomHostname(migrationHostname);
          let updated;
          try {
            updated = await persistVerifiedCustomDomain(
              project.id,
              migrationHostname,
              migrationSlug,
              cloudflareHostname,
              { ...migration, lifecycleLabel: "Verifying Ownership" },
            );
          } catch (error) {
            if (createdPrimary && cloudflareHostname.id) await deleteCustomHostname(cloudflareHostname.id).catch(() => undefined);
            if (createdPrimary) await removePublishedCustomHostname(migrationHostname).catch(() => undefined);
            throw error;
          }
          if (updated.customDomainSecondary) {
            const secondaryDomain = updated.customDomainSecondary;
            const createdSecondary = !updated.customDomainSecondaryCloudflareId;
            const secondaryHostname = updated.customDomainSecondaryCloudflareId
                ? await getCustomHostname(updated.customDomainSecondaryCloudflareId)
                : await createCustomHostname(secondaryDomain);
            try {
              updated = await persistVerifiedSecondaryDomain(
                project.id,
                secondaryDomain,
                migrationHostname,
                migrationSlug,
                secondaryHostname,
              );
            } catch (error) {
              if (createdSecondary && secondaryHostname.id) await deleteCustomHostname(secondaryHostname.id).catch(() => undefined);
              if (createdSecondary) await removePublishedCustomHostname(secondaryDomain).catch(() => undefined);
              throw error;
            }
          }
          return res.json(customDomainResponse(updated));
        }
        const updated = await storage.upsertRuntimeProjectLink(project.id, { customDomainMigrationState: migration });
        return res.json(customDomainResponse(updated));
      }
      if (!link?.customDomain || !link.customDomainCloudflareId || !link.subdomainSlug) {
        return res.status(404).json({ message: "No custom domain is connected." });
      }
      const cloudflareHostname = await getCustomHostname(link.customDomainCloudflareId);
      const prior = link.customDomainMigrationState || {};
      let migration = { ...prior };
      if (Array.isArray(prior.expectedNameservers) && prior.expectedNameservers.length === 2) {
        const nameserverCheck = await checkNameserverActivation(link.customDomain, prior.expectedNameservers.map(String));
        const { currentNameservers, active } = nameserverCheck;
        migration = {
          ...migration,
          currentNameservers,
          nameserversActive: active,
          nameserverCheckSource: nameserverCheck.checkSource,
          nameserversAuthoritative: nameserverCheck.authoritativeActive,
          lifecycleLabel: active ? "Cloudflare DNS Active" : "Waiting for Nameservers",
        };
      }
      let updated = await persistVerifiedCustomDomain(project.id, link.customDomain, link.subdomainSlug, cloudflareHostname, migration);
      if (updated.customDomainSecondary && migration.nameserversActive === true) {
        const current = await storage.getRuntimeProjectLink(project.id);
        const createdSecondary = !current!.customDomainSecondaryCloudflareId;
        const secondaryHostname = current!.customDomainSecondaryCloudflareId
            ? await getCustomHostname(current!.customDomainSecondaryCloudflareId)
            : await createCustomHostname(current!.customDomainSecondary!);
        try {
          updated = await persistVerifiedSecondaryDomain(
            project.id,
            current!.customDomainSecondary!,
            current!.customDomain!,
            current!.subdomainSlug!,
            secondaryHostname,
          );
        } catch (error) {
          if (createdSecondary && secondaryHostname.id) await deleteCustomHostname(secondaryHostname.id).catch(() => undefined);
          if (createdSecondary) await removePublishedCustomHostname(current!.customDomainSecondary!).catch(() => undefined);
          throw error;
        }
      }
      return res.json(customDomainResponse(updated));
      });
    } catch (err) {
      return runtimeError(err, res);
    }
  });

  app.delete("/api/projects/:id/runtime/custom-domain", async (req, res) => {
    const project = await requireProject(req, res);
    if (!project) return;
    try {
      return await withCustomDomainLock(project.id, async () => {
      const link = await storage.getRuntimeProjectLink(project.id);
      if (!link?.customDomain) return res.status(204).end();
      await removePublishedCustomHostname(link.customDomain);
      if (link.customDomainSecondary) await removePublishedCustomHostname(link.customDomainSecondary);
      if (link.customDomainCloudflareId) await deleteCustomHostname(link.customDomainCloudflareId);
      if (link.customDomainSecondaryCloudflareId) await deleteCustomHostname(link.customDomainSecondaryCloudflareId);
      await storage.upsertRuntimeProjectLink(project.id, {
        customDomain: null,
        customOrigin: null,
        customDomainCloudflareId: null,
        customDomainStatus: null,
        customDomainSslStatus: null,
        customDomainDnsRecords: [],
        customDomainError: null,
        customDomainCheckedAt: new Date(),
        customDomainSecondary: null,
        customDomainSecondaryCloudflareId: null,
        customDomainSecondaryStatus: null,
        customDomainSecondarySslStatus: null,
        customDomainSecondaryDnsRecords: [],
        customDomainSecondaryError: null,
        customDomainSecondaryCheckedAt: new Date(),
        customDomainMigrationState: {},
      });
      await storage.releaseRuntimeCustomDomainClaims(project.id);
      return res.status(204).end();
      });
    } catch (err) {
      return runtimeError(err, res);
    }
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
      const currentManagedLink = await storage.getRuntimeProjectLink(project.id);
      if (currentManagedLink?.customDomain !== customDomain) {
        return res.status(409).json({
          code: "CUSTOM_DOMAIN_USE_DOMAINS_FLOW",
          message: "Connect managed custom domains from the Domains tab so DNS and SSL can be verified.",
        });
      }
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
  app.get("/api/public/projects/:id/preview-image", async (req, res) => {
    const settings = await storage.getSeoSettings(parseInt(req.params.id));
    return sendStoredImage(res, settings?.previewImageData);
  });

  app.get("/api/public/projects/:id/social-image", async (req, res) => {
    const settings = await storage.getSeoSettings(parseInt(req.params.id));
    return sendStoredImage(res, settings?.socialImageData);
  });

  app.get("/api/projects/:id/seo/suggestions", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const ref = await runtimeProject(project);
      if (!ref.agentId) return res.status(409).json({ message: "Generate the project before requesting project-aware suggestions." });
      const listing = await runtimeAdapter.files(ref);
      const selected = listing.files
        .filter((file) => isSeoContextPath(file.path))
        .sort((a, b) => rankSeoContextPath(b.path) - rankSeoContextPath(a.path))
        .slice(0, 12);
      const files: Array<{ path: string; content: string }> = [];
      let remaining = 60_000;
      for (const file of selected) {
        if (remaining <= 0) break;
        const result = await runtimeAdapter.fileContent(ref, file.path);
        if (!result.content) continue;
        const content = result.content.slice(0, Math.min(12_000, remaining));
        remaining -= content.length;
        files.push({ path: file.path, content });
      }
      if (!files.length) return res.status(422).json({ message: "No readable generated project files were found." });
      const link = await storage.getRuntimeProjectLink(project.id);
      return res.json(await generateSeoSuggestions(project, link?.deploymentUrl || undefined, files));
    } catch (err: any) {
      return res.status(502).json({ message: err.message || "Unable to create project-aware suggestions." });
    }
  });

  app.get("/api/projects/:id/seo", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const settings = await storage.getSeoSettings(project.id);
      return res.json(settings ? seoResponse(settings) : {
        projectId: project.id,
        metaTitle: "",
        metaDescription: "",
        focusKeyword: "",
        seoKeywords: "",
        longTailKeywords: "",
        schemaJson: "{}",
        faviconData: "",
        canonicalUrl: "",
        ogTitle: "",
        ogDescription: "",
        ogImageUrl: "",
        hasSocialImage: false,
        allowIndexing: true,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects/:id/seo/social-image", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const data = typeof req.body?.data === "string" ? req.body.data : "";
      const match = data.match(/^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
      if (!match) return res.status(400).json({ message: "Upload a PNG, JPEG, or WebP social image." });
      const bytes = Buffer.from(match[1], "base64");
      if (!bytes.length || bytes.length > 5_000_000) return res.status(413).json({ message: "Social images must be 5 MB or less." });
      const settings = await savePublishingSettings(project.id, {
        socialImageData: data,
        ogImageUrl: publicSocialImageUrl(project.id, Date.now()),
      }, {
        upsertSettings: (projectId, update) => storage.upsertSeoSettings(projectId, update),
        getRuntimeLink: (projectId) => storage.getRuntimeProjectLink(projectId),
        setPublishedRoute: setPublishedProjectRoute,
      });
      return res.json(seoResponse(settings));
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "Unable to upload the social image." });
    }
  });

  app.delete("/api/projects/:id/seo/social-image", async (req, res) => {
    try {
      const userId = await requireAuth(req, res);
      if (!userId) return;
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project || project.userId !== userId) return res.status(404).json({ message: "Project not found" });
      const existing = await storage.getSeoSettings(project.id);
      const link = await storage.getRuntimeProjectLink(project.id);
      const settings = await savePublishingSettings(project.id, {
        socialImageData: "",
        ogImageUrl: existing?.previewImageData && link?.deploymentUrl
          ? publishedPreviewImageUrl(link.deploymentUrl, Date.now())
          : "",
      }, {
        upsertSettings: (projectId, update) => storage.upsertSeoSettings(projectId, update),
        getRuntimeLink: (projectId) => storage.getRuntimeProjectLink(projectId),
        setPublishedRoute: setPublishedProjectRoute,
      });
      return res.json(seoResponse(settings));
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "Unable to remove the social image." });
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
        seoKeywords: text(req.body?.seoKeywords, 2_000),
        longTailKeywords: text(req.body?.longTailKeywords, 4_000),
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
      const settings = await savePublishingSettings(project.id, clean, {
        upsertSettings: (projectId, data) => storage.upsertSeoSettings(projectId, data),
        getRuntimeLink: (projectId) => storage.getRuntimeProjectLink(projectId),
        setPublishedRoute: setPublishedProjectRoute,
      });
      return res.json(seoResponse(settings));
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
