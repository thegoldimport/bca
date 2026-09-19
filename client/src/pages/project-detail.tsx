import { useEffect, useRef, useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Globe, Smartphone, Gamepad2, ShoppingBag, ExternalLink,
  Settings, FolderTree, Terminal, History, BarChart3, FileText, Rss, Bot,
  Search, MapPin, Plus, Pencil, Trash2, Eye, Calendar, Clock, CheckCircle2,
  AlertCircle, XCircle, RefreshCw, Download, Share2, Copy, Zap, TrendingUp,
  TrendingDown, MoreHorizontal, Save, Layers, Code2, Shield, Check, X,
  BookOpen, Newspaper, Wand2, Target, Hash, ArrowUpRight, ChevronRight,
  ChevronDown, Upload,
} from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { authHeaders } from "@/lib/auth";
const PREVIEW_IMAGES: Record<string, string> = {
  website: new URL("../assets/preview-portfolio.jpg", import.meta.url).href,
  app: new URL("../assets/preview-fitness.jpg", import.meta.url).href,
  game: new URL("../assets/preview-game.jpg", import.meta.url).href,
  saas: new URL("../assets/preview-ecommerce.jpg", import.meta.url).href,
};
const TYPE_ICONS: Record<string, React.ElementType> = {
  website: Globe, app: Smartphone, game: Gamepad2, saas: ShoppingBag,
};

type TabId = "overview" | "files" | "console" | "history" | "settings" | "pages" | "blog" | "autoblogger" | "seo" | "analytics" | "domain";
const UNIVERSAL_TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Layers },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "console", label: "Console", icon: Terminal },
  { id: "history", label: "Version History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "domain", label: "Domains", icon: Globe },
];
const WEBSITE_TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "pages", label: "Pages", icon: FileText },
  { id: "blog", label: "Blog", icon: Rss },
  { id: "autoblogger", label: "Auto-Blogger", icon: Bot },
  { id: "seo", label: "SEO", icon: Search },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { theme } = useTheme();
  return (
    <div className={`rounded-2xl border p-6 ${theme === "dark" ? "bg-white/[0.03] border-white/10" : "bg-white border-gray-200"} ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: "up" | "down" | "neutral" }) {
  const { theme } = useTheme();
  return (
    <GlassCard className="flex flex-col gap-1">
      <span className={`text-xs font-medium uppercase tracking-wide ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{label}</span>
      <span className={`text-2xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{value}</span>
      {sub && (
        <div className="flex items-center gap-1 mt-0.5">
          {trend === "up" && <TrendingUp size={12} className="text-emerald-400" />}
          {trend === "down" && <TrendingDown size={12} className="text-red-400" />}
          <span className={`text-xs ${trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{sub}</span>
        </div>
      )}
    </GlassCard>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
function OverviewTab({ project, blogCount, projectId, runtimeStatus }: { project: any; blogCount: number; projectId: number; runtimeStatus: any }) {
  const { theme } = useTheme();
  const isWebsite = project.type === "website";
  const preview = PREVIEW_IMAGES[project.type] || PREVIEW_IMAGES.website;
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const publishingQuery = useQuery({
    queryKey: ["publishing-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/publishing-settings`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to load publishing settings.");
      return body;
    },
  });
  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/previews`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to create runtime preview.");
      return body;
    },
    onSuccess: (body) => { setPreviewUrl(body.url || body.previewUrl || ""); setPreviewError(body.url || body.previewUrl ? "" : "Runtime did not return a preview URL."); },
    onError: (error: any) => setPreviewError(error.message),
  });
  const deploymentUrl = runtimeStatus?.deploymentUrl || "";
  const displayedPreviewUrl = deploymentUrl || previewUrl;
  const published = Boolean(deploymentUrl);
  const publishingSettings = publishingQuery.data;

  useEffect(() => {
    if (!runtimeStatus || published || previewMutation.isPending || previewUrl) return;
    previewMutation.mutate();
  }, [runtimeStatus, published, projectId]);

  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${isWebsite ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"}`}>
        <StatCard label="Status" value={published ? "Published" : project.status.charAt(0).toUpperCase() + project.status.slice(1)} sub={published ? new URL(deploymentUrl).hostname : "Not deployed"} trend={published ? "up" : "neutral"} />
        {isWebsite && <StatCard label="Monthly Visitors" value="—" sub="Analytics not connected" trend="neutral" />}
        {isWebsite && <StatCard label="Blog Posts" value={String(blogCount)} sub="total posts" trend="neutral" />}
        {isWebsite && <StatCard label="SEO Score" value="—" sub="Configure SEO tab" trend="neutral" />}
        <StatCard label="Last Updated" value={timeAgo(project.updatedAt)} sub={`Created ${fmtDate(project.createdAt)}`} trend="neutral" />
        <StatCard label="Framework" value={project.framework} sub="Production build" trend="neutral" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <GlassCard>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Preview</h3>
            <div className="rounded-xl overflow-hidden aspect-video">
              {displayedPreviewUrl ? (
                <div className="relative h-full w-full overflow-hidden">
                  <iframe
                    src={displayedPreviewUrl}
                    title={`${project.name} live page snapshot`}
                    tabIndex={-1}
                    aria-hidden="true"
                    sandbox="allow-scripts allow-same-origin"
                    className="pointer-events-none h-full w-full select-none border-0 bg-white"
                  />
                  <div className="absolute inset-0" aria-hidden="true" />
                </div>
              ) : (
                <div className={`w-full h-full flex flex-col items-center justify-center gap-3 ${theme === "dark" ? "bg-[#0d0d1a] text-white/50" : "bg-gray-100 text-gray-500"}`}>
                  <p className="text-sm">{previewError || "No runtime preview is active."}</p>
                  <button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending} className="px-3 py-2 rounded-lg bg-cyan-400 text-black text-xs font-semibold disabled:opacity-50">
                    {previewMutation.isPending ? "Starting preview…" : "Start runtime preview"}
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <Link href={`/app/editor/${projectId}`}>
                <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all"
                  style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
                  data-testid="button-open-editor">
                  <Code2 size={15} /> Open in Builder
                </button>
              </Link>
              {deploymentUrl && (
                <a href={deploymentUrl} target="_blank" rel="noopener noreferrer">
                  <button className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                    data-testid="button-view-live"><ExternalLink size={15} /> View Live</button>
                </a>
              )}
              <button className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                data-testid="button-share"><Share2 size={15} /> Share</button>
            </div>
          </GlassCard>
        </div>

        <div className="space-y-4">
          <GlassCard>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Project Info</h3>
            <div className="space-y-3">
              {[
                { label: "Name", value: project.name },
                { label: "Type", value: project.type.charAt(0).toUpperCase() + project.type.slice(1) },
                { label: "Framework", value: project.framework },
                { label: "Created", value: fmtDate(project.createdAt) },
                { label: "ID", value: `proj_${project.id}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{label}</span>
                  <span className={`text-xs font-medium font-mono ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>{value}</span>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Publishing</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Status</span>
                <span className={`text-xs font-semibold ${published ? "text-emerald-400" : theme === "dark" ? "text-white/60" : "text-gray-600"}`}>{published ? "Live" : "Draft"}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className={`shrink-0 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Included address</span>
                <span className={`break-all text-right text-xs font-medium ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>
                  {publishingSettings?.subdomainSlug ? `${publishingSettings.subdomainSlug}.apps.buildcustom.ai` : "Not assigned"}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className={`shrink-0 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Custom domain</span>
                <span className={`break-all text-right text-xs font-medium ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>
                  {publishingSettings?.customDomain || "Not connected"}
                </span>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className={`font-semibold mb-3 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Quick Actions</h3>
            <div className="space-y-2">
              {[
                { icon: Download, label: "Export Project" },
                { icon: Copy, label: "Duplicate" },
                { icon: Share2, label: "Share Link" },
                { icon: Trash2, label: "Delete Project", danger: true },
              ].map(({ icon: Icon, label, danger }) => (
                <button key={label}
                  className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm transition-colors ${danger
                    ? theme === "dark" ? "text-red-400/70 hover:text-red-400 hover:bg-red-500/10" : "text-red-500 hover:bg-red-50"
                    : theme === "dark" ? "text-white/60 hover:text-white hover:bg-white/5" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                  data-testid={`button-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

// ── FILES (realistic demo — no real filesystem yet) ───────────────────────────
const DEMO_FILES = [
  { name: "src", type: "folder", children: [
    { name: "components", type: "folder", children: [] },
    { name: "pages", type: "folder", children: [] },
    { name: "App.tsx", type: "file", size: "4.2 KB", lang: "tsx" },
    { name: "index.css", type: "file", size: "1.8 KB", lang: "css" },
    { name: "main.tsx", type: "file", size: "0.5 KB", lang: "tsx" },
  ]},
  { name: "public", type: "folder", children: [] },
  { name: "package.json", type: "file", size: "2.1 KB", lang: "json" },
  { name: "tailwind.config.js", type: "file", size: "0.9 KB", lang: "js" },
  { name: "vite.config.ts", type: "file", size: "0.7 KB", lang: "ts" },
  { name: "index.html", type: "file", size: "0.6 KB", lang: "html" },
];

function FileRow({ file, depth = 0 }: { file: any; depth?: number }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(depth === 0);
  const isFolder = file.type === "folder";
  const langColors: Record<string, string> = { tsx: "text-cyan-400", ts: "text-blue-400", js: "text-amber-400", css: "text-pink-400", json: "text-green-400", html: "text-orange-400" };
  return (
    <div>
      <div onClick={() => isFolder && setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${theme === "dark" ? "hover:bg-white/5 text-white/70" : "hover:bg-gray-50 text-gray-700"}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }} data-testid={`file-row-${file.name}`}>
        {isFolder ? (
          <>{open ? <ChevronDown size={14} className={theme === "dark" ? "text-white/30" : "text-gray-400"} /> : <ChevronRight size={14} className={theme === "dark" ? "text-white/30" : "text-gray-400"} />}<FolderTree size={14} className="text-amber-400" /></>
        ) : (
          <><span className="w-3.5" /><Code2 size={14} className={langColors[file.lang] || "text-white/40"} /></>
        )}
        <span className="flex-1">{file.name}</span>
        {!isFolder && <span className={`text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{file.size}</span>}
      </div>
      {isFolder && open && file.children?.map((child: any, i: number) => <FileRow key={i} file={child} depth={depth + 1} />)}
    </div>
  );
}

function FilesTab() {
  const { theme } = useTheme();
  const [, params] = useRoute("/app/project/:id");
  const projectId = params?.id || "";
  const { data, isLoading, error } = useQuery({
    queryKey: ["runtime-files", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/files`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to load runtime files.");
      return body;
    },
    enabled: Boolean(projectId),
  });
  const files = Array.isArray(data) ? data : data?.files || [];
  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Runtime Workspace Files</h3>
      </div>
      {isLoading && <p className="text-sm text-white/50">Loading workspace…</p>}
      {error && <p className="text-sm text-red-400">{(error as Error).message}</p>}
      <div className={`rounded-xl overflow-hidden border ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
        {!isLoading && !error && files.length === 0 && <p className="p-4 text-sm text-white/40">The runtime workspace has no files yet.</p>}
        {files.map((file: any, i: number) => <FileRow key={file.path || file.name || i} file={{
          ...file, name: file.name || file.path?.split("/").pop(), type: file.type || "file",
          size: file.size ? `${Math.round(file.size / 1024 * 10) / 10} KB` : undefined,
        }} />)}
      </div>
    </GlassCard>
  );
}

// ── CONSOLE (realistic demo) ──────────────────────────────────────────────────
const CONSOLE_LINES = [
  { time: "10:42:01", type: "info", msg: "Server started on port 5000" },
  { time: "10:42:02", type: "success", msg: "Database connection established" },
  { time: "10:42:03", type: "info", msg: "Vite dev server running at http://localhost:5173" },
  { time: "10:43:15", type: "info", msg: "GET /api/projects 200 OK (12ms)" },
  { time: "10:43:22", type: "warn", msg: "Image at /public/hero.jpg exceeds recommended size (2.4MB)" },
  { time: "10:44:01", type: "info", msg: "POST /api/waitlist 201 Created (34ms)" },
  { time: "10:44:58", type: "error", msg: "Failed to load module: chart.js — check your imports" },
  { time: "10:45:12", type: "info", msg: "Hot reload triggered — rebuilding..." },
  { time: "10:45:13", type: "success", msg: "Build complete in 847ms" },
];
function ConsoleTab() {
  const { theme } = useTheme();
  const [, params] = useRoute("/app/project/:id");
  const { data, isLoading, error } = useQuery({
    queryKey: ["runtime-console", params?.id],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${params?.id}/runtime/console`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to load runtime console.");
      return body;
    },
    enabled: Boolean(params?.id),
  });
  const lines = Array.isArray(data) ? data : data?.lines || data?.logs || [];
  const typeStyles: Record<string, string> = { info: theme === "dark" ? "text-white/50" : "text-gray-500", success: "text-emerald-400", warn: "text-amber-400", error: "text-red-400" };
  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Console</h3>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Runtime</span>
        </div>
        <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white/60 hover:bg-white/15" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`} data-testid="button-clear-console"><Trash2 size={13} /> Clear</button>
      </div>
      <div className={`rounded-xl font-mono text-xs p-4 space-y-2 max-h-[420px] overflow-y-auto ${theme === "dark" ? "bg-black/40 border border-white/10" : "bg-gray-900 border border-gray-700"}`}>
        {isLoading && <div className="text-white/40">Loading runtime logs…</div>}
        {error && <div className="text-red-400">{(error as Error).message}</div>}
        {!isLoading && !error && lines.map((line: any, i: number) => (
          <div key={i} className="flex items-start gap-3">
            <span className="text-white/20 shrink-0">{line.time}</span>
            <span className={`uppercase text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${line.type === "error" ? "bg-red-500/20 text-red-400" : line.type === "warn" ? "bg-amber-500/20 text-amber-400" : line.type === "success" ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/30"}`}>{line.type}</span>
            <span className={typeStyles[line.type] || "text-white/60"}>{line.msg}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── VERSION HISTORY (realistic demo) ─────────────────────────────────────────
const VERSIONS = [
  { version: "v1.4", label: "Added contact form validation", author: "You", time: "2 hours ago", current: true },
  { version: "v1.3", label: "Responsive mobile nav", author: "You", time: "1 day ago", current: false },
  { version: "v1.2", label: "SEO meta tags added", author: "You", time: "2 days ago", current: false },
  { version: "v1.1", label: "Hero section redesign", author: "You", time: "4 days ago", current: false },
  { version: "v1.0", label: "Initial build", author: "AI Builder", time: "Project created", current: false },
];
function HistoryTab() {
  const { theme } = useTheme();
  const [, params] = useRoute("/app/project/:id");
  const [deployMessage, setDeployMessage] = useState("");
  const deployMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${params?.id}/runtime/deployments`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to deploy runtime revision.");
      return body;
    },
    onSuccess: (body) => setDeployMessage(body.url ? `Deployed: ${body.url}` : "Deployment completed."),
    onError: (error: any) => setDeployMessage(error.message),
  });
  return (
    <GlassCard>
      <h3 className={`font-semibold mb-5 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Version History</h3>
      {deployMessage && <p className={`mb-4 text-sm ${deployMessage.startsWith("Unable") || deployMessage.includes("not configured") ? "text-red-400" : "text-emerald-400"}`}>{deployMessage}</p>}
      <div className="space-y-3">
        <div className={`flex items-center gap-4 p-4 rounded-xl border ${theme === "dark" ? "border-cyan-400/30 bg-cyan-500/5" : "border-cyan-400 bg-cyan-50"}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${theme === "dark" ? "bg-white/10 text-white" : "bg-gray-100 text-gray-700"}`}>Git</div>
          <div className="flex-1">
            <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Current Agent workspace</p>
            <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Conversational revisions are committed inside the isolated runtime workspace.</p>
          </div>
          <button onClick={() => deployMutation.mutate()} disabled={deployMutation.isPending} className="px-2.5 py-1.5 rounded-lg bg-purple-500/15 text-purple-300 text-xs font-semibold disabled:opacity-50">{deployMutation.isPending ? "Deploying…" : "Deploy current"}</button>
        </div>
      </div>
    </GlassCard>
  );
}

// ── PROJECT SETTINGS (real) ───────────────────────────────────────────────────
export function PublishingSettingsCard({ projectId, deploymentUrl }: { projectId: number; deploymentUrl?: string }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [form, setForm] = useState({ subdomainSlug: "", hostingProvider: "buildcustom", customDomain: "", customOrigin: "" });
  const [customDomainEnabled, setCustomDomainEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const { data: settings, isLoading } = useQuery({
    queryKey: ["publishing-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/publishing-settings`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to load publishing settings.");
      return body;
    },
  });
  useEffect(() => {
    if (!settings) return;
    setForm({
      subdomainSlug: settings.subdomainSlug || "",
      hostingProvider: settings.hostingProvider || "buildcustom",
      customDomain: settings.customDomain || "",
      customOrigin: settings.customOrigin || "",
    });
    setCustomDomainEnabled(Boolean(settings.customDomain) || settings.hostingProvider === "custom");
  }, [settings]);
  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/publishing-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(customDomainEnabled ? form : {
          ...form,
          hostingProvider: "buildcustom",
          customDomain: "",
          customOrigin: "",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to save publishing settings.");
      return body;
    },
    onSuccess: (body) => {
      qc.setQueryData(["publishing-settings", projectId], body);
      setMessage("Publishing settings saved.");
    },
    onError: (error: any) => setMessage(error.message),
  });
  const fieldClass = `w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors ${theme === "dark" ? "border-white/10 bg-white/5 text-white focus:border-cyan-400/50" : "border-gray-200 bg-gray-50 text-gray-900 focus:border-cyan-400"}`;
  if (isLoading) return <div className={`h-56 animate-pulse rounded-2xl ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />;
  return (
    <GlassCard>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Publishing</h3>
          <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Manage the included project address and optional custom domain.</p>
        </div>
        {deploymentUrl && <a href={deploymentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-emerald-400"><ExternalLink size={13} /> View live</a>}
      </div>
      <div className="space-y-4">
        <div>
          <label className={`mb-1.5 block text-xs font-medium ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Included project address</label>
          <div className="flex">
            <input
              value={form.subdomainSlug}
              disabled={Boolean(deploymentUrl)}
              maxLength={63}
              onChange={(e) => setForm((current) => ({ ...current, subdomainSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
              className={`${fieldClass} rounded-r-none disabled:cursor-not-allowed disabled:opacity-60`}
              data-testid="settings-subdomain"
            />
            <span className={`flex items-center rounded-r-xl border border-l-0 px-3 text-sm ${theme === "dark" ? "border-white/10 bg-white/5 text-white/40" : "border-gray-200 bg-gray-100 text-gray-500"}`}>.apps.buildcustom.ai</span>
          </div>
          {deploymentUrl && <p className={`mt-1.5 text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>The included address is locked after the first publish.</p>}
          <label className={`mt-3 flex cursor-pointer items-center gap-2 text-sm ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>
            <input
              type="checkbox"
              checked={customDomainEnabled}
              onChange={(e) => setCustomDomainEnabled(e.target.checked)}
              className="h-4 w-4 accent-cyan-400"
              data-testid="settings-use-custom-domain"
            />
            Use a custom domain
          </label>
        </div>
        {customDomainEnabled && (
          <div className={`space-y-4 rounded-xl border p-4 ${theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-gray-50/60"}`}>
            <div>
              <label className={`mb-1.5 block text-xs font-medium ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Hosting</label>
              <select value={form.hostingProvider} onChange={(e) => setForm((current) => ({ ...current, hostingProvider: e.target.value }))} className={fieldClass}>
                <option value="buildcustom">BuildCustom.Ai Hosting</option>
                <option value="custom">External hosting</option>
              </select>
            </div>
            <div>
              <label className={`mb-1.5 block text-xs font-medium ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Custom domain</label>
              <input value={form.customDomain} onChange={(e) => setForm((current) => ({ ...current, customDomain: e.target.value }))} placeholder="app.example.com" className={fieldClass} data-testid="settings-custom-domain" />
            </div>
            {form.hostingProvider === "custom" && (
              <div>
                <label className={`mb-1.5 block text-xs font-medium ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>External origin hostname</label>
                <input value={form.customOrigin} onChange={(e) => setForm((current) => ({ ...current, customOrigin: e.target.value }))} placeholder="project.hosting-provider.com" className={fieldClass} />
              </div>
            )}
          </div>
        )}
        {message && <p className={`text-xs ${message.includes("saved") ? "text-emerald-400" : "text-red-400"}`}>{message}</p>}
        <button onClick={() => { setMessage(""); save.mutate(); }} disabled={save.isPending} className="flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50">
          <Save size={15} /> {save.isPending ? "Saving…" : "Save publishing settings"}
        </button>
      </div>
    </GlassCard>
  );
}

function ProjectSettingsTab({ project, projectId, runtimeStatus }: { project: any; projectId: number; runtimeStatus: any }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ name: project.name, description: project.description, framework: project.framework });
  const [saved, setSaved] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", projectId] }); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); navigate("/app"); },
  });

  return (
    <div className="max-w-5xl space-y-6">
      <GlassCard>
        <h3 className={`font-semibold mb-5 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>General</h3>
        <div className="space-y-4">
          {[
            { label: "Project Name", key: "name" },
            { label: "Description", key: "description" },
            { label: "Framework", key: "framework" },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{label}</label>
              <input
                value={(form as any)[key]}
                onChange={e => set(key, e.target.value)}
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                data-testid={`input-${key}`}
              />
            </div>
          ))}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Status</label>
            <select
              value={form.name !== project.name || form.description !== project.description ? form.framework : project.status}
              onChange={() => {}}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="input-status"
            >
              {["draft", "live", "building"].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 ${saved ? "bg-emerald-400 text-black" : "bg-cyan-400 text-black"}`}
            data-testid="button-save-settings">
            {saved ? <><Check size={15} /> Saved!</> : saveMutation.isPending ? "Saving..." : <><Save size={15} /> Save Changes</>}
          </button>
        </div>
      </GlassCard>

      <PublishingSettingsCard projectId={projectId} deploymentUrl={runtimeStatus?.deploymentUrl} />

      <SEOTab projectId={projectId} project={project} deploymentUrl={runtimeStatus?.deploymentUrl} />

      <GlassCard>
        <h3 className="font-semibold mb-2 text-red-400">Danger Zone</h3>
        <p className={`text-sm mb-4 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>These actions cannot be undone.</p>
        <div className="flex gap-3">
          <button
            onClick={() => { if (confirm(`Delete "${project.name}"? This cannot be undone.`)) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            data-testid="button-delete">
            {deleteMutation.isPending ? "Deleting..." : "Delete Project"}
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

// ── PAGES (real) ──────────────────────────────────────────────────────────────
function NewPageModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", slug: "", pageType: "standard", status: "draft" });
  const [error, setError] = useState("");
  const set = (k: string, v: string) => { setForm(f => ({ ...f, [k]: v })); };
  const autoSlug = (title: string) => "/" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/pages`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...form, slug: form.slug || autoSlug(form.title) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create page");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pages", projectId] }); onClose(); },
    onError: (err: any) => setError(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className={`relative w-full max-w-md rounded-2xl border p-6 z-10 ${theme === "dark" ? "bg-[#0d0d1a] border-white/10" : "bg-white border-gray-200"}`}>
        <h2 className={`text-lg font-bold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>New Page</h2>
        <div className="space-y-4">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Title</label>
            <input value={form.title} onChange={e => { set("title", e.target.value); if (!form.slug) setForm(f => ({ ...f, slug: autoSlug(e.target.value) })); }}
              placeholder="About Us" className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="input-page-title" />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>URL Slug</label>
            <input value={form.slug} onChange={e => set("slug", e.target.value)}
              placeholder="/about" className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none font-mono ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="input-page-slug" />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Type</label>
            <select value={form.pageType} onChange={e => set("pageType", e.target.value)}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="select-page-type">
              <option value="standard">Standard Page</option>
              <option value="service">Service Page</option>
            </select>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border ${theme === "dark" ? "border-white/10 text-white/50" : "border-gray-200 text-gray-600"}`}>Cancel</button>
            <button onClick={() => { if (!form.title.trim()) { setError("Title is required"); return; } mutation.mutate(); }}
              disabled={mutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
              data-testid="button-create-page">
              {mutation.isPending ? "Creating..." : "Create Page"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function PagesTab({ projectId }: { projectId: number }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [service, setService] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [genLoading, setGenLoading] = useState(false);

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ["pages", projectId],
    queryFn: async () => { const res = await fetch(`/api/projects/${projectId}/pages`, { headers: authHeaders() }); return res.json(); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (pageId: number) => {
      await fetch(`/api/projects/${projectId}/pages/${pageId}`, { method: "DELETE", headers: authHeaders() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pages", projectId] }),
  });

  const generatePage = async () => {
    if (!service || !city) return;
    setGenLoading(true);
    const slug = `/${service.toLowerCase().replace(/\s+/g, "-")}-${city.toLowerCase().replace(/\s+/g, "-")}${state ? `-${state.toLowerCase()}` : ""}`;
    const title = `${service} ${city}${state ? ` ${state}` : ""}`;
    await fetch(`/api/projects/${projectId}/pages`, {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ title, slug, pageType: "service", status: "draft" }),
    });
    qc.invalidateQueries({ queryKey: ["pages", projectId] });
    setGenLoading(false);
    setService(""); setCity(""); setState(""); setShowGenerator(false);
  };

  const standardPages = pages.filter((p: any) => p.pageType !== "service");
  const servicePages = pages.filter((p: any) => p.pageType === "service");

  return (
    <div className="space-y-6">
      {showNew && <NewPageModal projectId={projectId} onClose={() => setShowNew(false)} />}

      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Pages</h2>
          <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
            {pages.length} pages · {pages.filter((p: any) => p.status === "published").length} published
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowGenerator(!showGenerator)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            data-testid="button-service-page-generator"><MapPin size={15} /> Service Page Generator</button>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
            style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
            data-testid="button-new-page"><Plus size={15} /> New Page</button>
        </div>
      </div>

      <AnimatePresence>
        {showGenerator && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <GlassCard className="border-purple-500/20">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center"><Wand2 size={18} className="text-purple-400" /></div>
                <div>
                  <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Service + City Page Generator</h3>
                  <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Generate SEO-optimized local service pages instantly</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                {[{ label: "Service Type", value: service, set: setService, placeholder: "e.g. Plumber", test: "input-service-type" },
                  { label: "City", value: city, set: setCity, placeholder: "e.g. Austin", test: "input-city" },
                  { label: "State", value: state, set: setState, placeholder: "e.g. TX", test: "input-state" }].map(f => (
                  <div key={f.label}>
                    <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{f.label}</label>
                    <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                      className={`w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-purple-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-purple-400"}`}
                      data-testid={f.test} />
                  </div>
                ))}
              </div>
              {service && city && (
                <div className={`rounded-xl p-3 mb-4 text-xs font-mono ${theme === "dark" ? "bg-white/5 border border-white/10 text-white/60" : "bg-gray-50 border border-gray-200 text-gray-600"}`}>
                  URL preview: /{service.toLowerCase().replace(/\s+/g, "-")}-{city.toLowerCase().replace(/\s+/g, "-")}{state ? `-${state.toLowerCase()}` : ""}
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={generatePage} disabled={!service || !city || genLoading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(90deg, #a855f7, #ec4899)" }}
                  data-testid="button-generate-page">
                  <Wand2 size={15} /> {genLoading ? "Generating..." : "Generate Page"}
                </button>
                <button onClick={() => setShowGenerator(false)} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"}`}>Cancel</button>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className={`h-14 rounded-xl animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />)}</div>
      ) : (
        <>
          <GlassCard>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Standard Pages</h3>
            {standardPages.length === 0 ? (
              <p className={`text-sm text-center py-6 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>No pages yet. Click "New Page" to create one.</p>
            ) : (
              <div className="space-y-2">
                {standardPages.map((page: any) => (
                  <div key={page.id} className={`flex items-center gap-4 p-3 rounded-xl transition-colors ${theme === "dark" ? "hover:bg-white/5" : "hover:bg-gray-50"}`} data-testid={`page-row-${page.id}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${theme === "dark" ? "bg-white/10" : "bg-gray-100"}`}><FileText size={14} className={theme === "dark" ? "text-white/40" : "text-gray-500"} /></div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{page.title}</p>
                      <p className={`text-xs truncate mt-0.5 font-mono ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{page.slug}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${page.status === "published" ? "bg-emerald-500/15 text-emerald-400" : theme === "dark" ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"}`}>{page.status}</span>
                    <button onClick={() => deleteMutation.mutate(page.id)} className={`p-1.5 rounded-lg transition-colors ${theme === "dark" ? "hover:bg-red-500/10 text-white/30 hover:text-red-400" : "hover:bg-red-50 text-gray-400 hover:text-red-500"}`} data-testid={`button-delete-page-${page.id}`}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {servicePages.length > 0 && (
            <GlassCard>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Service Pages <span className={`text-xs font-normal ml-2 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{servicePages.length} pages</span></h3>
                <span className={`text-xs px-2 py-1 rounded-full ${theme === "dark" ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" : "bg-purple-50 text-purple-700 border border-purple-200"}`}>AI Generated</span>
              </div>
              <div className="space-y-2">
                {servicePages.map((page: any) => (
                  <div key={page.id} className={`flex items-center gap-4 p-3 rounded-xl transition-colors ${theme === "dark" ? "hover:bg-white/5" : "hover:bg-gray-50"}`} data-testid={`page-row-${page.id}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${theme === "dark" ? "bg-purple-500/10" : "bg-purple-50"}`}><MapPin size={14} className="text-purple-400" /></div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{page.title}</p>
                      <p className={`text-xs truncate mt-0.5 font-mono ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{page.slug}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${page.status === "published" ? "bg-emerald-500/15 text-emerald-400" : theme === "dark" ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"}`}>{page.status}</span>
                    <button onClick={() => deleteMutation.mutate(page.id)} className={`p-1.5 rounded-lg transition-colors ${theme === "dark" ? "hover:bg-red-500/10 text-white/30 hover:text-red-400" : "hover:bg-red-50 text-gray-400 hover:text-red-500"}`} data-testid={`button-delete-page-${page.id}`}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </>
      )}
    </div>
  );
}

// ── BLOG (real) ───────────────────────────────────────────────────────────────
function NewPostModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", keyword: "", content: "", status: "draft" });
  const [error, setError] = useState("");
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/blog-posts`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create post");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["blog-posts", projectId] }); onClose(); },
    onError: (err: any) => setError(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className={`relative w-full max-w-lg rounded-2xl border p-6 z-10 ${theme === "dark" ? "bg-[#0d0d1a] border-white/10" : "bg-white border-gray-200"}`}>
        <h2 className={`text-lg font-bold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>New Blog Post</h2>
        <div className="space-y-4">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Title</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="10 Tips for Better SEO"
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="input-post-title" />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Target Keyword</label>
            <input value={form.keyword} onChange={e => set("keyword", e.target.value)} placeholder="e.g. plumber Austin TX"
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="input-post-keyword" />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Content</label>
            <textarea value={form.content} onChange={e => set("content", e.target.value)} rows={5} placeholder="Write your post content here..."
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none resize-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="input-post-content" />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Status</label>
            <select value={form.status} onChange={e => set("status", e.target.value)}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="select-post-status">
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="scheduled">Scheduled</option>
            </select>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border ${theme === "dark" ? "border-white/10 text-white/50" : "border-gray-200 text-gray-600"}`}>Cancel</button>
            <button onClick={() => { if (!form.title.trim()) { setError("Title is required"); return; } mutation.mutate(); }}
              disabled={mutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
              data-testid="button-create-post">
              {mutation.isPending ? "Creating..." : "Create Post"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function BlogTab({ projectId }: { projectId: number }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "published" | "scheduled" | "draft">("all");
  const [showNew, setShowNew] = useState(false);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["blog-posts", projectId],
    queryFn: async () => { const res = await fetch(`/api/projects/${projectId}/blog-posts`, { headers: authHeaders() }); return res.json(); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (postId: number) => {
      await fetch(`/api/projects/${projectId}/blog-posts/${postId}`, { method: "DELETE", headers: authHeaders() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blog-posts", projectId] }),
  });

  const filtered = filter === "all" ? posts : posts.filter((p: any) => p.status === filter);

  return (
    <div className="space-y-6">
      {showNew && <NewPostModal projectId={projectId} onClose={() => setShowNew(false)} />}

      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Blog</h2>
          <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
            {posts.length} posts · {posts.filter((p: any) => p.status === "published").length} live
          </p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
          style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
          data-testid="button-new-post"><Plus size={15} /> New Post</button>
      </div>

      <div className="flex gap-2">
        {(["all", "published", "scheduled", "draft"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium capitalize transition-colors ${filter === f ? "bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-400 border border-cyan-500/20" : theme === "dark" ? "text-white/50 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`}
            data-testid={`filter-${f}`}>{f}</button>
        ))}
      </div>

      <GlassCard>
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className={`h-14 rounded-xl animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />)}</div>
        ) : filtered.length === 0 ? (
          <p className={`text-sm text-center py-8 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>
            {filter === "all" ? "No blog posts yet. Click \"New Post\" to create your first one." : `No ${filter} posts.`}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((post: any) => (
              <div key={post.id} className={`flex items-center gap-4 p-3 rounded-xl transition-colors ${theme === "dark" ? "hover:bg-white/5" : "hover:bg-gray-50"}`} data-testid={`post-row-${post.id}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${theme === "dark" ? "bg-white/10" : "bg-gray-100"}`}><Newspaper size={14} className={theme === "dark" ? "text-white/40" : "text-gray-500"} /></div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{post.title}</p>
                  <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>
                    {post.wordCount.toLocaleString()} words{post.keyword ? ` · ${post.keyword}` : ""} · {fmtDate(post.createdAt)}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${post.status === "published" ? "bg-emerald-500/15 text-emerald-400" : post.status === "scheduled" ? "bg-amber-500/15 text-amber-400" : theme === "dark" ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"}`}>{post.status}</span>
                <button onClick={() => deleteMutation.mutate(post.id)} className={`p-1.5 rounded-lg transition-colors shrink-0 ${theme === "dark" ? "hover:bg-red-500/10 text-white/30 hover:text-red-400" : "hover:bg-red-50 text-gray-400 hover:text-red-500"}`} data-testid={`button-delete-post-${post.id}`}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ── AUTO-BLOGGER (real) ───────────────────────────────────────────────────────
function AutoBloggerTab({ projectId }: { projectId: number }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["autoblogger", projectId],
    queryFn: async () => { const res = await fetch(`/api/projects/${projectId}/autoblogger`, { headers: authHeaders() }); return res.json(); },
  });

  const [form, setForm] = useState<any>(null);
  if (settings && !form) setForm(settings);
  const s = form || settings || { enabled: false, postsPerDay: 3, writingStyle: "neil-patel", minWordCount: 2000, keywords: "" };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...(f || s), [k]: v }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/autoblogger`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(s),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: (data) => { qc.setQueryData(["autoblogger", projectId], data); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });

  if (isLoading) return <div className={`h-64 rounded-2xl animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Auto-Blogger</h2>
          <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>AI writes and publishes SEO-optimized blogs automatically</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{s.enabled ? "Active" : "Paused"}</span>
          <button onClick={() => set("enabled", !s.enabled)}
            className={`relative w-12 h-6 rounded-full transition-colors ${s.enabled ? "bg-gradient-to-r from-cyan-500 to-purple-500" : theme === "dark" ? "bg-white/10" : "bg-gray-200"}`}
            data-testid="toggle-autoblogger">
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${s.enabled ? "left-7" : "left-1"}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard>
          <h3 className={`font-semibold mb-5 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Settings</h3>
          <div className="space-y-5">
            <div>
              <label className={`block text-xs font-medium mb-2 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Posts Per Day</label>
              <div className="flex gap-2">
                {[1, 2, 3, 5, 10].map(n => (
                  <button key={n} onClick={() => set("postsPerDay", n)}
                    className={`w-10 h-10 rounded-xl text-sm font-semibold transition-colors ${s.postsPerDay === n ? "bg-gradient-to-br from-cyan-500 to-purple-500 text-white" : theme === "dark" ? "bg-white/10 text-white/60 hover:bg-white/15" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    data-testid={`frequency-${n}`}>{n}</button>
                ))}
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-2 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Writing Style</label>
              <div className="space-y-2">
                {[
                  { id: "neil-patel", label: "Neil Patel Style", desc: "Direct, data-driven, actionable" },
                  { id: "conversational", label: "Conversational", desc: "Friendly, approachable, easy to read" },
                  { id: "authority", label: "Authority Expert", desc: "Technical, comprehensive, credibility-focused" },
                ].map(style => (
                  <div key={style.id} onClick={() => set("writingStyle", style.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-colors ${s.writingStyle === style.id ? theme === "dark" ? "border-cyan-400/40 bg-cyan-500/5" : "border-cyan-400 bg-cyan-50" : theme === "dark" ? "border-white/5 hover:border-white/10" : "border-gray-100 hover:border-gray-200"}`}
                    data-testid={`style-${style.id}`}>
                    <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{style.label}</p>
                    <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{style.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Minimum Word Count</label>
              <input type="number" value={s.minWordCount} onChange={e => set("minWordCount", parseInt(e.target.value) || 1000)}
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                data-testid="input-min-words" />
            </div>

            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className={`w-full py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${saved ? "bg-emerald-400 text-black" : "text-white"}`}
              style={saved ? {} : { background: "linear-gradient(90deg, #00c9b7, #6366f1, #ec4899)" }}
              data-testid="button-save-autoblogger">
              {saved ? <><Check size={15} /> Saved!</> : saveMutation.isPending ? "Saving..." : <><Save size={15} /> Save Settings</>}
            </button>
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Target Keywords</h3>
          <p className={`text-xs mb-3 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>One keyword per line. AI will write about each topic in rotation.</p>
          <textarea value={s.keywords} onChange={e => set("keywords", e.target.value)} rows={8}
            className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors resize-none font-mono ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
            placeholder="plumber Austin TX&#10;emergency plumber Dallas&#10;water heater repair Texas"
            data-testid="input-keywords" />
          <p className={`text-xs mt-2 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{s.keywords.split("\n").filter((k: string) => k.trim()).length} keywords configured</p>
        </GlassCard>
      </div>
    </div>
  );
}

// ── SEO (real) ────────────────────────────────────────────────────────────────
function GuidedSeoField({
  value, onChange, suggestions, maxLength, multiline = false, rows = 1, className, testId,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  maxLength: number;
  multiline?: boolean;
  rows?: number;
  className: string;
  testId?: string;
}) {
  const { theme } = useTheme();
  const next = suggestions.find((suggestion) =>
    suggestion.length <= maxLength &&
    suggestion.length > value.length &&
    suggestion.toLowerCase().startsWith(value.toLowerCase()),
  );
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Tab" && !event.shiftKey && next) {
      event.preventDefault();
      onChange(next);
    }
  };
  const fieldProps = {
    value,
    maxLength,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    onKeyDown: handleKeyDown,
    className: `${className} relative z-0`,
    "data-testid": testId,
  };
  return (
    <>
      <div className="relative">
        {multiline
          ? <textarea {...fieldProps} rows={rows} />
          : <input {...fieldProps} />}
        {next && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 overflow-hidden whitespace-pre-wrap px-4 py-2.5 text-sm ${theme === "dark" ? "text-white/25" : "text-gray-400"}`}
          >
            <span className="invisible">{value}</span>{next.slice(value.length)}
          </div>
        )}
      </div>
      {next && (
        <p className={`mt-1 flex items-center gap-1.5 text-[11px] ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>
          <kbd className={`rounded border px-1.5 py-0.5 font-sans ${theme === "dark" ? "border-white/15 bg-white/5" : "border-gray-200 bg-gray-50"}`}>Tab</kbd>
          to use this suggestion
        </p>
      )}
    </>
  );
}

export function SEOTab({ projectId, project, deploymentUrl }: { projectId: number; project?: any; deploymentUrl?: string }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [activeSection, setActiveSection] = useState("meta");
  const [metaSaved, setMetaSaved] = useState(false);
  const [schemaSaved, setSchemaSaved] = useState(false);
  const [metaError, setMetaError] = useState("");
  const [schemaError, setSchemaError] = useState("");
  const [faviconError, setFaviconError] = useState("");
  const [socialImageError, setSocialImageError] = useState("");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["seo", projectId],
    queryFn: async () => { const res = await fetch(`/api/projects/${projectId}/seo`, { headers: authHeaders() }); return res.json(); },
  });
  const suggestionQuery = useQuery({
    queryKey: ["seo-suggestions", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/seo/suggestions`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to analyze this project.");
      return body;
    },
    retry: false,
    staleTime: 15 * 60_000,
  });

  const [metaForm, setMetaForm] = useState<any>(null);
  const [schemaForm, setSchemaForm] = useState<any>(null);
  if (settings && !metaForm) {
    setMetaForm({
      metaTitle: settings.metaTitle,
      metaDescription: settings.metaDescription,
      focusKeyword: settings.focusKeyword,
      seoKeywords: settings.seoKeywords || "",
      longTailKeywords: settings.longTailKeywords || "",
      faviconData: settings.faviconData || "",
      canonicalUrl: settings.canonicalUrl || "",
      ogTitle: settings.ogTitle || "",
      ogDescription: settings.ogDescription || "",
      ogImageUrl: settings.ogImageUrl || "",
      hasSocialImage: settings.hasSocialImage === true,
      allowIndexing: settings.allowIndexing !== false,
    });
  }
  if (settings && !schemaForm) { setSchemaForm(settings.schemaJson || "{}"); }

  const meta = metaForm || {
    metaTitle: "", metaDescription: "", focusKeyword: "", seoKeywords: "", longTailKeywords: "", faviconData: "", canonicalUrl: "",
    ogTitle: "", ogDescription: "", ogImageUrl: "", hasSocialImage: false, allowIndexing: true,
  };
  const schema = schemaForm ?? "{}";
  const projectName = String(project?.name || "My Project").trim();
  const canonicalSuggestion = deploymentUrl || `https://${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.apps.buildcustom.ai`;
  const titleSuggestions = suggestionQuery.data?.metaTitle || [];
  const descriptionSuggestions = suggestionQuery.data?.metaDescription || [];
  const keywordSuggestions = suggestionQuery.data?.focusKeyword || [];

  useEffect(() => {
    const suggestions = suggestionQuery.data;
    if (!suggestions || !metaForm) return;
    setMetaForm((current: any) => {
      const next = {
        ...current,
        metaTitle: current.metaTitle || suggestions.metaTitle?.[0] || "",
        metaDescription: current.metaDescription || suggestions.metaDescription?.[0] || "",
        focusKeyword: current.focusKeyword || suggestions.focusKeyword?.[0] || "",
        seoKeywords: current.seoKeywords || suggestions.keywords?.join("\n") || "",
        longTailKeywords: current.longTailKeywords || suggestions.longTailKeywords?.join("\n") || "",
        canonicalUrl: current.canonicalUrl || canonicalSuggestion,
        ogTitle: current.ogTitle || suggestions.ogTitle?.[0] || suggestions.metaTitle?.[0] || "",
        ogDescription: current.ogDescription || suggestions.ogDescription?.[0] || suggestions.metaDescription?.[0] || "",
        ogImageUrl: current.ogImageUrl || "https://buildcustom.ai/opengraph.jpg",
      };
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
    setSchemaForm((current: string | null) => !current || current === "{}" ? suggestions.schemaJson || "{}" : current);
  }, [suggestionQuery.data, metaForm, canonicalSuggestion]);

  const socialImageUpload = useMutation({
    mutationFn: async (data: string) => {
      setSocialImageError("");
      const res = await fetch(`/api/projects/${projectId}/seo/social-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ data }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to upload the social image.");
      return body;
    },
    onSuccess: (data) => {
      qc.setQueryData(["seo", projectId], data);
      setMetaForm((current: any) => ({ ...current, ogImageUrl: data.ogImageUrl || "", hasSocialImage: true }));
    },
    onError: (error: Error) => setSocialImageError(error.message),
  });

  const socialImageRemove = useMutation({
    mutationFn: async () => {
      setSocialImageError("");
      const res = await fetch(`/api/projects/${projectId}/seo/social-image`, { method: "DELETE", headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to remove the social image.");
      return body;
    },
    onSuccess: (data) => {
      qc.setQueryData(["seo", projectId], data);
      setMetaForm((current: any) => ({ ...current, ogImageUrl: "", hasSocialImage: false }));
    },
    onError: (error: Error) => setSocialImageError(error.message),
  });

  const saveMeta = useMutation({
    mutationFn: async () => {
      setMetaError("");
      for (const [value, message] of [
        [meta.canonicalUrl, "Enter a valid canonical URL."],
        [meta.ogImageUrl, "Enter a valid social image URL."],
      ] as const) {
        if (!value) continue;
        try {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        } catch {
          throw new Error(message);
        }
      }
      const res = await fetch(`/api/projects/${projectId}/seo`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(meta) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to save");
      return body;
    },
    onSuccess: (data) => { qc.setQueryData(["seo", projectId], data); setMetaSaved(true); setTimeout(() => setMetaSaved(false), 2000); },
    onError: (error: Error) => setMetaError(error.message),
  });

  const saveSchema = useMutation({
    mutationFn: async () => {
      setSchemaError("");
      try {
        const parsed = JSON.parse(schema);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch {
        throw new Error("Enter valid structured data as a JSON object.");
      }
      const res = await fetch(`/api/projects/${projectId}/seo`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ schemaJson: schema }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to save");
      return body;
    },
    onSuccess: (data) => { qc.setQueryData(["seo", projectId], data); setSchemaSaved(true); setTimeout(() => setSchemaSaved(false), 2000); },
    onError: (error: Error) => setSchemaError(error.message),
  });

  const SEO_SCORE_ITEMS = [
    { label: "Meta title set", status: meta.metaTitle ? "pass" : "fail" },
    { label: "Meta description set", status: meta.metaDescription ? "pass" : "fail" },
    { label: "Focus keyword set", status: meta.focusKeyword ? "pass" : "fail" },
    { label: "Structured data (JSON-LD)", status: schema && schema !== "{}" ? "pass" : "warn" },
    { label: "Sitemap.xml", status: "pass" },
    { label: "Robots.txt configured", status: "pass" },
    { label: "Open Graph tags", status: meta.ogTitle && meta.ogDescription && meta.ogImageUrl ? "pass" : "warn" },
    { label: "Image alt text review", status: "warn" },
    { label: "Page speed measurement", status: "warn" },
  ];
  const passing = SEO_SCORE_ITEMS.filter(i => i.status === "pass").length;
  const score = Math.round((passing / SEO_SCORE_ITEMS.length) * 100);

  if (isLoading) return <div className={`h-64 rounded-2xl animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>SEO</h2>
          <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Search engine optimization settings</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <GlassCard className="flex flex-col items-center justify-center text-center">
          <div className="relative w-28 h-28 mb-4">
            <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke={theme === "dark" ? "rgba(255,255,255,0.05)" : "#f3f4f6"} strokeWidth="10" />
              <circle cx="50" cy="50" r="40" fill="none" stroke="url(#seoGrad)" strokeWidth="10"
                strokeDasharray={`${2.51 * score} ${251 - 2.51 * score}`} strokeLinecap="round" />
              <defs><linearGradient id="seoGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#00c9b7" /><stop offset="100%" stopColor="#a855f7" /></linearGradient></defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{score}</span>
              <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>/ 100</span>
            </div>
          </div>
          <p className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>SEO Health Score</p>
          <p className={`text-xs mt-1 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{passing} of {SEO_SCORE_ITEMS.length} checks passing</p>
        </GlassCard>

        <div className="lg:col-span-2">
          <GlassCard>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>SEO Checklist</h3>
            <div className="space-y-2">
              {SEO_SCORE_ITEMS.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  {item.status === "pass" && <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />}
                  {item.status === "warn" && <AlertCircle size={16} className="text-amber-400 shrink-0" />}
                  {item.status === "fail" && <XCircle size={16} className="text-red-400 shrink-0" />}
                  <span className={`text-sm ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>

      <div className="flex gap-2">
        {[{ id: "meta", label: "Meta Tags" }, { id: "schema", label: "Structured Data" }, { id: "sitemap", label: "Sitemap" }, { id: "keywords", label: "Keywords" }].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${activeSection === s.id ? "bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-400 border border-cyan-500/20" : theme === "dark" ? "text-white/50 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`}
            data-testid={`seo-tab-${s.id}`}>{s.label}</button>
        ))}
      </div>

      <GlassCard>
        {activeSection === "meta" && (
          <div className="space-y-4">
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Meta Tags</h3>
            {suggestionQuery.isLoading && (
              <p className={`rounded-xl border px-3 py-2 text-xs ${theme === "dark" ? "border-cyan-400/15 bg-cyan-400/5 text-cyan-200/60" : "border-cyan-100 bg-cyan-50 text-cyan-700"}`}>
                Reading the generated project to prepare suggestions…
              </p>
            )}
            {suggestionQuery.isError && (
              <p className={`rounded-xl border px-3 py-2 text-xs ${theme === "dark" ? "border-amber-400/15 bg-amber-400/5 text-amber-200/60" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                {suggestionQuery.error instanceof Error ? suggestionQuery.error.message : "Project-aware suggestions are unavailable."} You can still enter your own values.
              </p>
            )}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Favicon</label>
              <div className="flex items-center gap-3">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border ${theme === "dark" ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`}>
                  <img src={meta.faviconData || "/favicon.png"} alt={meta.faviconData ? "Custom favicon preview" : "BuildCustom default favicon"} className="h-8 w-8 object-contain" />
                </div>
                <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium ${theme === "dark" ? "border-white/10 text-white/70 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                  <Upload size={15} /> Upload favicon
                  <input
                    type="file"
                    accept=".png,.ico,.svg,.webp,image/png,image/x-icon,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setFaviconError("");
                      const supportedTypes = ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml", "image/webp"];
                      if (!supportedTypes.includes(file.type)) {
                        setFaviconError("Upload a PNG, ICO, SVG, or WebP favicon.");
                        return;
                      }
                      if (file.size > 250_000) {
                        setFaviconError("Favicon files must be 250 KB or less.");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => setMetaForm((current: any) => ({ ...current, faviconData: String(reader.result || "") }));
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                {meta.faviconData && <button onClick={() => setMetaForm((current: any) => ({ ...current, faviconData: "" }))} className="text-xs text-red-400">Remove</button>}
              </div>
              {faviconError && <p role="alert" className="mt-1.5 text-xs text-red-400">{faviconError}</p>}
              <p className={`mt-1.5 text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>PNG, ICO, SVG, or WebP. Maximum 250 KB. The BuildCustom logo is used until a custom favicon is uploaded.</p>
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Site Title <span className="opacity-50">(25–60 chars)</span></label>
              <GuidedSeoField value={meta.metaTitle} onChange={(value) => setMetaForm((f: any) => ({ ...f, metaTitle: value }))}
                suggestions={titleSuggestions} maxLength={60}
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                testId="input-meta-title" />
              <p className={`text-xs mt-1 ${meta.metaTitle.length > 60 ? "text-red-400" : theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{meta.metaTitle.length}/60 characters</p>
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Meta Description <span className="opacity-50">(150–160 chars)</span></label>
              <GuidedSeoField value={meta.metaDescription} onChange={(value) => setMetaForm((f: any) => ({ ...f, metaDescription: value }))}
                suggestions={descriptionSuggestions} maxLength={160} multiline rows={3}
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors resize-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                testId="input-meta-description" />
              <p className={`text-xs mt-1 ${meta.metaDescription.length > 160 ? "text-red-400" : theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{meta.metaDescription.length}/160 characters</p>
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Focus Keyword</label>
              <GuidedSeoField value={meta.focusKeyword} onChange={(value) => setMetaForm((f: any) => ({ ...f, focusKeyword: value }))}
                suggestions={keywordSuggestions} maxLength={120}
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                testId="input-focus-keyword" />
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Recommended Keywords</label>
              <textarea value={meta.seoKeywords} onChange={(event) => setMetaForm((current: any) => ({ ...current, seoKeywords: event.target.value }))}
                rows={5} maxLength={2000}
                className={`w-full resize-none rounded-xl border px-4 py-3 text-sm outline-none transition-colors ${theme === "dark" ? "border-white/10 bg-white/5 text-white focus:border-cyan-400/50" : "border-gray-200 bg-gray-50 text-gray-900 focus:border-cyan-400"}`}
                data-testid="input-seo-keywords" />
              <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>One primary or secondary search phrase per line. Edit or remove any suggestion.</p>
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Long-Tail Keywords</label>
              <textarea value={meta.longTailKeywords} onChange={(event) => setMetaForm((current: any) => ({ ...current, longTailKeywords: event.target.value }))}
                rows={6} maxLength={4000}
                className={`w-full resize-none rounded-xl border px-4 py-3 text-sm outline-none transition-colors ${theme === "dark" ? "border-white/10 bg-white/5 text-white focus:border-cyan-400/50" : "border-gray-200 bg-gray-50 text-gray-900 focus:border-cyan-400"}`}
                data-testid="input-long-tail-keywords" />
              <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>Specific phrases that match what potential customers are likely to search.</p>
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Canonical URL</label>
              <GuidedSeoField value={meta.canonicalUrl} onChange={(value) => setMetaForm((f: any) => ({ ...f, canonicalUrl: value }))}
                suggestions={[canonicalSuggestion]} maxLength={2000}
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                testId="input-canonical-url" />
            </div>
            <div className={`rounded-xl border p-4 ${theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-gray-50"}`}>
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className={`block text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Allow search engine indexing</span>
                  <span className={`block text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Turn this off to publish a noindex directive.</span>
                </span>
                <input type="checkbox" checked={meta.allowIndexing} onChange={(e) => setMetaForm((f: any) => ({ ...f, allowIndexing: e.target.checked }))} className="h-4 w-4 accent-cyan-400" />
              </label>
            </div>
            <div className={`border-t pt-4 ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
              <h4 className={`mb-3 text-sm font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Social sharing</h4>
              <div className="space-y-3">
                <GuidedSeoField value={meta.ogTitle} onChange={(value) => setMetaForm((f: any) => ({ ...f, ogTitle: value }))}
                  suggestions={suggestionQuery.data?.ogTitle || []} maxLength={120}
                  className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white" : "bg-gray-50 border-gray-200 text-gray-900"}`} />
                <GuidedSeoField value={meta.ogDescription} onChange={(value) => setMetaForm((f: any) => ({ ...f, ogDescription: value }))}
                  suggestions={suggestionQuery.data?.ogDescription || []} maxLength={500} multiline rows={2}
                  className={`w-full resize-none px-4 py-2.5 rounded-xl border text-sm outline-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white" : "bg-gray-50 border-gray-200 text-gray-900"}`} />
                <div>
                  <label className={`mb-1.5 block text-xs font-medium ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Social sharing image</label>
                  {meta.ogImageUrl && (
                    <div className={`mb-3 aspect-[1.91/1] max-w-sm overflow-hidden rounded-xl border ${theme === "dark" ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`}>
                      <img src={meta.ogImageUrl} alt="Social sharing preview" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <GuidedSeoField value={meta.ogImageUrl} onChange={(value) => setMetaForm((f: any) => ({ ...f, ogImageUrl: value, hasSocialImage: false }))}
                    suggestions={[`${canonicalSuggestion.replace(/\/$/, "")}/opengraph.jpg`]} maxLength={2000}
                    className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white" : "bg-gray-50 border-gray-200 text-gray-900"}`}
                    testId="input-social-image-url" />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-xs font-medium ${theme === "dark" ? "border-white/10 text-white/70 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                      <Upload size={14} /> {socialImageUpload.isPending ? "Uploading…" : meta.hasSocialImage ? "Replace image" : "Upload image"}
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={socialImageUpload.isPending}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (!file) return;
                          if (file.size > 5_000_000) {
                            setSocialImageError("Social images must be 5 MB or less.");
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => socialImageUpload.mutate(String(reader.result || ""));
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    {meta.hasSocialImage && (
                      <button type="button" onClick={() => socialImageRemove.mutate()} disabled={socialImageRemove.isPending} className="text-xs text-red-400 disabled:opacity-50">
                        {socialImageRemove.isPending ? "Removing…" : "Remove uploaded image"}
                      </button>
                    )}
                    <span className={`text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>Recommended: 1200×630 PNG, JPEG, or WebP.</span>
                  </div>
                  {socialImageError && <p className="mt-2 text-xs text-red-400">{socialImageError}</p>}
                </div>
              </div>
            </div>
            <p className={`text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>For published projects, saved metadata is applied to the live domain immediately.</p>
            {metaError && <p role="alert" className="text-xs text-red-400">{metaError}</p>}
            <button onClick={() => saveMeta.mutate()} disabled={saveMeta.isPending}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 ${metaSaved ? "bg-emerald-400 text-black" : "bg-cyan-400 text-black"}`}
              data-testid="button-save-meta">
              {metaSaved ? <><Check size={15} /> Saved!</> : saveMeta.isPending ? "Saving..." : <><Save size={15} /> Save Meta Tags</>}
            </button>
          </div>
        )}
        {activeSection === "schema" && (
          <div>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Structured Data (JSON-LD)</h3>
            <GuidedSeoField value={schema === "{}" ? "" : schema} onChange={(value) => setSchemaForm(value || "{}")}
              suggestions={suggestionQuery.data?.schemaJson ? [suggestionQuery.data.schemaJson] : []} maxLength={50_000} multiline rows={12}
              className={`w-full px-4 py-3 rounded-xl border text-xs outline-none transition-colors resize-none font-mono ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              testId="input-schema" />
            {schemaError && <p role="alert" className="mt-2 text-xs text-red-400">{schemaError}</p>}
            <button onClick={() => saveSchema.mutate()} disabled={saveSchema.isPending}
              className={`mt-3 flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 ${schemaSaved ? "bg-emerald-400 text-black" : "bg-cyan-400 text-black"}`}
              data-testid="button-save-schema">
              {schemaSaved ? <><Check size={15} /> Saved!</> : saveSchema.isPending ? "Saving..." : <><Save size={15} /> Save Schema</>}
            </button>
          </div>
        )}
        {activeSection === "sitemap" && (
          <div>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Sitemap</h3>
            <div className={`rounded-xl p-4 font-mono text-xs mb-4 ${theme === "dark" ? "bg-black/30 border border-white/10 text-white/60" : "bg-gray-50 border border-gray-200 text-gray-600"}`}>
              {`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://yoursite.buildcustom.ai/</loc></url>\n  <!-- pages will appear here after publishing -->\n</urlset>`}
            </div>
            <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
              style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
              data-testid="button-regenerate-sitemap"><RefreshCw size={14} /> Regenerate Sitemap</button>
          </div>
        )}
        {activeSection === "keywords" && (
          <div>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Keyword Tracking</h3>
            <p className={`text-sm ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Connect Google Search Console to track keyword rankings. This feature will be available after you connect your domain.</p>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ── ANALYTICS (demo) ──────────────────────────────────────────────────────────
function AnalyticsTab() {
  const { theme } = useTheme();
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];
  const visitors = [820, 940, 1100, 1350, 1600, 2100, 2500, 2847];
  const maxV = Math.max(...visitors);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Analytics</h2>
        <span className={`text-xs px-3 py-1.5 rounded-full border ${theme === "dark" ? "border-amber-400/30 bg-amber-400/10 text-amber-400" : "border-amber-400 bg-amber-50 text-amber-700"}`}>Demo Data — Connect domain to see real analytics</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Visitors" value="2,847" sub="+12.4% this month" trend="up" />
        <StatCard label="Page Views" value="9,340" sub="+8.2% this month" trend="up" />
        <StatCard label="Avg. Session" value="2m 14s" sub="-0.3s from last month" trend="down" />
        <StatCard label="Bounce Rate" value="38%" sub="-2% improvement" trend="up" />
      </div>
      <GlassCard>
        <h3 className={`font-semibold mb-6 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Monthly Visitors</h3>
        <div className="flex items-end gap-2 h-40">
          {visitors.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <motion.div initial={{ height: 0 }} animate={{ height: `${(v / maxV) * 100}%` }} transition={{ delay: i * 0.05, duration: 0.5, ease: "easeOut" }}
                className="w-full rounded-t-lg"
                style={{ background: i === visitors.length - 1 ? "linear-gradient(180deg, #00c9b7, #6366f1)" : theme === "dark" ? "rgba(255,255,255,0.08)" : "#e5e7eb" }} />
              <span className={`text-[10px] ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{months[i]}</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

const DOMAIN_STATUS: Record<string, { label: string; tone: string; detail: string }> = {
  pending_dns: { label: "Pending DNS", tone: "text-amber-400 bg-amber-500/15", detail: "Add the DNS records below, then check the connection." },
  verifying: { label: "Verifying", tone: "text-blue-400 bg-blue-500/15", detail: "Cloudflare is checking domain ownership." },
  ssl_provisioning: { label: "SSL provisioning", tone: "text-purple-400 bg-purple-500/15", detail: "Ownership is confirmed. Cloudflare is issuing the SSL certificate." },
  live: { label: "Live", tone: "text-emerald-400 bg-emerald-500/15", detail: "The custom domain is secure and serving this project." },
  error: { label: "Error", tone: "text-red-400 bg-red-500/15", detail: "The domain could not be connected. Review the message below." },
};

function DomainTab({ projectId, runtimeStatus }: { projectId: number; runtimeStatus: any }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [customDomain, setCustomDomain] = useState("");
  const [message, setMessage] = useState("");
  const previousStatus = useRef<string | null>(null);
  const queryKey = ["custom-domain", projectId];
  const updateDomain = (method: "POST" | "DELETE", suffix = "", body?: any) => fetch(`/api/projects/${projectId}/runtime/custom-domain${suffix}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (res) => {
    const result = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.message || "Unable to update the custom domain.");
    return result;
  });
  const domainQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/custom-domain`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to load domain settings.");
      if (body.hostname && !["live", "error"].includes(body.status)) {
        return updateDomain("POST", "/refresh");
      }
      return body;
    },
    refetchInterval: (query) => {
      const domain = query.state.data as any;
      return domain?.hostname && !["live", "error"].includes(domain.status) ? 10_000 : false;
    },
  });
  const connect = useMutation({
    mutationFn: () => updateDomain("POST", "", { hostname: customDomain }),
    onSuccess: (body) => {
      qc.setQueryData(queryKey, body);
      setMessage("");
      setCustomDomain("");
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const refresh = useMutation({
    mutationFn: () => updateDomain("POST", "/refresh"),
    onSuccess: (body) => {
      qc.setQueryData(queryKey, body);
      setMessage("");
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const remove = useMutation({
    mutationFn: () => updateDomain("DELETE"),
    onSuccess: () => {
      qc.setQueryData(queryKey, { hostname: "", status: null, sslStatus: null, dnsRecords: [], error: null, managedUrl: runtimeStatus?.deploymentUrl || "", canConnect: Boolean(runtimeStatus?.deploymentUrl) });
      setMessage("");
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const domain = domainQuery.data || {};
  const status = domain.status ? DOMAIN_STATUS[domain.status] || DOMAIN_STATUS.verifying : null;
  const busy = connect.isPending || refresh.isPending || remove.isPending;
  const managedUrl = domain.managedUrl || runtimeStatus?.deploymentUrl || "";
  useEffect(() => {
    if (domain.status === previousStatus.current) return;
    if (domain.status === "live") setMessage("Your custom domain is live.");
    if (domain.status === "error") setMessage(domain.error || "The custom domain could not be connected.");
    previousStatus.current = domain.status || null;
  }, [domain.status, domain.error]);
  if (domainQuery.isLoading) return <div className={`h-72 animate-pulse rounded-2xl ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />;
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Domains</h2>
        <p className={`mt-1 text-sm ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Your BuildCustom address stays active when you connect a custom domain.</p>
      </div>
      <GlassCard>
        <h3 className={`font-semibold mb-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>BuildCustom address</h3>
        <div className={`flex items-center gap-3 p-3 rounded-xl mb-4 ${theme === "dark" ? "bg-white/5 border border-white/10" : "bg-gray-50 border border-gray-200"}`}>
          <Globe size={16} className="text-cyan-400 shrink-0" />
          <span className={`text-sm font-mono flex-1 break-all ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>{managedUrl || "Publish the project to create its address"}</span>
          {managedUrl && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">Live</span>}
        </div>
        {managedUrl && <div className="flex items-center gap-3"><CheckCircle2 size={14} className="text-emerald-400" /><span className={`text-xs ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>This address remains live after a custom domain is connected.</span></div>}
      </GlassCard>
      <GlassCard>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Custom domain</h3>
            <p className={`mt-1 text-sm ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Connect one domain or subdomain that you own.</p>
          </div>
          {status && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>}
        </div>

        {!domain.hostname ? (
          <div className="mt-5">
            <div className="flex gap-3">
              <input value={customDomain} onChange={e => setCustomDomain(e.target.value)} placeholder="app.example.com"
                disabled={!domain.canConnect || busy}
                className={`flex-1 px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors disabled:opacity-50 ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                data-testid="input-custom-domain" />
              <button onClick={() => { setMessage(""); connect.mutate(); }} disabled={!customDomain.trim() || !domain.canConnect || busy} className="px-4 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
                data-testid="button-connect-domain">{connect.isPending ? "Connecting..." : "Connect"}</button>
            </div>
            {!domain.canConnect && <p className="mt-3 text-xs text-amber-400">Publish this project before connecting a custom domain.</p>}
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div aria-live="polite" className={`rounded-xl border p-4 ${theme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-gray-200 bg-gray-50"}`}>
              <div className="flex items-center gap-3">
                <Globe size={16} className="text-purple-400" />
                <a href={`https://${domain.hostname}`} target="_blank" rel="noreferrer" className={`min-w-0 flex-1 break-all font-mono text-sm ${theme === "dark" ? "text-white/80" : "text-gray-800"}`}>{domain.hostname}</a>
                <ExternalLink size={14} className={theme === "dark" ? "text-white/30" : "text-gray-400"} />
              </div>
              {status && <p className={`mt-3 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>{status.detail}</p>}
              {domain.status && !["live", "error"].includes(domain.status) && (
                <p className={`mt-2 flex items-center gap-2 text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>
                  <RefreshCw size={12} className={domainQuery.isFetching ? "animate-spin" : ""} />
                  Checking automatically every 10 seconds
                </p>
              )}
              {domain.error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{domain.error}</p>}
            </div>
            {domain.dnsRecords?.length > 0 && (
              <div>
                <h4 className={`text-sm font-semibold mb-2 ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>DNS records</h4>
                <p className={`mb-3 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Add these records with your DNS provider. Use the default TTL.</p>
                <div className={`overflow-x-auto rounded-xl border ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
                  <table className="w-full text-xs">
                    <thead className={theme === "dark" ? "bg-white/5" : "bg-gray-50"}>
                      <tr>{["Type", "Name", "Value"].map(h => <th key={h} className={`text-left px-4 py-2.5 font-semibold ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {domain.dnsRecords.map((row: any, i: number) => (
                        <tr key={`${row.type}-${row.name}-${i}`} className={`border-t ${theme === "dark" ? "border-white/5" : "border-gray-100"}`}>
                          {[row.type, row.name, row.value].map((cell, j) => <td key={j} className={`max-w-[260px] break-all px-4 py-3 font-mono ${theme === "dark" ? "text-white/60" : "text-gray-600"}`}>{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {domain.status !== "live" && <button onClick={() => { setMessage(""); refresh.mutate(); }} disabled={busy} className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${theme === "dark" ? "border-white/10 text-white/70 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}><RefreshCw size={14} className={refresh.isPending ? "animate-spin" : ""} /> Check connection</button>}
              <button onClick={() => { if (window.confirm(`Remove ${domain.hostname}? The BuildCustom address will stay live.`)) remove.mutate(); }} disabled={busy} className="flex items-center gap-2 rounded-xl border border-red-400/25 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50"><Trash2 size={14} /> Remove domain</button>
            </div>
          </div>
        )}
        {message && <p aria-live="polite" className={`mt-4 text-xs ${domain.status === "live" ? "text-emerald-400" : "text-red-400"}`}>{message}</p>}
      </GlassCard>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function ProjectDetail() {
  const { theme } = useTheme();
  const [, params] = useRoute("/app/project/:id");
  const projectId = parseInt(params?.id ?? "0");
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Project not found");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: blogPosts = [] } = useQuery({
    queryKey: ["blog-posts", projectId],
    queryFn: async () => { const res = await fetch(`/api/projects/${projectId}/blog-posts`, { headers: authHeaders() }); return res.json(); },
    enabled: !!projectId,
  });

  const { data: runtimeStatus, error: runtimeStatusError } = useQuery({
    queryKey: ["runtime-status", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/status`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "VibeSDK runtime is unavailable.");
      return body;
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className={`min-h-full p-8 ${theme === "dark" ? "bg-[#060610]" : "bg-gray-50"}`}>
        <div className="space-y-4 max-w-4xl">
          <div className={`h-8 w-48 rounded-xl animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-200"}`} />
          <div className={`h-16 rounded-2xl animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-200"}`} />
          <div className={`h-64 rounded-2xl animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-200"}`} />
        </div>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className={`min-h-full flex flex-col items-center justify-center gap-4 ${theme === "dark" ? "bg-[#060610]" : "bg-gray-50"}`}>
        <p className={`text-lg font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Project not found</p>
        <Link href="/app"><button className={`text-sm ${theme === "dark" ? "text-cyan-400" : "text-cyan-600"}`}>← Back to Projects</button></Link>
      </div>
    );
  }

  const isWebsite = project.type === "website";
  const isPublished = Boolean(runtimeStatus?.deploymentUrl);
  const allTabs = isWebsite ? [...UNIVERSAL_TABS, ...WEBSITE_TABS] : UNIVERSAL_TABS;
  const headerPreview = PREVIEW_IMAGES[project.type] || PREVIEW_IMAGES.website;

  return (
    <div className={`min-h-full ${theme === "dark" ? "bg-[#060610]" : "bg-gray-50"}`}>
      <div className={`border-b px-8 pt-8 pb-0 ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
        <Link href="/app">
          <button className={`flex items-center gap-2 text-sm mb-5 transition-colors ${theme === "dark" ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700"}`} data-testid="button-back-to-projects">
            <ArrowLeft size={15} /> Back to Projects
          </button>
        </Link>

        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className={`relative h-[104px] w-[144px] shrink-0 overflow-hidden rounded-xl border ${theme === "dark" ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-100"}`}>
              {runtimeStatus?.previewImageUrl ? (
                <img src={runtimeStatus.previewImageUrl} alt={`${project.name} live page thumbnail`} className="h-full w-full object-cover" />
              ) : runtimeStatus?.deploymentUrl ? (
                <>
                  <iframe
                    src={runtimeStatus.deploymentUrl}
                    title={`${project.name} live page thumbnail`}
                    tabIndex={-1}
                    aria-hidden="true"
                    sandbox="allow-scripts allow-same-origin"
                    loading="lazy"
                    className="pointer-events-none absolute left-0 top-0 h-[700px] w-[960px] origin-top-left scale-[0.15] select-none border-0 bg-white"
                  />
                  <div className="absolute inset-0" aria-hidden="true" />
                </>
              ) : (
                <img src={headerPreview} alt={`${project.name} preview`} className="h-full w-full object-cover" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className={`text-2xl font-display font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{project.name}</h1>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${isPublished ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : project.status === "building" ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" : theme === "dark" ? "bg-white/10 text-white/50 border border-white/10" : "bg-gray-100 text-gray-500 border border-gray-200"}`}>
                  {isPublished && "● "}{isPublished ? "Published" : project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                </span>
              </div>
              <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{project.description || "No description"}</p>
            </div>
          </div>
          <Link href={`/app/editor/${projectId}`}>
            <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all"
              style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
              data-testid="button-header-open-builder"><Code2 size={15} /> Open Builder</button>
          </Link>
        </div>

        <div className="flex gap-1 overflow-x-auto">
          {UNIVERSAL_TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all -mb-px ${activeTab === tab.id ? "border-cyan-400 text-cyan-400" : theme === "dark" ? "border-transparent text-white/40 hover:text-white/70" : "border-transparent text-gray-500 hover:text-gray-700"}`}
              data-testid={`tab-${tab.id}`}><tab.icon size={15} /> {tab.label}</button>
          ))}
          {isWebsite && (
            <>
              <div className={`w-px mx-2 self-stretch my-2 ${theme === "dark" ? "bg-white/10" : "bg-gray-200"}`} />
              {WEBSITE_TABS.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all -mb-px ${activeTab === tab.id ? "border-purple-400 text-purple-400" : theme === "dark" ? "border-transparent text-white/40 hover:text-white/70" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                  data-testid={`tab-${tab.id}`}><tab.icon size={15} /> {tab.label}</button>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="p-8">
        {(runtimeStatusError || runtimeStatus?.configured === false) && (
          <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            VibeSDK runtime unavailable: {(runtimeStatusError as Error)?.message || "runtime is not configured."}
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
            {activeTab === "overview" && <OverviewTab project={project} blogCount={blogPosts.length} projectId={projectId} runtimeStatus={runtimeStatus} />}
            {activeTab === "files" && <FilesTab />}
            {activeTab === "console" && <ConsoleTab />}
            {activeTab === "history" && <HistoryTab />}
            {activeTab === "settings" && <ProjectSettingsTab project={project} projectId={projectId} runtimeStatus={runtimeStatus} />}
            {activeTab === "pages" && <PagesTab projectId={projectId} />}
            {activeTab === "blog" && <BlogTab projectId={projectId} />}
            {activeTab === "autoblogger" && <AutoBloggerTab projectId={projectId} />}
            {activeTab === "seo" && <SEOTab projectId={projectId} project={project} deploymentUrl={runtimeStatus?.deploymentUrl} />}
            {activeTab === "analytics" && <AnalyticsTab />}
            {activeTab === "domain" && <DomainTab projectId={projectId} runtimeStatus={runtimeStatus} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
