import { useState } from "react";
import { useRoute, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Globe,
  Smartphone,
  Gamepad2,
  ShoppingBag,
  ExternalLink,
  Settings,
  FolderTree,
  Terminal,
  History,
  BarChart3,
  FileText,
  Rss,
  Bot,
  Search,
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Download,
  Upload,
  Share2,
  Copy,
  Zap,
  TrendingUp,
  TrendingDown,
  Users,
  MousePointer,
  Star,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Play,
  Pause,
  Save,
  Tag,
  Layers,
  Code2,
  Server,
  Shield,
  Link2,
  Check,
  X,
  BookOpen,
  Newspaper,
  Wand2,
  SlidersHorizontal,
  Target,
  Hash,
  ArrowUpRight,
} from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import previewPortfolio from "@/assets/preview-portfolio.jpg";
import previewFitness from "@/assets/preview-fitness.jpg";
import previewGame from "@/assets/preview-game.jpg";
import previewEcommerce from "@/assets/preview-ecommerce.jpg";

const DEMO_PROJECTS: Record<string, {
  id: string;
  name: string;
  type: string;
  icon: React.ElementType;
  status: string;
  lastEdited: string;
  url: string | null;
  preview: string;
  description: string;
  createdAt: string;
  framework: string;
  deployed: boolean;
}> = {
  "1": { id: "1", name: "Portfolio Website", type: "website", icon: Globe, status: "live", lastEdited: "2 hours ago", url: "portfolio.buildcustom.ai", preview: previewPortfolio, description: "Personal portfolio showcasing design and development work.", createdAt: "Jan 10, 2026", framework: "React + TailwindCSS", deployed: true },
  "2": { id: "2", name: "Fitness Tracker", type: "app", icon: Smartphone, status: "draft", lastEdited: "1 day ago", url: null, preview: previewFitness, description: "Mobile-first fitness tracking application with workout logging.", createdAt: "Feb 2, 2026", framework: "React Native", deployed: false },
  "3": { id: "3", name: "Space Invaders", type: "game", icon: Gamepad2, status: "live", lastEdited: "3 days ago", url: "spacegame.buildcustom.ai", preview: previewGame, description: "Classic arcade-style space shooting game with modern graphics.", createdAt: "Dec 20, 2025", framework: "Phaser.js", deployed: true },
  "4": { id: "4", name: "E-Commerce Store", type: "saas", icon: ShoppingBag, status: "building", lastEdited: "5 hours ago", url: null, preview: previewEcommerce, description: "Full-featured e-commerce platform with product management.", createdAt: "Mar 1, 2026", framework: "Next.js + Stripe", deployed: false },
};

type TabId = "overview" | "files" | "console" | "history" | "settings" | "pages" | "blog" | "autoblogger" | "seo" | "analytics" | "domain";

const UNIVERSAL_TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Layers },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "console", label: "Console", icon: Terminal },
  { id: "history", label: "Version History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
];

const WEBSITE_TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "pages", label: "Pages", icon: FileText },
  { id: "blog", label: "Blog", icon: Rss },
  { id: "autoblogger", label: "Auto-Blogger", icon: Bot },
  { id: "seo", label: "SEO", icon: Search },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "domain", label: "Domain", icon: Globe },
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

function OverviewTab({ project }: { project: typeof DEMO_PROJECTS[string] }) {
  const { theme } = useTheme();
  const isWebsite = project.type === "website";

  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${isWebsite ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"}`}>
        <StatCard label="Status" value={project.status.charAt(0).toUpperCase() + project.status.slice(1)} sub={project.deployed ? "Deployed" : "Not deployed"} trend="neutral" />
        {isWebsite && <StatCard label="Monthly Visitors" value="2,847" sub="+12.4% this month" trend="up" />}
        {isWebsite && <StatCard label="Blog Posts" value="14" sub="3 scheduled" trend="neutral" />}
        {isWebsite && <StatCard label="SEO Score" value="87/100" sub="+5 this week" trend="up" />}
        <StatCard label="Last Edited" value={project.lastEdited} sub={`Created ${project.createdAt}`} trend="neutral" />
        <StatCard label="Framework" value={project.framework} sub="Production build" trend="neutral" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <GlassCard>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Preview</h3>
            <div className="rounded-xl overflow-hidden aspect-video">
              <img src={project.preview} alt={project.name} className="w-full h-full object-cover" />
            </div>
            <div className="flex gap-3 mt-4">
              <Link href="/app/editor">
                <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all"
                  style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
                  data-testid="button-open-editor">
                  <Code2 size={15} /> Open in Builder
                </button>
              </Link>
              {project.url && (
                <a href={`https://${project.url}`} target="_blank" rel="noopener noreferrer">
                  <button className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                    data-testid="button-view-live">
                    <ExternalLink size={15} /> View Live
                  </button>
                </a>
              )}
              <button className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                data-testid="button-share">
                <Share2 size={15} /> Share
              </button>
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
                { label: "Created", value: project.createdAt },
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

function FileRow({ file, depth = 0 }: { file: typeof DEMO_FILES[number]; depth?: number }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(depth === 0);
  const isFolder = file.type === "folder";

  const langColors: Record<string, string> = {
    tsx: "text-cyan-400", ts: "text-blue-400", js: "text-amber-400",
    css: "text-pink-400", json: "text-green-400", html: "text-orange-400",
  };

  return (
    <div>
      <div
        onClick={() => isFolder && setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${theme === "dark" ? "hover:bg-white/5 text-white/70" : "hover:bg-gray-50 text-gray-700"}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        data-testid={`file-row-${file.name}`}
      >
        {isFolder ? (
          <>
            {open ? <ChevronDown size={14} className={theme === "dark" ? "text-white/30" : "text-gray-400"} /> : <ChevronRight size={14} className={theme === "dark" ? "text-white/30" : "text-gray-400"} />}
            <FolderTree size={14} className="text-amber-400" />
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <Code2 size={14} className={langColors[(file as any).lang] || "text-white/40"} />
          </>
        )}
        <span className="flex-1">{file.name}</span>
        {!isFolder && <span className={`text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{(file as any).size}</span>}
      </div>
      {isFolder && open && file.children?.map((child, i) => (
        <FileRow key={i} file={child as any} depth={depth + 1} />
      ))}
    </div>
  );
}

function FilesTab() {
  const { theme } = useTheme();
  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Project Files</h3>
        <div className="flex gap-2">
          <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            data-testid="button-upload-file"><Upload size={13} /> Upload</button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90"
            style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
            data-testid="button-new-file"><Plus size={13} /> New File</button>
        </div>
      </div>
      <div className={`rounded-xl overflow-hidden border ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
        {DEMO_FILES.map((file, i) => <FileRow key={i} file={file as any} />)}
      </div>
    </GlassCard>
  );
}

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
  const typeStyles: Record<string, string> = {
    info: theme === "dark" ? "text-white/50" : "text-gray-500",
    success: "text-emerald-400",
    warn: "text-amber-400",
    error: "text-red-400",
  };

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Console</h3>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
          </span>
        </div>
        <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white/60 hover:bg-white/15" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
          data-testid="button-clear-console"><Trash2 size={13} /> Clear</button>
      </div>
      <div className={`rounded-xl font-mono text-xs p-4 space-y-2 max-h-[420px] overflow-y-auto ${theme === "dark" ? "bg-black/40 border border-white/10" : "bg-gray-900 border border-gray-700"}`}>
        {CONSOLE_LINES.map((line, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="text-white/20 shrink-0">{line.time}</span>
            <span className={`uppercase text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
              line.type === "error" ? "bg-red-500/20 text-red-400" :
              line.type === "warn" ? "bg-amber-500/20 text-amber-400" :
              line.type === "success" ? "bg-emerald-500/20 text-emerald-400" :
              "bg-white/5 text-white/30"
            }`}>{line.type}</span>
            <span className={typeStyles[line.type] || "text-white/60"}>{line.msg}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

const VERSIONS = [
  { version: "v1.4", label: "Added contact form validation", author: "You", time: "2 hours ago", current: true },
  { version: "v1.3", label: "Responsive mobile nav", author: "You", time: "1 day ago", current: false },
  { version: "v1.2", label: "SEO meta tags added", author: "You", time: "2 days ago", current: false },
  { version: "v1.1", label: "Hero section redesign", author: "You", time: "4 days ago", current: false },
  { version: "v1.0", label: "Initial build", author: "AI Builder", time: "Jan 10, 2026", current: false },
];

function HistoryTab() {
  const { theme } = useTheme();
  return (
    <GlassCard>
      <h3 className={`font-semibold mb-5 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Version History</h3>
      <div className="space-y-3">
        {VERSIONS.map((v) => (
          <div key={v.version} className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
            v.current
              ? theme === "dark" ? "border-cyan-400/30 bg-cyan-500/5" : "border-cyan-400 bg-cyan-50"
              : theme === "dark" ? "border-white/5 hover:border-white/10 hover:bg-white/[0.02]" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
          }`} data-testid={`version-row-${v.version}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${theme === "dark" ? "bg-white/10 text-white" : "bg-gray-100 text-gray-700"}`}>{v.version}</div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{v.label}</p>
              <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{v.author} · {v.time}</p>
            </div>
            {v.current && <span className="text-xs px-2 py-1 rounded-full bg-cyan-400 text-black font-semibold shrink-0">Current</span>}
            {!v.current && (
              <div className="flex gap-1.5 shrink-0">
                <button className={`p-1.5 rounded-lg text-xs transition-colors ${theme === "dark" ? "hover:bg-white/10 text-white/40" : "hover:bg-gray-100 text-gray-400"}`} title="Preview" data-testid={`button-preview-${v.version}`}><Eye size={14} /></button>
                <button className={`p-1.5 rounded-lg text-xs transition-colors ${theme === "dark" ? "hover:bg-white/10 text-white/40" : "hover:bg-gray-100 text-gray-400"}`} title="Restore" data-testid={`button-restore-${v.version}`}><RefreshCw size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function ProjectSettingsTab({ project }: { project: typeof DEMO_PROJECTS[string] }) {
  const { theme } = useTheme();
  return (
    <div className="space-y-6 max-w-2xl">
      <GlassCard>
        <h3 className={`font-semibold mb-5 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>General</h3>
        <div className="space-y-4">
          {[{ label: "Project Name", value: project.name }, { label: "Description", value: project.description }, { label: "Framework", value: project.framework }].map(({ label, value }) => (
            <div key={label}>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{label}</label>
              <input defaultValue={value} className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                data-testid={`input-${label.toLowerCase().replace(/\s+/g, "-")}`} />
            </div>
          ))}
          <button className="px-5 py-2.5 rounded-xl text-black font-semibold text-sm hover:opacity-90 transition-all bg-cyan-400" data-testid="button-save-settings">Save Changes</button>
        </div>
      </GlassCard>
      <GlassCard>
        <h3 className="font-semibold mb-2 text-red-400">Danger Zone</h3>
        <p className={`text-sm mb-4 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>These actions cannot be undone.</p>
        <div className="flex gap-3">
          <button className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`} data-testid="button-archive">Archive Project</button>
          <button className="px-4 py-2 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" data-testid="button-delete">Delete Project</button>
        </div>
      </GlassCard>
    </div>
  );
}

const DEMO_PAGES = [
  { id: "1", title: "Home", slug: "/", status: "published", views: 1240, lastEdited: "2 hours ago" },
  { id: "2", title: "About Us", slug: "/about", status: "published", views: 320, lastEdited: "3 days ago" },
  { id: "3", title: "Contact", slug: "/contact", status: "published", views: 185, lastEdited: "1 week ago" },
  { id: "4", title: "Services", slug: "/services", status: "published", views: 540, lastEdited: "5 days ago" },
  { id: "5", title: "Plumber Austin TX", slug: "/plumber-austin-tx", status: "published", views: 890, lastEdited: "1 day ago" },
  { id: "6", title: "Plumber Dallas TX", slug: "/plumber-dallas-tx", status: "published", views: 720, lastEdited: "1 day ago" },
  { id: "7", title: "Emergency Plumber Houston", slug: "/emergency-plumber-houston-tx", status: "draft", views: 0, lastEdited: "2 hours ago" },
];

function PagesTab() {
  const { theme } = useTheme();
  const [showGenerator, setShowGenerator] = useState(false);
  const [service, setService] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const servicePages = DEMO_PAGES.filter(p => p.slug.split("/").length > 2 || p.slug.includes("-"));
  const standardPages = DEMO_PAGES.filter(p => !servicePages.includes(p));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Pages</h2>
          <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{DEMO_PAGES.length} pages · {DEMO_PAGES.filter(p => p.status === "published").length} published</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowGenerator(!showGenerator)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            data-testid="button-service-page-generator">
            <MapPin size={15} /> Service Page Generator
          </button>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
            style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
            data-testid="button-new-page"><Plus size={15} /> New Page</button>
        </div>
      </div>

      <AnimatePresence>
        {showGenerator && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <GlassCard className="border-purple-500/20">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                  <Wand2 size={18} className="text-purple-400" />
                </div>
                <div>
                  <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Service + City Page Generator</h3>
                  <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Generate SEO-optimized local service pages instantly</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Service Type</label>
                  <input value={service} onChange={e => setService(e.target.value)} placeholder="e.g. Plumber, Electrician" className={`w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-purple-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-purple-400"}`}
                    data-testid="input-service-type" />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>City</label>
                  <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Austin" className={`w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-purple-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-purple-400"}`}
                    data-testid="input-city" />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>State</label>
                  <input value={state} onChange={e => setState(e.target.value)} placeholder="e.g. TX" className={`w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-purple-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-purple-400"}`}
                    data-testid="input-state" />
                </div>
              </div>
              {service && city && (
                <div className={`rounded-xl p-3 mb-4 text-xs font-mono ${theme === "dark" ? "bg-white/5 border border-white/10 text-white/60" : "bg-gray-50 border border-gray-200 text-gray-600"}`}>
                  URL preview: /{service.toLowerCase().replace(/\s+/g, "-")}-{city.toLowerCase().replace(/\s+/g, "-")}{state ? `-${state.toLowerCase()}` : ""}
                </div>
              )}
              <div className="flex gap-3">
                <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all"
                  style={{ background: "linear-gradient(90deg, #a855f7, #ec4899)" }}
                  data-testid="button-generate-page">
                  <Wand2 size={15} /> Generate Page
                </button>
                <button onClick={() => setShowGenerator(false)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"}`}>
                  Cancel
                </button>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      <GlassCard>
        <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Standard Pages</h3>
        <div className="space-y-2">
          {standardPages.map(page => (
            <PageRow key={page.id} page={page} />
          ))}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Service Pages <span className={`text-xs font-normal ml-2 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{servicePages.length} pages</span></h3>
          <span className={`text-xs px-2 py-1 rounded-full ${theme === "dark" ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" : "bg-purple-50 text-purple-700 border border-purple-200"}`}>AI Generated</span>
        </div>
        <div className="space-y-2">
          {servicePages.map(page => (
            <PageRow key={page.id} page={page} />
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function PageRow({ page }: { page: typeof DEMO_PAGES[number] }) {
  const { theme } = useTheme();
  return (
    <div className={`flex items-center gap-4 p-3 rounded-xl transition-colors ${theme === "dark" ? "hover:bg-white/5" : "hover:bg-gray-50"}`} data-testid={`page-row-${page.id}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${theme === "dark" ? "bg-white/10" : "bg-gray-100"}`}>
        <FileText size={14} className={theme === "dark" ? "text-white/40" : "text-gray-500"} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{page.title}</p>
        <p className={`text-xs truncate mt-0.5 font-mono ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{page.slug}</p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${page.status === "published" ? "bg-emerald-500/15 text-emerald-400" : theme === "dark" ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"}`}>
        {page.status}
      </span>
      <span className={`text-xs w-16 text-right ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{page.views.toLocaleString()} views</span>
      <div className="flex gap-1">
        <button className={`p-1.5 rounded-lg transition-colors ${theme === "dark" ? "hover:bg-white/10 text-white/30" : "hover:bg-gray-100 text-gray-400"}`} data-testid={`button-edit-page-${page.id}`}><Pencil size={13} /></button>
        <button className={`p-1.5 rounded-lg transition-colors ${theme === "dark" ? "hover:bg-white/10 text-white/30" : "hover:bg-gray-100 text-gray-400"}`} data-testid={`button-view-page-${page.id}`}><Eye size={13} /></button>
      </div>
    </div>
  );
}

const DEMO_POSTS = [
  { id: "1", title: "10 Signs Your Home Needs Emergency Plumbing", status: "published", date: "May 1, 2026", views: 1840, wordCount: 2140 },
  { id: "2", title: "How to Choose the Right Plumber in Austin TX", status: "published", date: "Apr 28, 2026", views: 920, wordCount: 2310 },
  { id: "3", title: "Common Pipe Issues in Older Dallas Homes", status: "published", date: "Apr 25, 2026", views: 630, wordCount: 2050 },
  { id: "4", title: "Water Heater Replacement: What You Need to Know", status: "scheduled", date: "May 5, 2026", views: 0, wordCount: 2200 },
  { id: "5", title: "DIY Plumbing Fixes vs When to Call a Pro", status: "scheduled", date: "May 8, 2026", views: 0, wordCount: 1980 },
  { id: "6", title: "Sewer Line Inspection: Complete Guide 2026", status: "draft", date: "—", views: 0, wordCount: 1350 },
];

function BlogTab() {
  const { theme } = useTheme();
  const [filter, setFilter] = useState<"all" | "published" | "scheduled" | "draft">("all");

  const filtered = filter === "all" ? DEMO_POSTS : DEMO_POSTS.filter(p => p.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Blog</h2>
          <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{DEMO_POSTS.length} posts · {DEMO_POSTS.filter(p => p.status === "published").length} live</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
          style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
          data-testid="button-new-post"><Plus size={15} /> New Post</button>
      </div>

      <div className="flex gap-2">
        {(["all", "published", "scheduled", "draft"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium capitalize transition-colors ${filter === f
              ? "bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-400 border border-cyan-500/20"
              : theme === "dark" ? "text-white/50 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`} data-testid={`filter-${f}`}>{f}</button>
        ))}
      </div>

      <GlassCard>
        <div className="space-y-2">
          {filtered.map(post => (
            <div key={post.id} className={`flex items-center gap-4 p-3 rounded-xl transition-colors ${theme === "dark" ? "hover:bg-white/5" : "hover:bg-gray-50"}`} data-testid={`post-row-${post.id}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${theme === "dark" ? "bg-white/10" : "bg-gray-100"}`}>
                <Newspaper size={14} className={theme === "dark" ? "text-white/40" : "text-gray-500"} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{post.title}</p>
                <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{post.wordCount.toLocaleString()} words · {post.date}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                post.status === "published" ? "bg-emerald-500/15 text-emerald-400" :
                post.status === "scheduled" ? "bg-amber-500/15 text-amber-400" :
                theme === "dark" ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"
              }`}>{post.status}</span>
              {post.views > 0 && <span className={`text-xs w-20 text-right shrink-0 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{post.views.toLocaleString()} views</span>}
              <div className="flex gap-1 shrink-0">
                <button className={`p-1.5 rounded-lg transition-colors ${theme === "dark" ? "hover:bg-white/10 text-white/30" : "hover:bg-gray-100 text-gray-400"}`} data-testid={`button-edit-post-${post.id}`}><Pencil size={13} /></button>
                <button className={`p-1.5 rounded-lg transition-colors ${theme === "dark" ? "hover:bg-white/10 text-white/30" : "hover:bg-gray-100 text-gray-400"}`} data-testid={`button-delete-post-${post.id}`}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function AutoBloggerTab() {
  const { theme } = useTheme();
  const [enabled, setEnabled] = useState(true);
  const [frequency, setFrequency] = useState("3");
  const [style, setStyle] = useState("neil-patel");
  const [minWords, setMinWords] = useState("2000");
  const [keywords, setKeywords] = useState("plumber Austin TX\nplumber Dallas TX\nemergency plumber Houston\nwater heater repair Texas\nsewer line inspection");

  const SCHEDULED = [
    { title: "Tankless Water Heaters: Pros & Cons for Texas Homeowners", date: "May 5, 2026", keyword: "water heater repair Texas" },
    { title: "DIY Plumbing Fixes vs When to Call a Pro", date: "May 5, 2026", keyword: "plumber Austin TX" },
    { title: "Best Plumbing Companies in Dallas 2026", date: "May 5, 2026", keyword: "plumber Dallas TX" },
    { title: "Signs You Need a Sewer Line Inspection", date: "May 6, 2026", keyword: "sewer line inspection Texas" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Auto-Blogger</h2>
          <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>AI writes and publishes SEO-optimized blogs automatically</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{enabled ? "Active" : "Paused"}</span>
          <button onClick={() => setEnabled(!enabled)}
            className={`relative w-12 h-6 rounded-full transition-colors ${enabled ? "bg-gradient-to-r from-cyan-500 to-purple-500" : theme === "dark" ? "bg-white/10" : "bg-gray-200"}`}
            data-testid="toggle-autoblogger">
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${enabled ? "left-7" : "left-1"}`} />
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
                {["1", "2", "3", "5", "10"].map(n => (
                  <button key={n} onClick={() => setFrequency(n)}
                    className={`w-10 h-10 rounded-xl text-sm font-semibold transition-colors ${frequency === n
                      ? "bg-gradient-to-br from-cyan-500 to-purple-500 text-white"
                      : theme === "dark" ? "bg-white/10 text-white/60 hover:bg-white/15" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`} data-testid={`frequency-${n}`}>{n}</button>
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
                ].map(s => (
                  <div key={s.id} onClick={() => setStyle(s.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-colors ${style === s.id
                      ? theme === "dark" ? "border-cyan-400/40 bg-cyan-500/5" : "border-cyan-400 bg-cyan-50"
                      : theme === "dark" ? "border-white/5 hover:border-white/10" : "border-gray-100 hover:border-gray-200"
                    }`} data-testid={`style-${s.id}`}>
                    <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{s.label}</p>
                    <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Minimum Word Count</label>
              <input type="number" value={minWords} onChange={e => setMinWords(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
                data-testid="input-min-words" />
            </div>

            <button className="w-full py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all"
              style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1, #ec4899)" }}
              data-testid="button-save-autoblogger">Save Settings</button>
          </div>
        </GlassCard>

        <div className="space-y-6">
          <GlassCard>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Target Keywords</h3>
            <p className={`text-xs mb-3 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>One keyword per line. AI will write about each topic in rotation.</p>
            <textarea value={keywords} onChange={e => setKeywords(e.target.value)} rows={7}
              className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors resize-none font-mono ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="input-keywords" />
            <p className={`text-xs mt-2 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{keywords.split("\n").filter(k => k.trim()).length} keywords configured</p>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Upcoming Queue</h3>
              <span className={`text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{SCHEDULED.length} posts scheduled</span>
            </div>
            <div className="space-y-2">
              {SCHEDULED.map((item, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-xl ${theme === "dark" ? "bg-white/[0.02]" : "bg-gray-50"}`} data-testid={`queue-item-${i}`}>
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={12} className="text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${theme === "dark" ? "text-white/80" : "text-gray-800"}`}>{item.title}</p>
                    <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{item.date} · <span className="text-cyan-400/70">{item.keyword}</span></p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function SEOTab() {
  const { theme } = useTheme();
  const [activeSection, setActiveSection] = useState("meta");

  const SEO_SCORE_ITEMS = [
    { label: "Meta title set", status: "pass" },
    { label: "Meta description set", status: "pass" },
    { label: "Sitemap.xml found", status: "pass" },
    { label: "Robots.txt configured", status: "pass" },
    { label: "Structured data (JSON-LD)", status: "pass" },
    { label: "Open Graph tags", status: "pass" },
    { label: "Canonical URLs", status: "warn" },
    { label: "Image alt text", status: "warn" },
    { label: "Page speed < 2s", status: "fail" },
  ];

  const passing = SEO_SCORE_ITEMS.filter(i => i.status === "pass").length;
  const score = Math.round((passing / SEO_SCORE_ITEMS.length) * 100);

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
              <circle cx="50" cy="50" r="40" fill="none"
                stroke="url(#seoGrad)" strokeWidth="10"
                strokeDasharray={`${2.51 * score} ${251 - 2.51 * score}`}
                strokeLinecap="round" />
              <defs>
                <linearGradient id="seoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00c9b7" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
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
        {[{ id: "meta", label: "Meta Tags" }, { id: "sitemap", label: "Sitemap" }, { id: "schema", label: "Structured Data" }, { id: "keywords", label: "Keywords" }].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${activeSection === s.id
              ? "bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-400 border border-cyan-500/20"
              : theme === "dark" ? "text-white/50 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`} data-testid={`seo-tab-${s.id}`}>{s.label}</button>
        ))}
      </div>

      <GlassCard>
        {activeSection === "meta" && (
          <div className="space-y-4">
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Meta Tags</h3>
            {[
              { label: "Site Title", value: "Austin Plumbing Experts | Fast & Reliable Service", hint: "50–60 characters recommended" },
              { label: "Meta Description", value: "Need a plumber in Austin TX? Our licensed team is available 24/7 for emergency repairs, water heaters, and drain cleaning. Call now for fast service.", hint: "150–160 characters recommended", multiline: true },
              { label: "Focus Keyword", value: "plumber Austin TX", hint: "Primary keyword for this page" },
            ].map(({ label, value, hint, multiline }) => (
              <div key={label}>
                <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{label}</label>
                {multiline
                  ? <textarea defaultValue={value} rows={3} className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors resize-none ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`} data-testid={`input-${label.toLowerCase().replace(/\s+/g, "-")}`} />
                  : <input defaultValue={value} className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`} data-testid={`input-${label.toLowerCase().replace(/\s+/g, "-")}`} />
                }
                <p className={`text-xs mt-1 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{hint}</p>
              </div>
            ))}
            <button className="px-5 py-2.5 rounded-xl text-black font-semibold text-sm hover:opacity-90 transition-all bg-cyan-400" data-testid="button-save-meta">Save Meta Tags</button>
          </div>
        )}
        {activeSection === "sitemap" && (
          <div>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Sitemap</h3>
            <div className={`rounded-xl p-4 font-mono text-xs mb-4 ${theme === "dark" ? "bg-black/30 border border-white/10 text-white/60" : "bg-gray-50 border border-gray-200 text-gray-600"}`}>
              {`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://portfolio.buildcustom.ai/</loc></url>\n  <url><loc>https://portfolio.buildcustom.ai/about</loc></url>\n  <url><loc>https://portfolio.buildcustom.ai/services</loc></url>\n  <url><loc>https://portfolio.buildcustom.ai/plumber-austin-tx</loc></url>\n  <!-- +11 more URLs -->\n</urlset>`}
            </div>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
                style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
                data-testid="button-regenerate-sitemap"><RefreshCw size={14} /> Regenerate Sitemap</button>
              <a href="#" className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                data-testid="button-view-sitemap"><ExternalLink size={14} /> View Sitemap</a>
            </div>
          </div>
        )}
        {activeSection === "schema" && (
          <div>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Structured Data (JSON-LD)</h3>
            <textarea rows={12} defaultValue={`{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": "Austin Plumbing Experts",\n  "url": "https://portfolio.buildcustom.ai",\n  "telephone": "+1-512-555-0100",\n  "address": {\n    "@type": "PostalAddress",\n    "streetAddress": "123 Main St",\n    "addressLocality": "Austin",\n    "addressRegion": "TX",\n    "postalCode": "78701"\n  },\n  "priceRange": "$$"\n}`}
              className={`w-full px-4 py-3 rounded-xl border text-xs outline-none transition-colors resize-none font-mono ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
              data-testid="input-schema" />
            <button className="mt-3 px-5 py-2.5 rounded-xl text-black font-semibold text-sm hover:opacity-90 transition-all bg-cyan-400" data-testid="button-save-schema">Save Schema</button>
          </div>
        )}
        {activeSection === "keywords" && (
          <div>
            <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Keyword Tracking</h3>
            <div className="space-y-2">
              {[
                { keyword: "plumber Austin TX", position: 3, volume: 2400, change: +2 },
                { keyword: "emergency plumber Austin", position: 7, volume: 1300, change: -1 },
                { keyword: "plumber Dallas TX", position: 5, volume: 1800, change: +4 },
                { keyword: "water heater repair Austin", position: 12, volume: 890, change: +1 },
                { keyword: "sewer line inspection TX", position: 18, volume: 480, change: 0 },
              ].map((kw, i) => (
                <div key={i} className={`flex items-center gap-4 p-3 rounded-xl ${theme === "dark" ? "hover:bg-white/5" : "hover:bg-gray-50"}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    kw.position <= 5 ? "bg-emerald-500/15 text-emerald-400" :
                    kw.position <= 10 ? "bg-amber-500/15 text-amber-400" :
                    theme === "dark" ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"
                  }`}>#{kw.position}</div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{kw.keyword}</p>
                    <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{kw.volume.toLocaleString()} monthly searches</p>
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-medium ${kw.change > 0 ? "text-emerald-400" : kw.change < 0 ? "text-red-400" : theme === "dark" ? "text-white/30" : "text-gray-400"}`}>
                    {kw.change > 0 ? <TrendingUp size={12} /> : kw.change < 0 ? <TrendingDown size={12} /> : null}
                    {kw.change !== 0 ? `${kw.change > 0 ? "+" : ""}${kw.change}` : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function AnalyticsTab() {
  const { theme } = useTheme();
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];
  const visitors = [820, 940, 1100, 1350, 1600, 2100, 2500, 2847];
  const maxV = Math.max(...visitors);

  return (
    <div className="space-y-6">
      <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Analytics</h2>

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
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${(v / maxV) * 100}%` }}
                transition={{ delay: i * 0.05, duration: 0.5, ease: "easeOut" }}
                className="w-full rounded-t-lg"
                style={{ background: i === visitors.length - 1 ? "linear-gradient(180deg, #00c9b7, #6366f1)" : theme === "dark" ? "rgba(255,255,255,0.08)" : "#e5e7eb" }}
              />
              <span className={`text-[10px] ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{months[i]}</span>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard>
          <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Top Pages</h3>
          <div className="space-y-3">
            {[
              { page: "/plumber-austin-tx", views: 890, pct: 31 },
              { page: "/", views: 1240, pct: 44 },
              { page: "/plumber-dallas-tx", views: 720, pct: 25 },
              { page: "/services", views: 540, pct: 19 },
              { page: "/contact", views: 185, pct: 7 },
            ].map((p, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${theme === "dark" ? "text-white/60" : "text-gray-600"}`}>{p.page}</span>
                  <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{p.views.toLocaleString()}</span>
                </div>
                <div className={`h-1.5 rounded-full ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`}>
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-purple-500" style={{ width: `${p.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Traffic Sources</h3>
          <div className="space-y-3">
            {[
              { source: "Organic Search", pct: 62, color: "from-emerald-400 to-cyan-400" },
              { source: "Direct", pct: 18, color: "from-cyan-400 to-blue-400" },
              { source: "Referral", pct: 12, color: "from-purple-400 to-pink-400" },
              { source: "Social", pct: 8, color: "from-pink-400 to-rose-400" },
            ].map((s, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${theme === "dark" ? "text-white/60" : "text-gray-600"}`}>{s.source}</span>
                  <span className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{s.pct}%</span>
                </div>
                <div className={`h-2 rounded-full ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`}>
                  <div className={`h-full rounded-full bg-gradient-to-r ${s.color}`} style={{ width: `${s.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function DomainTab() {
  const { theme } = useTheme();
  const [customDomain, setCustomDomain] = useState("");

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Domain</h2>

      <GlassCard>
        <h3 className={`font-semibold mb-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Current Domain</h3>
        <div className={`flex items-center gap-3 p-3 rounded-xl mb-4 ${theme === "dark" ? "bg-white/5 border border-white/10" : "bg-gray-50 border border-gray-200"}`}>
          <Globe size={16} className="text-cyan-400 shrink-0" />
          <span className={`text-sm font-mono flex-1 ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>portfolio.buildcustom.ai</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">Active</span>
        </div>
        <div className="flex items-center gap-3">
          <CheckCircle2 size={14} className="text-emerald-400" />
          <span className={`text-xs ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>SSL certificate active · Auto-renews Dec 2026</span>
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className={`font-semibold mb-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Custom Domain</h3>
        <p className={`text-sm mb-4 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Connect your own domain to this project.</p>
        <div className="flex gap-3 mb-6">
          <input value={customDomain} onChange={e => setCustomDomain(e.target.value)}
            placeholder="yourdomain.com" className={`flex-1 px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
            data-testid="input-custom-domain" />
          <button className="px-4 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all"
            style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1)" }}
            data-testid="button-connect-domain">Connect</button>
        </div>

        <h4 className={`text-sm font-semibold mb-3 ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>DNS Configuration</h4>
        <div className={`rounded-xl overflow-hidden border ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
          <table className="w-full text-xs">
            <thead className={theme === "dark" ? "bg-white/5" : "bg-gray-50"}>
              <tr>
                {["Type", "Name", "Value", "TTL"].map(h => (
                  <th key={h} className={`text-left px-4 py-2.5 font-semibold ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { type: "A", name: "@", value: "76.76.21.21", ttl: "3600" },
                { type: "CNAME", name: "www", value: "cname.buildcustom.ai", ttl: "3600" },
              ].map((row, i) => (
                <tr key={i} className={`border-t ${theme === "dark" ? "border-white/5" : "border-gray-100"}`}>
                  {[row.type, row.name, row.value, row.ttl].map((cell, j) => (
                    <td key={j} className={`px-4 py-3 font-mono ${theme === "dark" ? "text-white/60" : "text-gray-600"}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className={`font-semibold mb-4 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>SSL Certificate</h3>
        <div className="space-y-3">
          {[
            { label: "Status", value: "Active", ok: true },
            { label: "Issued by", value: "Let's Encrypt", ok: true },
            { label: "Expiry", value: "Dec 10, 2026", ok: true },
            { label: "Auto-renewal", value: "Enabled", ok: true },
          ].map(({ label, value, ok }) => (
            <div key={label} className="flex items-center justify-between">
              <span className={`text-sm ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{label}</span>
              <div className="flex items-center gap-2">
                {ok && <CheckCircle2 size={14} className="text-emerald-400" />}
                <span className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{value}</span>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

export default function ProjectDetail() {
  const { theme } = useTheme();
  const [, params] = useRoute("/app/project/:id");
  const id = params?.id ?? "1";
  const project = DEMO_PROJECTS[id] ?? DEMO_PROJECTS["1"];
  const isWebsite = project.type === "website";

  const allTabs = isWebsite
    ? [...UNIVERSAL_TABS, ...WEBSITE_TABS]
    : UNIVERSAL_TABS;

  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <div className={`min-h-full ${theme === "dark" ? "bg-[#060610]" : "bg-gray-50"}`}>
      <div className={`border-b px-8 pt-8 pb-0 ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
        <Link href="/app">
          <button className={`flex items-center gap-2 text-sm mb-5 transition-colors ${theme === "dark" ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700"}`}
            data-testid="button-back-to-projects">
            <ArrowLeft size={15} /> Back to Projects
          </button>
        </Link>

        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${theme === "dark" ? "bg-gradient-to-br from-cyan-500/20 to-purple-500/20" : "bg-gradient-to-br from-cyan-50 to-purple-50"}`}>
              <project.icon size={22} className="text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className={`text-2xl font-display font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{project.name}</h1>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  project.status === "live" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" :
                  project.status === "building" ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" :
                  theme === "dark" ? "bg-white/10 text-white/50 border border-white/10" : "bg-gray-100 text-gray-500 border border-gray-200"
                }`}>
                  {project.status === "live" && "● "}{project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                </span>
              </div>
              <p className={`text-sm mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{project.description}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/app/editor">
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all"
                style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
                data-testid="button-header-open-builder">
                <Code2 size={15} /> Open Builder
              </button>
            </Link>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto">
          {UNIVERSAL_TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all -mb-px ${
                activeTab === tab.id
                  ? "border-cyan-400 text-cyan-400"
                  : theme === "dark" ? "border-transparent text-white/40 hover:text-white/70" : "border-transparent text-gray-500 hover:text-gray-700"
              }`} data-testid={`tab-${tab.id}`}>
              <tab.icon size={15} /> {tab.label}
            </button>
          ))}
          {isWebsite && (
            <>
              <div className={`w-px mx-2 self-stretch my-2 ${theme === "dark" ? "bg-white/10" : "bg-gray-200"}`} />
              {WEBSITE_TABS.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all -mb-px ${
                    activeTab === tab.id
                      ? "border-purple-400 text-purple-400"
                      : theme === "dark" ? "border-transparent text-white/40 hover:text-white/70" : "border-transparent text-gray-500 hover:text-gray-700"
                  }`} data-testid={`tab-${tab.id}`}>
                  <tab.icon size={15} /> {tab.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="p-8">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
            {activeTab === "overview" && <OverviewTab project={project} />}
            {activeTab === "files" && <FilesTab />}
            {activeTab === "console" && <ConsoleTab />}
            {activeTab === "history" && <HistoryTab />}
            {activeTab === "settings" && <ProjectSettingsTab project={project} />}
            {activeTab === "pages" && <PagesTab />}
            {activeTab === "blog" && <BlogTab />}
            {activeTab === "autoblogger" && <AutoBloggerTab />}
            {activeTab === "seo" && <SEOTab />}
            {activeTab === "analytics" && <AnalyticsTab />}
            {activeTab === "domain" && <DomainTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
