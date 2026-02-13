import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWaitlistSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/waitlist", async (req, res) => {
    try {
      const parsed = insertWaitlistSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
      }
      const entry = await storage.createWaitlistEntry(parsed.data);
      return res.status(201).json(entry);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const adminUser = process.env.ADMIN_USERNAME || "admin";
    const adminPass = process.env.ADMIN_PASSWORD || "Stayclassy99";
    if (username === adminUser && password === adminPass) {
      return res.json({ success: true, message: "Login successful" });
    }
    return res.status(401).json({ message: "Invalid credentials" });
  });

  app.get("/api/admin/waitlist", async (req, res) => {
    try {
      const entries = await storage.getAllWaitlistEntries();
      return res.json(entries);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/waitlist/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      await storage.deleteWaitlistEntry(id);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
