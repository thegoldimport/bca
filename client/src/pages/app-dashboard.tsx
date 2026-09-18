import { useState } from "react";
import { Route, Switch, useLocation, Link, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAppUser, setAppUser, clearAppUser, authHeaders } from "@/lib/auth";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutGrid,
  Code2,
  Settings,
  LogOut,
  Sun,
  Moon,
  Plus,
  Search,
  Bell,
  ChevronRight,
  Sparkles,
  Globe,
  Smartphone,
  Gamepad2,
  ShoppingBag,
  MoreHorizontal,
  Clock,
  ExternalLink,
  Trash2,
  Copy,
  Pencil,
  CreditCard,
  User,
  Key,
  Palette,
  Shield,
  HelpCircle,
  MessageSquare,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  Zap,
  Users,
  BarChart3,
  Receipt,
  LifeBuoy,
  Cloud,
  Layers,
  Monitor,
  Tablet,
  History,
  Terminal,
  FolderTree,
  Share2,
  Download,
  ArrowRight,
  Store,
  Briefcase,
  FileText,
  Rocket,
  Image,
  BookOpen,
  X,
  ChevronLeft,
  RefreshCw,
  Maximize2,
  Check,
  Save,
  FileCode,
  Wand2,
} from "lucide-react";
import logo from "@/assets/logo.png";
import cubeLogo from "@/assets/cube-logo.png";
import previewPortfolio from "@/assets/preview-portfolio.jpg";
import previewFitness from "@/assets/preview-fitness.jpg";
import previewGame from "@/assets/preview-game.jpg";
import previewEcommerce from "@/assets/preview-ecommerce.jpg";
import { ThemeProvider, useTheme } from "@/contexts/theme-context";
import { UsersPage, AnalyticsPage, BillingPage, SupportPage, DeploymentsPage } from "@/pages/app-admin-pages";
import ProjectDetail from "@/pages/project-detail";

type UserRole = "super_admin" | "user";
const CURRENT_USER_ROLE: UserRole = "super_admin";

function AppSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  const baseItems = [
    { path: "/app", icon: LayoutGrid, label: "Projects" },
    { path: "/app/templates", icon: Layers, label: "Templates" },
    { path: "/app/editor", icon: Code2, label: "Builder" },
  ];

  const adminItems = [
    { path: "/app/users", icon: Users, label: "Users" },
    { path: "/app/analytics", icon: BarChart3, label: "Analytics" },
    { path: "/app/billing", icon: Receipt, label: "Billing" },
    { path: "/app/support", icon: LifeBuoy, label: "Support" },
    { path: "/app/deployments", icon: Cloud, label: "Deployments" },
  ];

  const navItems = [
    ...baseItems,
    ...(CURRENT_USER_ROLE === "super_admin" ? adminItems : []),
    { path: "/app/settings", icon: Settings, label: "Settings" },
  ];

  const isActive = (path: string) => {
    if (path === "/app") return location === "/app" || location === "/app/";
    return location.startsWith(path);
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={`h-screen flex flex-col border-r shrink-0 ${
        theme === "dark"
          ? "bg-[#0a0a12] border-white/10"
          : "bg-white border-gray-200"
      }`}
    >
      <div className={`flex items-center h-16 px-4 border-b ${
        theme === "dark" ? "border-white/10" : "border-gray-200"
      }`}>
        <Link href="/app">
          <div className="flex items-center gap-3 cursor-pointer">
            {collapsed ? (
              <img src={cubeLogo} alt="BuildCustom.Ai" className="h-9 w-9 object-contain" />
            ) : (
              <img src={logo} alt="BuildCustom.Ai" className="h-8 w-auto" />
            )}
          </div>
        </Link>
        <button
          onClick={onToggle}
          className={`ml-auto p-1.5 rounded-lg transition-colors ${
            theme === "dark"
              ? "hover:bg-white/10 text-white/60"
              : "hover:bg-gray-100 text-gray-500"
          }`}
          data-testid="button-toggle-sidebar"
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item, idx) => {
          const active = isActive(item.path);
          return (
            <div key={item.path}>
              <Link href={item.path}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 group ${
                    active
                      ? theme === "dark"
                        ? "bg-white/10"
                        : "bg-cyan-50"
                      : theme === "dark"
                      ? "text-white/60 hover:text-white hover:bg-white/5"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                >
                  <item.icon size={20} className={active ? "text-purple-400" : ""} />
                  {!collapsed && (
                    <span className={`font-medium text-sm ${active ? "text-brand-gradient" : ""}`}>{item.label}</span>
                  )}
                  {active && !collapsed && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-purple-500" />
                  )}
                </div>
              </Link>
            </div>
          );
        })}
      </nav>

      <div className={`px-3 py-4 border-t space-y-2 ${
        theme === "dark" ? "border-white/10" : "border-gray-200"
      }`}>
        <button
          onClick={toggleTheme}
          className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-colors ${
            theme === "dark"
              ? "text-white/60 hover:text-white hover:bg-white/5"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          }`}
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? <Sun size={20} className="text-purple-400" /> : <Moon size={20} className="text-purple-400" />}
          {!collapsed && (
            <span className="font-medium text-sm text-brand-gradient">
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </span>
          )}
        </button>
        <button
          onClick={() => { clearAppUser(); window.location.href = "/app/login"; }}
          className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-colors ${
            theme === "dark"
              ? "text-white/60 hover:text-red-400 hover:bg-red-500/10"
              : "text-gray-600 hover:text-red-600 hover:bg-red-50"
          }`}
          data-testid="button-logout"
        >
          <LogOut size={20} />
          {!collapsed && <span className="font-medium text-sm">Log Out</span>}
        </button>
      </div>
    </motion.aside>
  );
}

function AppTopBar() {
  const { theme } = useTheme();
  const appUser = getAppUser();
  const initials = appUser?.username ? appUser.username.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) : "U";

  return (
    <header className={`h-16 flex items-center justify-between px-6 border-b shrink-0 ${
      theme === "dark"
        ? "bg-[#0a0a12]/80 backdrop-blur-xl border-white/10"
        : "bg-white/80 backdrop-blur-xl border-gray-200"
    }`}>
      <div className={`flex items-center gap-3 px-4 py-2 rounded-xl w-80 ${
        theme === "dark"
          ? "bg-white/5 border border-white/10"
          : "bg-gray-100 border border-gray-200"
      }`}>
        <Search size={16} className={theme === "dark" ? "text-white/40" : "text-gray-400"} />
        <input
          type="text"
          placeholder="Search projects..."
          className={`bg-transparent border-none outline-none text-sm w-full ${
            theme === "dark"
              ? "text-white placeholder-white/40"
              : "text-gray-900 placeholder-gray-400"
          }`}
          data-testid="input-search"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${
          theme === "dark"
            ? "bg-white/5 border border-white/10"
            : "bg-gray-100 border border-gray-200"
        }`} data-testid="credits-meter">
          <Zap size={14} className="text-amber-400" />
          <div className="flex flex-col">
            <span className={`text-[10px] leading-tight font-medium ${
              theme === "dark" ? "text-white/40" : "text-gray-500"
            }`}>Credits</span>
            <span className={`text-xs font-semibold leading-tight ${
              theme === "dark" ? "text-white/80" : "text-gray-700"
            }`}>847 / 1,000</span>
          </div>
          <div className={`w-16 h-1.5 rounded-full overflow-hidden ${
            theme === "dark" ? "bg-white/10" : "bg-gray-200"
          }`}>
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500" style={{ width: "84.7%" }} />
          </div>
        </div>

        <button
          className={`relative p-2 rounded-xl transition-colors ${
            theme === "dark"
              ? "hover:bg-white/5 text-white/60"
              : "hover:bg-gray-100 text-gray-500"
          }`}
          data-testid="button-notifications"
        >
          <Bell size={20} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-cyan-400 rounded-full" />
        </button>

        <div className={`flex items-center gap-3 px-3 py-1.5 rounded-xl cursor-pointer transition-colors ${
          theme === "dark" ? "hover:bg-white/5" : "hover:bg-gray-100"
        }`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-brand-gradient">{appUser?.username || "User"}</p>
            <p className={`text-xs capitalize ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{appUser?.plan || "Starter"} Plan</p>
          </div>
          <ChevronDown size={14} className={theme === "dark" ? "text-white/40" : "text-gray-400"} />
        </div>
      </div>
    </header>
  );
}

const PROJECT_TYPE_ICONS: Record<string, any> = {
  website: Globe, app: Smartphone, game: Gamepad2, saas: ShoppingBag,
};
const PREVIEW_IMAGES: Record<string, any> = {
  website: previewPortfolio, app: previewFitness, game: previewGame, saas: previewEcommerce,
};

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", type: "website", description: "" });
  const [error, setError] = useState("");
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const types = [
    { id: "website", label: "Website", icon: Globe },
    { id: "app", label: "App", icon: Smartphone },
    { id: "game", label: "Game", icon: Gamepad2 },
    { id: "saas", label: "SaaS", icon: ShoppingBag },
  ];
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create project");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); onCreated(); },
    onError: (err: any) => setError(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className={`relative w-full max-w-md rounded-2xl border p-6 z-10 ${
          theme === "dark" ? "bg-[#0d0d1a] border-white/10" : "bg-white border-gray-200"
        }`}
      >
        <h2 className={`text-xl font-display font-bold mb-1 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>New Project</h2>
        <p className={`text-sm mb-6 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>What would you like to build?</p>

        <div className="space-y-4">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Project Name</label>
            <input
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="My Awesome Project"
              className={`w-full px-4 py-2.5 rounded-xl text-sm outline-none border transition-colors ${
                theme === "dark"
                  ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50"
                  : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-cyan-400"
              }`}
              data-testid="input-project-name"
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-2 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Project Type</label>
            <div className="grid grid-cols-2 gap-2">
              {types.map(t => (
                <button
                  key={t.id}
                  onClick={() => set("type", t.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    form.type === t.id
                      ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-400"
                      : theme === "dark"
                        ? "border-white/10 text-white/50 hover:border-white/20 hover:text-white/80"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                  data-testid={`button-type-${t.id}`}
                >
                  <t.icon size={15} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1.5 ${theme === "dark" ? "text-white/50" : "text-gray-600"}`}>Description <span className="opacity-50">(optional)</span></label>
            <textarea
              value={form.description}
              onChange={e => set("description", e.target.value)}
              placeholder="Briefly describe your project..."
              rows={2}
              className={`w-full px-4 py-2.5 rounded-xl text-sm outline-none border transition-colors resize-none ${
                theme === "dark"
                  ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-cyan-400/50"
                  : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-cyan-400"
              }`}
              data-testid="input-project-description"
            />
          </div>

          {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
              theme === "dark" ? "border-white/10 text-white/50 hover:text-white/80" : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>Cancel</button>
            <button
              onClick={() => { if (!form.name.trim()) { setError("Project name is required"); return; } mutation.mutate(); }}
              disabled={mutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
              data-testid="button-create-project"
            >
              {mutation.isPending ? "Creating..." : "Create Project"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ProjectsPage() {
  const { theme } = useTheme();
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [, navigate] = useLocation();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    },
  });

  const typeColors: Record<string, string> = {
    website: "text-cyan-400", app: "text-purple-400", game: "text-pink-400", saas: "text-amber-400",
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {showNewProject && (
        <AnimatePresence>
          <NewProjectModal
            onClose={() => setShowNewProject(false)}
            onCreated={() => setShowNewProject(false)}
          />
        </AnimatePresence>
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">Projects</h1>
          <p className={`mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
            Build, manage, and deploy your creations
          </p>
        </div>
        <button
          onClick={() => setShowNewProject(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40"
          style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 35%, #a855f7 65%, #ec4899 100%)" }}
          data-testid="button-new-project"
        >
          <Plus size={18} />
          New Project
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <motion.div
          whileHover={{ scale: 1.02 }}
          onClick={() => setShowNewProject(true)}
          className={`rounded-2xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-colors min-h-[240px] ${
            theme === "dark"
              ? "border-white/20 hover:border-cyan-400/50 hover:bg-cyan-500/5"
              : "border-gray-300 hover:border-cyan-400 hover:bg-cyan-50"
          }`}
          data-testid="card-create-project"
        >
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${theme === "dark" ? "bg-white/10" : "bg-gray-100"}`}>
            <Sparkles size={24} className="text-cyan-400" />
          </div>
          <div className="text-center">
            <p className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Start from Scratch</p>
            <p className={`text-sm mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Describe your idea and let AI build it</p>
          </div>
        </motion.div>

        {isLoading && (
          [1, 2, 3].map(i => (
            <div key={i} className={`rounded-2xl border h-64 animate-pulse ${theme === "dark" ? "bg-white/[0.03] border-white/10" : "bg-gray-100 border-gray-200"}`} />
          ))
        )}

        {projects.map((project: any) => {
          const IconComponent = PROJECT_TYPE_ICONS[project.type] || Globe;
          const previewImg = PREVIEW_IMAGES[project.type] || previewPortfolio;
          const iconColor = typeColors[project.type] || "text-cyan-400";
          const updatedAgo = (() => {
            const diff = Date.now() - new Date(project.updatedAt).getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 60) return `${mins}m ago`;
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return `${hrs}h ago`;
            return `${Math.floor(hrs / 24)}d ago`;
          })();

          return (
            <motion.div
              key={project.id}
              whileHover={{ scale: 1.02, y: -2 }}
              onMouseEnter={() => setHoveredProject(String(project.id))}
              onMouseLeave={() => setHoveredProject(null)}
              onClick={() => navigate(`/app/project/${project.id}`)}
              className={`rounded-2xl border cursor-pointer transition-all relative overflow-hidden flex flex-col ${
                theme === "dark"
                  ? "bg-white/[0.03] border-white/10 hover:border-white/20 hover:bg-white/[0.06]"
                  : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-lg"
              }`}
              data-testid={`card-project-${project.id}`}
            >
              <div className="relative w-full h-40 overflow-hidden">
                <img src={previewImg} alt={project.name} className="w-full h-full object-cover" />
                <div className={`absolute inset-0 ${theme === "dark" ? "bg-gradient-to-t from-[#0a0a12] via-transparent to-transparent" : "bg-gradient-to-t from-white via-transparent to-transparent"}`} />
                <span className={`absolute top-3 right-3 text-xs px-2.5 py-1 rounded-full font-medium backdrop-blur-md ${
                  project.status === "live"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                    : project.status === "building"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-400/30"
                    : "bg-white/10 text-white/70 border border-white/20"
                }`}>
                  {project.status === "live" && "● "}
                  {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                </span>
              </div>

              <div className="relative z-10 p-5 flex-1 flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      theme === "dark" ? "bg-gradient-to-br from-cyan-500/20 to-purple-500/20" : "bg-gradient-to-br from-cyan-50 to-purple-50"
                    }`}>
                      <IconComponent size={18} className={iconColor} />
                    </div>
                    <div>
                      <h3 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{project.name}</h3>
                      <p className={`text-xs capitalize ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{project.type}</p>
                    </div>
                  </div>
                  <button
                    className={`p-1.5 rounded-lg transition-colors ${theme === "dark" ? "hover:bg-white/10 text-white/40" : "hover:bg-gray-100 text-gray-400"}`}
                    onClick={e => e.stopPropagation()}
                    data-testid={`button-project-menu-${project.id}`}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>

                <div className={`mt-3 pt-3 border-t flex items-center justify-between ${theme === "dark" ? "border-white/10" : "border-gray-100"}`}>
                  <div className="flex items-center gap-1.5">
                    <Clock size={13} className={theme === "dark" ? "text-white/30" : "text-gray-400"} />
                    <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{updatedAgo}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {[
                      { icon: History, label: "Version History", testId: `btn-history-${project.id}` },
                      { icon: Terminal, label: "Console", testId: `btn-console-${project.id}` },
                      { icon: FolderTree, label: "Files", testId: `btn-files-${project.id}` },
                      { icon: Share2, label: "Share", testId: `btn-share-${project.id}` },
                      { icon: Download, label: "Export", testId: `btn-export-${project.id}` },
                    ].map((action) => (
                      <button
                        key={action.testId}
                        title={action.label}
                        onClick={(e) => e.stopPropagation()}
                        className={`p-1.5 rounded-lg transition-colors ${
                          theme === "dark"
                            ? "hover:bg-white/10 text-white/30 hover:text-white/70"
                            : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                        }`}
                        data-testid={action.testId}
                      >
                        <action.icon size={14} />
                      </button>
                    ))}
                  </div>
                </div>
                {project.url && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <ExternalLink size={12} className="text-cyan-400/60" />
                    <span className="text-xs text-cyan-400/80">{project.url}</span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewMockup({ device }: { device: "desktop" | "tablet" | "mobile" }) {
  const { theme } = useTheme();
  const isMobile = device === "mobile";
  const isTablet = device === "tablet";

  return (
    <div className={`w-full h-full overflow-y-auto ${theme === "dark" ? "bg-[#0c0c1a]" : "bg-white"}`}>
      <div className={`relative overflow-hidden ${isMobile ? "px-4 py-8" : isTablet ? "px-8 py-12" : "px-16 py-16"}`}
        style={{ background: theme === "dark" ? "linear-gradient(135deg, #0c0c1a 0%, #1a1033 50%, #0c0c1a 100%)" : "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 50%, #f0f9ff 100%)" }}>
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-10 left-10 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto text-center space-y-6">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium ${
            theme === "dark" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "bg-cyan-50 text-cyan-700 border border-cyan-200"
          }`}>
            <Sparkles size={12} /> Now in Beta
          </div>
          <h1 className={`font-display font-bold leading-tight ${
            isMobile ? "text-2xl" : isTablet ? "text-3xl" : "text-5xl"
          } ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
            Build Something<br />
            <span className="text-brand-gradient">Amazing Today</span>
          </h1>
          <p className={`leading-relaxed max-w-md mx-auto ${
            isMobile ? "text-sm" : "text-base"
          } ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
            The fastest way to turn your ideas into production-ready applications with the power of AI.
          </p>
          <div className={`flex gap-3 justify-center ${isMobile ? "flex-col" : ""}`}>
            <button className={`px-6 py-3 rounded-xl text-white font-semibold text-sm ${isMobile ? "w-full" : ""}`}
              style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1, #ec4899)" }}>
              Get Started Free
            </button>
            <button className={`px-6 py-3 rounded-xl font-semibold text-sm ${isMobile ? "w-full" : ""} ${
              theme === "dark" ? "bg-white/10 text-white border border-white/20" : "bg-gray-100 text-gray-700 border border-gray-200"
            }`}>
              Watch Demo
            </button>
          </div>
        </div>
      </div>

      <div className={`${isMobile ? "px-4 py-8" : isTablet ? "px-8 py-12" : "px-16 py-16"} ${
        theme === "dark" ? "bg-[#0a0a14]" : "bg-white"
      }`}>
        <h2 className={`font-display font-bold text-center mb-8 ${
          isMobile ? "text-xl" : "text-2xl"
        } ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Features</h2>
        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : isTablet ? "grid-cols-2" : "grid-cols-3"}`}>
          {[
            { icon: Zap, title: "Lightning Fast", desc: "Deploy in seconds" },
            { icon: Shield, title: "Secure", desc: "Enterprise security" },
            { icon: Globe, title: "Global CDN", desc: "Edge deployment" },
          ].map((feat) => (
            <div key={feat.title} className={`p-5 rounded-xl ${
              theme === "dark" ? "bg-white/5 border border-white/10" : "bg-gray-50 border border-gray-200"
            }`}>
              <feat.icon size={20} className="text-cyan-400 mb-3" />
              <h3 className={`font-semibold text-sm mb-1 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{feat.title}</h3>
              <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{feat.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditorPage() {
  const { theme } = useTheme();
  const [, routeParams] = useRoute("/app/editor/:id");
  const projectId = Number(routeParams?.id || 0);
  const [chatInput, setChatInput] = useState("");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!chatInput.trim()) return;
    if (!projectId) {
      setRuntimeError("Open Builder from a runtime-backed project to start a ThinkAgent session.");
      return;
    }
    const prompt = chatInput.trim();
    setMessages((prev) => [
      ...prev,
      { role: "user" as const, content: prompt },
    ]);
    setChatInput("");
    setSending(true);
    setRuntimeError("");
    try {
      const workspace = await fetch(`/api/projects/${projectId}/runtime/workspace`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      if (!workspace.ok) {
        const data = await workspace.json().catch(() => ({}));
        throw new Error(data.message || "Unable to initialize the VibeSDK workspace.");
      }
      const session = await fetch(`/api/projects/${projectId}/runtime/agent/sessions`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const sessionData = await session.json();
      if (!session.ok) throw new Error(sessionData.message || "Unable to start the ThinkAgent session.");
      const response = await fetch(`/api/projects/${projectId}/runtime/agent/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
        body: JSON.stringify({ sessionId: sessionData.id || sessionData.sessionId, message: prompt }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "ThinkAgent could not process the request.");
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let output = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const withoutStreaming = prev.filter((message) => message.role !== "assistant" || message.content !== output.slice(0, -1));
          return [...withoutStreaming.filter((message) => message.content !== output), { role: "assistant", content: output }];
        });
      }
      if (!output) setMessages((prev) => [...prev, { role: "assistant", content: "ThinkAgent completed the request." }]);
      const preview = await fetch(`/api/projects/${projectId}/runtime/previews`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({}),
      });
      const previewData = await preview.json().catch(() => ({}));
      if (preview.ok && previewData.url) setPreviewUrl(previewData.url);
    } catch (error: any) {
      setRuntimeError(error.message || "The runtime request failed.");
    } finally {
      setSending(false);
    }
  };

  const deviceWidths = { desktop: "100%", tablet: "768px", mobile: "390px" };
  const deviceButtons = [
    { id: "desktop" as const, icon: Monitor, label: "Desktop" },
    { id: "tablet" as const, icon: Tablet, label: "Tablet" },
    { id: "mobile" as const, icon: Smartphone, label: "Mobile" },
  ];

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <div className={`w-[420px] flex flex-col border-r shrink-0 ${
        theme === "dark"
          ? "bg-[#0a0a12] border-white/10"
          : "bg-white border-gray-200"
      }`}>
        <div className={`px-5 py-4 border-b flex items-center gap-3 ${
          theme === "dark" ? "border-white/10" : "border-gray-200"
        }`}>
          <Zap size={18} className="text-purple-400" />
          <h2 className="font-display font-semibold text-brand-gradient">AI Builder</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {runtimeError && <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{runtimeError}</div>}
          {!messages.length && !runtimeError && <div className={`rounded-2xl px-4 py-3 text-sm ${theme === "dark" ? "bg-white/5 text-white/60 border border-white/10" : "bg-gray-100 text-gray-600 border border-gray-200"}`}>ThinkAgent is ready. Describe what you want to build.</div>}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-gradient-to-r from-cyan-500 to-cyan-400 text-black rounded-br-md"
                  : theme === "dark"
                  ? "bg-white/5 text-white/80 border border-white/10 rounded-bl-md"
                  : "bg-gray-100 text-gray-800 border border-gray-200 rounded-bl-md"
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
        </div>

        <div className={`p-4 border-t ${
          theme === "dark" ? "border-white/10" : "border-gray-200"
        }`}>
          <div className={`flex items-end gap-2 p-3 rounded-xl ${
            theme === "dark"
              ? "bg-white/5 border border-white/10"
              : "bg-gray-100 border border-gray-200"
          }`}>
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Describe what you want to build..."
              rows={2}
              className={`flex-1 bg-transparent border-none outline-none resize-none text-sm ${
                theme === "dark"
                  ? "text-white placeholder-white/40"
                  : "text-gray-900 placeholder-gray-400"
              }`}
              data-testid="input-editor-chat"
            />
            <button
              onClick={handleSend}
              disabled={sending}
              className="shrink-0 p-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-black transition-colors"
              data-testid="button-send-chat"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className={`flex-1 flex flex-col ${
        theme === "dark" ? "bg-[#060610]" : "bg-gray-50"
      }`}>
        <div className={`flex items-center gap-3 px-5 py-3 border-b ${
          theme === "dark" ? "border-white/10" : "border-gray-200"
        }`}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400/80" />
            <div className="w-3 h-3 rounded-full bg-amber-400/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-400/80" />
          </div>

          <div className={`flex items-center gap-1 p-1 rounded-lg ${
            theme === "dark" ? "bg-white/5" : "bg-gray-200"
          }`}>
            {deviceButtons.map((btn) => (
              <button
                key={btn.id}
                onClick={() => setPreviewDevice(btn.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  previewDevice === btn.id
                    ? theme === "dark"
                      ? "bg-white/10 text-white shadow-sm"
                      : "bg-white text-gray-900 shadow-sm"
                    : theme === "dark"
                    ? "text-white/40 hover:text-white/70"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                data-testid={`button-preview-${btn.id}`}
              >
                <btn.icon size={14} />
                {btn.label}
              </button>
            ))}
          </div>

          <div className={`flex-1 px-4 py-1.5 rounded-lg text-center text-xs ${
            theme === "dark"
              ? "bg-white/5 text-white/40"
              : "bg-gray-200 text-gray-500"
          }`}>
             {previewUrl || (projectId ? "Waiting for an authorized preview…" : "Select a runtime project")}
          </div>
          <button className={`p-1.5 rounded-lg transition-colors ${
            theme === "dark"
              ? "hover:bg-white/10 text-white/40"
              : "hover:bg-gray-200 text-gray-400"
          }`}>
            <ExternalLink size={14} />
          </button>
        </div>

        <div className="flex-1 flex items-start justify-center overflow-hidden p-4">
          <motion.div
            key={previewDevice}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className={`h-full overflow-hidden ${
              previewDevice !== "desktop"
                ? `rounded-2xl border shadow-2xl ${
                    theme === "dark"
                      ? "border-white/10 shadow-black/50"
                      : "border-gray-300 shadow-gray-300/50"
                  }`
                : ""
            }`}
            style={{ width: deviceWidths[previewDevice], maxWidth: "100%" }}
          >
             {previewUrl ? <iframe src={previewUrl} title="Runtime preview" className="w-full h-full border-0 bg-white" /> : (
               <div className={`h-full flex items-center justify-center text-sm ${theme === "dark" ? "bg-[#0d0d1a] text-white/40" : "bg-white text-gray-500"}`}>
                 {projectId ? "Send a ThinkAgent request to create a preview." : "A project is required for a live preview."}
               </div>
             )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

const TEMPLATE_CATEGORIES = [
  { id: "all",       label: "All",          icon: Layers },
  { id: "saas",      label: "SaaS",         icon: Rocket },
  { id: "ai",        label: "AI Apps",      icon: Sparkles },
  { id: "app",       label: "Apps",         icon: Monitor },
  { id: "ecommerce", label: "E-Commerce",   icon: Store },
  { id: "devtools",  label: "Dev Tools",    icon: Code2 },
];

const TEMPLATE_DEMO_URLS: Record<string, string> = {
  "saas-boilerplate":  "https://nextjs-boilerplate.ixartz.com/",
  "create-t3-app":     "https://create.t3.gg/",
  "platforms":         "https://app.vercel.pub/",
  "taxonomy":          "https://tx.shadcn.com/",
  "nextchat":          "https://app.nextchat.dev/",
  "novel":             "https://novel.sh/",
  "chatbot-ui":        "https://www.chatbotui.com/",
  "umami":             "https://app.umami.is/share/LGazGOecbDtaIwDr/umami.is",
  "ant-design-pro":    "https://preview.pro.ant.design/",
  "jitsi-meet":        "https://meet.jit.si/",
  "refine":            "https://example.admin.refine.dev/",
  "medusa":            "https://demo.medusajs.com/",
  "hoppscotch":        "https://hoppscotch.io/",
  "excalidraw":        "https://excalidraw.com/",
  "actual":            "https://app.actualbudget.org/",
};

function getThumbnailUrl(slug: string) {
  const demo = TEMPLATE_DEMO_URLS[slug];
  if (!demo) return null;
  return `https://image.thum.io/get/width/1200/crop/750/${demo}`;
}

function getPreviewImageUrl(slug: string) {
  const demo = TEMPLATE_DEMO_URLS[slug];
  if (!demo) return null;
  return `https://image.thum.io/get/fullpage/width/1440/${demo}`;
}

function TemplateThumbnail({ slug, color }: { slug: string; color: string }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const src = getThumbnailUrl(slug);
  return (
    <div className={`h-44 relative overflow-hidden ${errored || !src ? `bg-gradient-to-br ${color}` : "bg-gray-200"}`}>
      {src && !errored && (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover object-top"
          style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
      {/* skeleton shimmer while loading */}
      {src && !errored && !loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse" />
      )}
      {/* gradient fallback icon */}
      {(errored || !src) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Globe size={32} className="text-white/30" />
        </div>
      )}
    </div>
  );
}

function formatStars(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function TemplateBrowserModal({
  template,
  onClose,
  onUse,
  isUsing,
}: {
  template: any;
  onClose: () => void;
  onUse: () => void;
  isUsing: boolean;
}) {
  const { theme } = useTheme();
  const demoUrl = TEMPLATE_DEMO_URLS[template.slug] || template.forkUrl;
  const imgUrl = getPreviewImageUrl(template.slug);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
        onClick={onClose}
        data-testid="modal-template-preview-backdrop"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="w-full max-w-5xl flex flex-col rounded-2xl overflow-hidden shadow-2xl"
          style={{ height: "85vh", maxHeight: "800px" }}
          onClick={(e) => e.stopPropagation()}
          data-testid="modal-template-preview"
        >
          {/* ── Modal header bar (outside browser) ── */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ background: theme === "dark" ? "#0f0f1a" : "#1a1a2e" }}
          >
            <div className="flex items-center gap-3">
              <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${template.color} flex items-center justify-center shrink-0`}>
                <Sparkles size={14} className="text-white" />
              </div>
              <div>
                <p className="text-white font-display font-semibold text-sm leading-tight">{template.name}</p>
                <p className="text-white/40 text-[11px]">{template.framework}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs font-medium hover:bg-white/20 transition-colors"
                data-testid="button-open-live-demo"
              >
                <ExternalLink size={12} /> Live Demo
              </a>
              <button
                onClick={onUse}
                disabled={isUsing}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-semibold transition-all disabled:opacity-60"
                style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 60%, #ec4899 100%)" }}
                data-testid="button-use-template-modal"
              >
                {isUsing ? "Creating project…" : "Use Template"}
                <ArrowRight size={12} />
              </button>
              <button
                onClick={onClose}
                className="ml-1 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                data-testid="button-close-preview"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* ── Fake browser chrome ── */}
          <div
            className="flex items-center gap-3 px-4 py-2.5 shrink-0"
            style={{ background: theme === "dark" ? "#18182a" : "#242436" }}
          >
            {/* Traffic lights */}
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            {/* Nav buttons */}
            <div className="flex items-center gap-1">
              <button className="p-1 rounded text-white/30 cursor-default">
                <ChevronLeft size={14} />
              </button>
              <button className="p-1 rounded text-white/30 cursor-default">
                <RefreshCw size={13} />
              </button>
            </div>
            {/* URL bar */}
            <div
              className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono truncate"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <div className="w-2.5 h-2.5 rounded-full bg-green-400/60 shrink-0" />
              <span className="text-white/50 truncate">{demoUrl}</span>
            </div>
            <button className="p-1 rounded text-white/30 cursor-default">
              <Maximize2 size={13} />
            </button>
          </div>

          {/* ── Scrollable screenshot area ── */}
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden relative"
            style={{ background: "#fff", minHeight: 0 }}
            data-testid="preview-scroll-area"
          >
            {imgUrl && !imgError ? (
              <>
                {!imgLoaded && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ background: "#f5f5f5" }}>
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-indigo-500/40 border-t-indigo-500 rounded-full animate-spin" />
                      <p className="text-xs text-gray-400 font-medium">Loading preview…</p>
                      <p className="text-[11px] text-gray-300">Rendering {template.name}</p>
                    </div>
                  </div>
                )}
                <img
                  src={imgUrl}
                  alt={`${template.name} preview`}
                  className="w-full block"
                  style={{ display: imgLoaded ? "block" : "none" }}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                  data-testid="img-template-preview"
                />
              </>
            ) : (
              /* Fallback if no screenshot service or error */
              <div
                className={`h-full min-h-[400px] bg-gradient-to-br ${template.color} flex flex-col items-center justify-center gap-6 p-8`}
              >
                <div className="w-24 h-24 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                  <Sparkles size={40} className="text-white/70" />
                </div>
                <div className="text-center">
                  <p className="text-white font-display font-bold text-2xl mb-2">{template.name}</p>
                  <p className="text-white/70 text-sm max-w-sm">{template.description}</p>
                </div>
                <a
                  href={demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/20 text-white text-sm font-semibold hover:bg-white/30 transition-colors border border-white/30"
                >
                  <ExternalLink size={14} /> Open Live Demo
                </a>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function TemplateCardSkeleton({ theme }: { theme: string }) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${theme === "dark" ? "bg-white/[0.03] border-white/10" : "bg-white border-gray-200"}`}>
      <div className="h-40 bg-white/5 animate-pulse" />
      <div className="p-5 flex flex-col gap-3">
        <div className={`h-5 w-1/2 rounded animate-pulse ${theme === "dark" ? "bg-white/10" : "bg-gray-200"}`} />
        <div className={`h-3 w-full rounded animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />
        <div className={`h-3 w-4/5 rounded animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />
        <div className="flex gap-1.5 mt-1">
          {[1,2,3].map(i => <div key={i} className={`h-4 w-14 rounded animate-pulse ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`} />)}
        </div>
      </div>
    </div>
  );
}

function TemplatesPage() {
  const { theme } = useTheme();
  const [activeCategory, setActiveCategory] = useState("all");
  const [previewTemplate, setPreviewTemplate] = useState<any>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const user = getAppUser();

  const { data: allTemplates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/templates"],
    queryFn: async () => {
      const res = await fetch("/api/templates");
      if (!res.ok) throw new Error("Failed to load templates");
      return res.json();
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: async (template: any) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          userId: user?.id,
          name: template.name,
          type: template.projectType,
          status: "draft",
          description: template.description,
          framework: template.framework,
          url: template.forkUrl,
        }),
      });
      if (!res.ok) throw new Error("Failed to create project");
      return res.json();
    },
    onSuccess: (project: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      navigate(`/app/project/${project.id}`);
    },
  });

  const filteredTemplates = activeCategory === "all"
    ? allTemplates
    : allTemplates.filter((t: any) => t.category === activeCategory);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">Templates</h1>
          <p className={`mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
            {allTemplates.length > 0
              ? `${allTemplates.length} real open-source templates — forked to your GitHub, ready to build on`
              : "Start from a professionally designed template"}
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-8 flex-wrap">
        {TEMPLATE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeCategory === cat.id
                ? "text-white shadow-lg"
                : theme === "dark"
                ? "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 border border-gray-200"
            }`}
            style={activeCategory === cat.id ? { background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" } : undefined}
            data-testid={`filter-template-${cat.id}`}
          >
            <cat.icon size={16} />
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <TemplateCardSkeleton key={i} theme={theme} />)
          : filteredTemplates.map((template: any) => (
          <motion.div
            key={template.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            layout
            onClick={() => setPreviewTemplate(template)}
            className={`group rounded-2xl border overflow-hidden cursor-pointer transition-all hover:shadow-xl ${
              theme === "dark"
                ? "bg-white/[0.03] border-white/10 hover:border-white/20 hover:shadow-purple-500/10"
                : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-gray-200/60"
            }`}
            data-testid={`card-template-${template.id}`}
          >
            <div className="relative group-hover:[&_.preview-overlay]:opacity-100 group-hover:[&_.use-btn]:opacity-100">
              <TemplateThumbnail slug={template.slug} color={template.color} />
              {template.featured && (
                <div className="absolute top-3 left-3 z-10">
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold border border-white/20">
                    <Sparkles size={9} /> Featured
                  </span>
                </div>
              )}
              {/* Preview hint on hover */}
              <div className="preview-overlay absolute inset-0 flex items-center justify-center opacity-0 transition-opacity bg-black/40 pointer-events-none">
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/15 backdrop-blur-sm border border-white/25 text-white text-xs font-semibold">
                  <Monitor size={13} /> Preview
                </div>
              </div>
              <div className="use-btn absolute top-3 right-3 opacity-0 transition-opacity z-10">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    createProjectMutation.mutate(template);
                  }}
                  disabled={createProjectMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 text-black text-xs font-semibold hover:bg-white transition-colors shadow-lg disabled:opacity-60"
                  data-testid={`button-use-template-${template.id}`}
                >
                  {createProjectMutation.isPending ? "Creating..." : "Use Template"}
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>

            <div className="p-5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className={`font-display font-semibold text-lg ${
                  theme === "dark" ? "text-white" : "text-gray-900"
                }`}>{template.name}</h3>
                {template.stars > 0 && (
                  <span className={`flex items-center gap-1 text-[11px] font-medium shrink-0 mt-1 ${
                    theme === "dark" ? "text-white/40" : "text-gray-400"
                  }`}>
                    ★ {formatStars(template.stars)}
                  </span>
                )}
              </div>
              <p className={`text-sm mb-3 leading-relaxed ${
                theme === "dark" ? "text-white/50" : "text-gray-500"
              }`}>{template.description}</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(template.tags || []).map((tag: string) => (
                  <span
                    key={tag}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                      theme === "dark"
                        ? "bg-white/5 text-white/50 border border-white/10"
                        : "bg-gray-100 text-gray-500 border border-gray-200"
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-mono ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>
                  {template.framework}
                </span>
                <a
                  href={template.forkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={`flex items-center gap-1 text-[11px] hover:underline ${
                    theme === "dark" ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"
                  }`}
                  data-testid={`link-github-template-${template.id}`}
                >
                  <ExternalLink size={10} /> GitHub
                </a>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Browser preview modal */}
      {previewTemplate && (
        <TemplateBrowserModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onUse={() => createProjectMutation.mutate(previewTemplate)}
          isUsing={createProjectMutation.isPending}
        />
      )}
    </div>
  );
}

function SettingsPage() {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState("account");

  const tabs = [
    { id: "account", label: "Account", icon: User },
    { id: "plan", label: "Plan & Billing", icon: CreditCard },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "api", label: "API Keys", icon: Key },
    { id: "security", label: "Security", icon: Shield },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-display font-bold mb-8 text-brand-gradient">Settings</h1>

      <div className="flex gap-8">
        <nav className="w-56 shrink-0 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? theme === "dark"
                    ? "bg-white/10"
                    : "bg-cyan-50"
                  : theme === "dark"
                  ? "text-white/50 hover:text-white hover:bg-white/5"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon size={18} className={activeTab === tab.id ? "text-purple-400" : ""} />
              <span className={activeTab === tab.id ? "text-brand-gradient" : ""}>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex-1">
          {activeTab === "account" && <AccountSettings />}
          {activeTab === "plan" && <PlanSettings />}
          {activeTab === "appearance" && <AppearanceSettings />}
          {activeTab === "api" && <ApiKeySettings />}
          {activeTab === "security" && <SecuritySettings />}
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className={`rounded-2xl border p-6 mb-6 ${
      theme === "dark"
        ? "bg-white/[0.02] border-white/10"
        : "bg-white border-gray-200"
    }`}>
      <h3 className="font-semibold text-lg mb-1 text-brand-gradient">{title}</h3>
      {description && (
        <p className={`text-sm mb-5 ${
          theme === "dark" ? "text-white/40" : "text-gray-500"
        }`}>{description}</p>
      )}
      {children}
    </div>
  );
}

function SettingsInput({ label, value, type = "text" }: { label: string; value: string; type?: string }) {
  const { theme } = useTheme();
  return (
    <div className="mb-4">
      <label className={`block text-sm font-medium mb-2 ${
        theme === "dark" ? "text-white/70" : "text-gray-700"
      }`}>{label}</label>
      <input
        type={type}
        defaultValue={value}
        className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${
          theme === "dark"
            ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50"
            : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"
        }`}
        data-testid={`input-${label.toLowerCase().replace(/\s+/g, "-")}`}
      />
    </div>
  );
}

function AccountSettings() {
  const { theme } = useTheme();
  const storedUser = getAppUser();
  const [form, setForm] = useState({ name: storedUser?.username || "", email: storedUser?.email || "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save");
      return data;
    },
    onSuccess: (data) => {
      if (storedUser) setAppUser({ ...storedUser, username: data.username, email: data.email });
      setSaved(true);
      setError("");
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: any) => setError(err.message),
  });

  const initials = (form.name || "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      <SettingsCard title="Profile" description="Manage your account details">
        <div className="flex items-center gap-5 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white font-bold text-xl">
            {initials}
          </div>
        </div>
        <div className="mb-4">
          <label className={`block text-sm font-medium mb-2 ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>Full Name</label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
            data-testid="input-full-name"
          />
        </div>
        <div className="mb-4">
          <label className={`block text-sm font-medium mb-2 ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>Email Address</label>
          <input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
            data-testid="input-email"
          />
        </div>
        {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-3">{error}</p>}
        <button
          onClick={() => { setError(""); save.mutate(); }}
          disabled={save.isPending}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 ${saved ? "bg-emerald-400 text-black" : "bg-cyan-400 text-black"}`}
          data-testid="button-save-profile"
        >
          {saved ? <><Check size={15} /> Saved!</> : save.isPending ? "Saving..." : "Save Changes"}
        </button>
      </SettingsCard>
    </>
  );
}

function PlanSettings() {
  const { theme } = useTheme();
  const plans = [
    { name: "Starter", price: "$0", features: ["3 Projects", "Basic AI Builder", "Shared Hosting"], current: false },
    { name: "Pro", price: "$29", features: ["Unlimited Projects", "Advanced AI Builder", "Custom Domains", "Priority Support"], current: true },
    { name: "Enterprise", price: "Custom", features: ["Everything in Pro", "Team Collaboration", "Dedicated Support", "SLA"], current: false },
  ];

  return (
    <SettingsCard title="Plan & Billing" description="Manage your subscription">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`rounded-xl border p-5 relative ${
              plan.current
                ? theme === "dark"
                  ? "border-cyan-400/50 bg-cyan-500/5"
                  : "border-cyan-400 bg-cyan-50"
                : theme === "dark"
                ? "border-white/10 bg-white/[0.02]"
                : "border-gray-200 bg-white"
            }`}
          >
            {plan.current && (
              <span className="absolute -top-2.5 left-4 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-cyan-400 text-black">
                Current
              </span>
            )}
            <h4 className={`font-semibold text-lg mb-1 ${
              theme === "dark" ? "text-white" : "text-gray-900"
            }`}>{plan.name}</h4>
            <p className={`text-2xl font-bold mb-4 ${
              theme === "dark" ? "text-white" : "text-gray-900"
            }`}>
              {plan.price}
              {plan.price !== "Custom" && <span className={`text-sm font-normal ${
                theme === "dark" ? "text-white/40" : "text-gray-500"
              }`}>/mo</span>}
            </p>
            <ul className="space-y-2">
              {plan.features.map((f) => (
                <li key={f} className={`text-sm flex items-center gap-2 ${
                  theme === "dark" ? "text-white/60" : "text-gray-600"
                }`}>
                  <Sparkles size={12} className="text-cyan-400 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            {!plan.current && (
              <button className={`w-full mt-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                theme === "dark"
                  ? "bg-white/10 text-white hover:bg-white/15"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}>
                {plan.price === "Custom" ? "Contact Sales" : "Upgrade"}
              </button>
            )}
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

function AppearanceSettings() {
  const { theme, toggleTheme } = useTheme();
  return (
    <SettingsCard title="Appearance" description="Customize the look and feel">
      <div className="flex gap-4">
        <button
          onClick={() => theme !== "dark" && toggleTheme()}
          className={`flex-1 p-4 rounded-xl border-2 transition-colors ${
            theme === "dark"
              ? "border-cyan-400/50 bg-[#0a0a12]"
              : "border-transparent bg-gray-900"
          }`}
          data-testid="button-theme-dark"
        >
          <div className="h-20 rounded-lg bg-[#060610] border border-white/10 mb-3" />
          <p className="text-sm font-medium text-white">Dark</p>
        </button>
        <button
          onClick={() => theme !== "light" && toggleTheme()}
          className={`flex-1 p-4 rounded-xl border-2 transition-colors ${
            theme === "light"
              ? "border-cyan-400 bg-white"
              : "border-transparent bg-gray-100"
          }`}
          data-testid="button-theme-light"
        >
          <div className="h-20 rounded-lg bg-gray-50 border border-gray-200 mb-3" />
          <p className={`text-sm font-medium ${
            theme === "light" ? "text-gray-900" : "text-gray-700"
          }`}>Light</p>
        </button>
      </div>
    </SettingsCard>
  );
}

function ApiKeySettings() {
  const { theme } = useTheme();
  return (
    <SettingsCard title="API Keys" description="Manage your API access tokens">
      <div className={`flex items-center justify-between p-4 rounded-xl mb-4 ${
        theme === "dark"
          ? "bg-white/5 border border-white/10"
          : "bg-gray-50 border border-gray-200"
      }`}>
        <div>
          <p className={`text-sm font-medium ${
            theme === "dark" ? "text-white" : "text-gray-900"
          }`}>Production Key</p>
          <p className={`text-xs mt-0.5 font-mono ${
            theme === "dark" ? "text-white/40" : "text-gray-500"
          }`}>bc_live_••••••••••••••••</p>
        </div>
        <div className="flex gap-2">
          <button className={`p-2 rounded-lg transition-colors ${
            theme === "dark"
              ? "hover:bg-white/10 text-white/40"
              : "hover:bg-gray-200 text-gray-400"
          }`}><Copy size={14} /></button>
          <button className={`p-2 rounded-lg transition-colors ${
            theme === "dark"
              ? "hover:bg-red-500/10 text-red-400/60"
              : "hover:bg-red-50 text-red-400"
          }`}><Trash2 size={14} /></button>
        </div>
      </div>
      <button className="px-4 py-2.5 rounded-xl bg-cyan-400 text-black font-semibold text-sm hover:bg-cyan-300 transition-colors" data-testid="button-generate-key">
        Generate New Key
      </button>
    </SettingsCard>
  );
}

function SecuritySettings() {
  const { theme } = useTheme();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!form.current) throw new Error("Current password is required");
      if (form.next !== form.confirm) throw new Error("Passwords do not match");
      if (form.next.length < 6) throw new Error("New password must be at least 6 characters");
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update password");
      return data;
    },
    onSuccess: () => {
      setForm({ current: "", next: "", confirm: "" });
      setSaved(true);
      setError("");
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: any) => setError(err.message),
  });

  const pwField = (label: string, key: "current" | "next" | "confirm", testId: string) => (
    <div className="mb-4">
      <label className={`block text-sm font-medium mb-2 ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>{label}</label>
      <input
        type="password"
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${theme === "dark" ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50" : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"}`}
        data-testid={testId}
      />
    </div>
  );

  return (
    <>
      <SettingsCard title="Change Password" description="Update your account password">
        {pwField("Current Password", "current", "input-current-password")}
        {pwField("New Password", "next", "input-new-password")}
        {pwField("Confirm New Password", "confirm", "input-confirm-password")}
        {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-3">{error}</p>}
        <button
          onClick={() => { setError(""); save.mutate(); }}
          disabled={save.isPending}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 ${saved ? "bg-emerald-400 text-black" : "bg-cyan-400 text-black"}`}
          data-testid="button-update-password"
        >
          {saved ? <><Check size={15} /> Updated!</> : save.isPending ? "Updating..." : "Update Password"}
        </button>
      </SettingsCard>
      <SettingsCard title="Two-Factor Authentication" description="Add an extra layer of security">
        <button className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
          theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
        }`} data-testid="button-enable-2fa">
          Enable 2FA
        </button>
      </SettingsCard>
    </>
  );
}

function OnboardingWizard({ onComplete }: { onComplete: (destination?: string) => void }) {
  const { theme } = useTheme();
  const user = getAppUser();
  const firstName = (user?.username || "there").split(" ")[0];
  const [step, setStep] = useState(0);
  const [buildType, setBuildType] = useState("");
  const [startMethod, setStartMethod] = useState("");

  const buildOptions = [
    { id: "website", label: "Website", icon: Globe, desc: "Landing pages, portfolios, blogs", color: "from-cyan-500 to-blue-500" },
    { id: "app", label: "Web App", icon: Zap, desc: "SaaS, dashboards, tools", color: "from-purple-500 to-indigo-500" },
    { id: "game", label: "Game", icon: Gamepad2, desc: "Browser & casual games", color: "from-pink-500 to-rose-500" },
    { id: "saas", label: "SaaS", icon: Briefcase, desc: "Full-stack products", color: "from-amber-500 to-orange-500" },
  ];

  const startOptions = [
    { id: "template", label: "Browse Templates", icon: Layers, desc: "Start from a professionally built foundation", dest: "/app/templates" },
    { id: "blank", label: "Blank Canvas", icon: FileCode, desc: "Start fresh and build from scratch", dest: "/app" },
    { id: "ai", label: "Describe to AI", icon: Wand2, desc: "Tell the AI what you want and watch it build", dest: "/app/editor" },
  ];

  const totalSteps = 3;

  const goNext = () => {
    if (step < totalSteps - 1) setStep(s => s + 1);
    else {
      const chosen = startOptions.find(o => o.id === startMethod);
      onComplete(chosen?.dest);
    }
  };

  const canProceed = step === 0 || (step === 1 && buildType) || (step === 2 && startMethod);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className={`w-full max-w-lg mx-4 rounded-2xl border overflow-hidden shadow-2xl ${
            theme === "dark" ? "bg-[#0e0e1a] border-white/10" : "bg-white border-gray-200"
          }`}
          data-testid="onboarding-wizard"
        >
          <div className="h-1.5 bg-white/5">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #00c9b7, #6366f1, #ec4899)" }}
              animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>

          <div className="p-8">
            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }} className="text-center">
                  <div className="w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}>
                    <Sparkles size={36} className="text-white" />
                  </div>
                  <h2 className={`text-2xl font-display font-bold mb-3 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                    Welcome, {firstName}!
                  </h2>
                  <p className={`text-sm leading-relaxed max-w-sm mx-auto ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
                    You're about to experience the fastest way to build production-ready apps and websites. Let's get you set up in 30 seconds.
                  </p>
                </motion.div>
              )}

              {step === 1 && (
                <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                  <h2 className={`text-xl font-display font-bold mb-1 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>What do you want to build?</h2>
                  <p className={`text-sm mb-5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Pick the type of project you're most excited about.</p>
                  <div className="grid grid-cols-2 gap-3">
                    {buildOptions.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setBuildType(opt.id)}
                        className={`flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all ${
                          buildType === opt.id
                            ? theme === "dark"
                              ? "border-cyan-400/60 bg-cyan-500/10"
                              : "border-cyan-400 bg-cyan-50"
                            : theme === "dark"
                            ? "border-white/10 bg-white/[0.02] hover:bg-white/5"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                        data-testid={`option-build-${opt.id}`}
                      >
                        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${opt.color} flex items-center justify-center`}>
                          <opt.icon size={18} className="text-white" />
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{opt.label}</p>
                          <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{opt.desc}</p>
                        </div>
                        {buildType === opt.id && <Check size={14} className="absolute top-3 right-3 text-cyan-400" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                  <h2 className={`text-xl font-display font-bold mb-1 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>How do you want to start?</h2>
                  <p className={`text-sm mb-5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>You can always change this later.</p>
                  <div className="space-y-3">
                    {startOptions.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setStartMethod(opt.id)}
                        className={`flex items-center gap-4 w-full p-4 rounded-xl border text-left transition-all ${
                          startMethod === opt.id
                            ? theme === "dark"
                              ? "border-cyan-400/60 bg-cyan-500/10"
                              : "border-cyan-400 bg-cyan-50"
                            : theme === "dark"
                            ? "border-white/10 bg-white/[0.02] hover:bg-white/5"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                        data-testid={`option-start-${opt.id}`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          theme === "dark" ? "bg-white/10" : "bg-gray-100"
                        }`}>
                          <opt.icon size={20} className={startMethod === opt.id ? "text-cyan-400" : theme === "dark" ? "text-white/60" : "text-gray-500"} />
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{opt.label}</p>
                          <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{opt.desc}</p>
                        </div>
                        {startMethod === opt.id && <Check size={15} className="text-cyan-400 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between mt-8">
              <button
                onClick={() => onComplete()}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  theme === "dark" ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"
                }`}
                data-testid="button-skip-onboarding"
              >
                Skip for now
              </button>

              <div className="flex items-center gap-3">
                {step > 0 && (
                  <button
                    onClick={() => setStep(s => s - 1)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                      theme === "dark" ? "border-white/10 text-white/50 hover:text-white/80" : "border-gray-200 text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={goNext}
                  disabled={!canProceed}
                  className="px-6 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
                  data-testid="button-next-onboarding"
                >
                  {step === totalSteps - 1 ? "Let's Build!" : "Continue"}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function AppDashboardContent() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !!localStorage.getItem("bc_new_user");
  });
  const { theme } = useTheme();
  const [, navigate] = useLocation();

  const handleOnboardingComplete = (destination?: string) => {
    localStorage.removeItem("bc_new_user");
    localStorage.setItem("buildcustom_onboarded", "1");
    setShowOnboarding(false);
    if (destination && destination !== "/app") navigate(destination);
  };

  return (
    <div className={`flex h-screen overflow-hidden ${
      theme === "dark"
        ? "bg-[#060610]"
        : "bg-gray-50"
    }`}>
      {showOnboarding && <OnboardingWizard onComplete={handleOnboardingComplete} />}
      <AppSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <AppTopBar />
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/app" component={ProjectsPage} />
            <Route path="/app/templates" component={TemplatesPage} />
            <Route path="/app/editor" component={EditorPage} />
            <Route path="/app/editor/:id" component={EditorPage} />
            <Route path="/app/users" component={UsersPage} />
            <Route path="/app/analytics" component={AnalyticsPage} />
            <Route path="/app/billing" component={BillingPage} />
            <Route path="/app/support" component={SupportPage} />
            <Route path="/app/deployments" component={DeploymentsPage} />
            <Route path="/app/settings" component={SettingsPage} />
            <Route path="/app/project/:id" component={ProjectDetail} />
            <Route>{() => <ProjectsPage />}</Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}

export default function AppDashboard() {
  const appUser = getAppUser();
  const [, navigate] = useLocation();

  if (!appUser) {
    navigate("/app/login");
    return null;
  }

  return (
    <ThemeProvider>
      <AppDashboardContent />
    </ThemeProvider>
  );
}
