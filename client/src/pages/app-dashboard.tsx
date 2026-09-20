import { useEffect, useRef, useState } from "react";
import { Route, Switch, useLocation, Link, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAppUser, setAppUser, clearAppUser, authHeaders, isAdminUser, type AppUser } from "@/lib/auth";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutGrid,
  Code2,
  Settings,
  LogOut,
  Sun,
  Moon,
  Plus,
  ArrowUp,
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
  GripVertical,
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
  StopCircle,
  FileCode2,
  Mic,
  MousePointer2,
} from "lucide-react";
import logo from "@/assets/logo.png";
import logoMark from "@/assets/logo-mark.png";
import previewPortfolio from "@/assets/preview-portfolio.jpg";
import previewFitness from "@/assets/preview-fitness.jpg";
import previewGame from "@/assets/preview-game.jpg";
import previewEcommerce from "@/assets/preview-ecommerce.jpg";
import { ThemeProvider, useTheme } from "@/contexts/theme-context";
import { UsersPage, AnalyticsPage, BillingPage, SupportPage, DeploymentsPage } from "@/pages/app-admin-pages";
import ProjectDetail from "@/pages/project-detail";
import { getPlanEntitlement } from "@shared/plans";

function AppSidebar({ collapsed, onToggle, isAdmin }: { collapsed: boolean; onToggle: () => void; isAdmin: boolean }) {
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
    ...(isAdmin ? adminItems : []),
    { path: "/app/settings", icon: Settings, label: "Settings" },
  ];

  const isActive = (path: string) => {
    if (path === "/app") return location === "/app" || location === "/app/";
    return location.startsWith(path);
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 56 : 140 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={`h-screen relative z-[1000] flex flex-col overflow-visible border-r shrink-0 ${
        theme === "dark"
          ? "bg-[#0a0a12] border-white/10"
          : "bg-white border-gray-200"
      }`}
    >
      {collapsed ? (
        <>
          <div className={`h-16 w-14 flex items-center justify-center border-b ${
            theme === "dark" ? "border-white/10" : "border-gray-200"
          }`}>
            <button
              onClick={onToggle}
              className={`relative group p-2 rounded-lg transition-colors ${
                theme === "dark"
                  ? "text-white/55 hover:bg-white/10 hover:text-white"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              }`}
              aria-label="Expand navigation"
              data-testid="button-expand-sidebar"
            >
              <img src={logoMark} alt="" className="h-9 w-9 object-contain" />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute left-[calc(100%+18px)] top-1/2 z-[1010] -translate-y-1/2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium opacity-0 shadow-xl transition-opacity group-hover:opacity-100 ${
                  theme === "dark" ? "border-white/10 bg-[#0a0a12] text-white" : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                Expand navigation
              </span>
            </button>
          </div>
          <nav className="flex flex-1 flex-col justify-start gap-1 py-4 px-2">
            {navItems.map((item) => {
              const active = isActive(item.path);
              return (
                <Link key={item.path} href={item.path}>
                  <div
                    className={`relative group flex items-center justify-center px-2 py-2.5 rounded-xl cursor-pointer transition-colors ${
                      active
                        ? theme === "dark" ? "bg-white/10 text-purple-400" : "bg-cyan-50 text-purple-500"
                        : theme === "dark" ? "text-white/55 hover:bg-white/5 hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                    aria-label={item.label}
                    data-testid={`nav-collapsed-${item.label.toLowerCase()}`}
                  >
                    <item.icon size={20} />
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-[1010] -translate-y-1/2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium opacity-0 shadow-xl transition-opacity group-hover:opacity-100 ${
                        theme === "dark"
                          ? "border-white/10 bg-[#0a0a12] text-white"
                          : "border-gray-200 bg-white text-gray-700"
                      }`}
                    >
                      <span className={active ? "text-brand-gradient" : ""}>{item.label}</span>
                    </span>
                  </div>
                </Link>
              );
            })}
          </nav>
          <div className={`px-2 py-4 border-t space-y-2 ${
            theme === "dark" ? "border-white/10" : "border-gray-200"
          }`}>
            <button
              onClick={toggleTheme}
              className={`relative group flex items-center justify-center w-full px-2 py-2.5 rounded-xl transition-colors ${
                theme === "dark" ? "text-purple-400 hover:bg-white/5" : "text-purple-500 hover:bg-gray-100"
              }`}
              aria-label={theme === "dark" ? "Light Mode" : "Dark Mode"}
            >
              {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-[1010] -translate-y-1/2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium opacity-0 shadow-xl transition-opacity group-hover:opacity-100 ${
                  theme === "dark" ? "border-white/10 bg-[#0a0a12]" : "border-gray-200 bg-white"
                }`}
              >
                <span className="text-brand-gradient">{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
              </span>
            </button>
            <button
              onClick={() => { clearAppUser(); window.location.href = "/app/login"; }}
              className={`relative group flex items-center justify-center w-full px-2 py-2.5 rounded-xl transition-colors ${
                theme === "dark" ? "text-white/55 hover:text-red-400 hover:bg-red-500/10" : "text-gray-500 hover:text-red-600 hover:bg-red-50"
              }`}
              aria-label="Log Out"
            >
              <LogOut size={20} />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-[1010] -translate-y-1/2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium opacity-0 shadow-xl transition-opacity group-hover:opacity-100 ${
                  theme === "dark" ? "border-white/10 bg-[#0a0a12] text-white" : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                Log Out
              </span>
            </button>
          </div>
        </>
      ) : (
        <>
      <div className={`flex items-center h-16 px-2 border-b ${
        theme === "dark" ? "border-white/10" : "border-gray-200"
      }`}>
        <Link href="/app">
          <div className="flex items-center gap-3 cursor-pointer">
            <img src={logo} alt="BuildCustom.Ai" className="h-6 w-[88px] object-contain object-left" />
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
          <PanelLeftClose size={18} />
        </button>
      </div>

      <nav className="flex flex-1 flex-col justify-start gap-1 py-4 px-2 overflow-y-auto">
        {navItems.map((item, idx) => {
          const active = isActive(item.path);
          return (
            <div key={item.path}>
              <Link href={item.path}>
                <div
                  className={`flex items-center gap-2 px-2 py-2.5 rounded-xl cursor-pointer transition-all duration-200 group ${
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
                  <span className={`font-medium text-sm ${active ? "text-brand-gradient" : ""}`}>{item.label}</span>
                  {active && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-purple-500" />
                  )}
                </div>
              </Link>
            </div>
          );
        })}
      </nav>

      <div className={`px-2 py-4 border-t space-y-2 ${
        theme === "dark" ? "border-white/10" : "border-gray-200"
      }`}>
        <button
          onClick={toggleTheme}
          className={`flex items-center gap-2 w-full px-2 py-2.5 rounded-xl transition-colors ${
            theme === "dark"
              ? "text-white/60 hover:text-white hover:bg-white/5"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          }`}
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? <Sun size={20} className="text-purple-400" /> : <Moon size={20} className="text-purple-400" />}
          <span className="font-medium text-sm text-brand-gradient">
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </span>
        </button>
        <button
          onClick={() => { clearAppUser(); window.location.href = "/app/login"; }}
          className={`flex items-center gap-2 w-full px-2 py-2.5 rounded-xl transition-colors ${
            theme === "dark"
              ? "text-white/60 hover:text-red-400 hover:bg-red-500/10"
              : "text-gray-600 hover:text-red-600 hover:bg-red-50"
          }`}
          data-testid="button-logout"
        >
          <LogOut size={20} />
          <span className="font-medium text-sm">Log Out</span>
        </button>
      </div>
        </>
      )}
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

function ProjectsPage() {
  const { theme } = useTheme();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [starterPrompt, setStarterPrompt] = useState("");
  const [starterPlanMode, setStarterPlanMode] = useState(false);
  const [starterError, setStarterError] = useState("");
  const starterInputRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    },
  });

  const starterSuggestions = [
    { label: "Website", icon: Globe, prompt: "Build a modern website for " },
    { label: "Mobile app", icon: Smartphone, prompt: "Create a mobile app that helps people " },
    { label: "SaaS", icon: ShoppingBag, prompt: "Build a SaaS platform for " },
    { label: "Game", icon: Gamepad2, prompt: "Create a fun browser game where " },
    { label: "Dashboard", icon: BarChart3, prompt: "Build a dashboard that tracks " },
    { label: "Marketplace", icon: Store, prompt: "Create a marketplace for " },
  ];
  const promptCompletions = [
    "Build a modern website for a local service business with online booking",
    "Build a modern website for a personal brand with a portfolio and contact form",
    "Create a mobile app that helps people plan meals and build grocery lists",
    "Create a mobile app that helps people track habits and stay accountable",
    "Build a SaaS platform for managing client projects, invoices, and approvals",
    "Build a SaaS platform for creating and scheduling social media content",
    "Create a fun browser game where players solve daily word puzzles",
    "Create a fun browser game where players run and grow a virtual business",
    "Build a dashboard that tracks sales, customers, and monthly revenue",
    "Build a dashboard that tracks marketing campaigns and conversion rates",
    "Create a marketplace for local creators to sell handmade products",
    "Create a marketplace for booking trusted home service professionals",
  ];
  const completion = starterPrompt
    ? promptCompletions.find((item) => item.toLowerCase().startsWith(starterPrompt.toLowerCase()) && item.length > starterPrompt.length)
    : undefined;
  const completionSuffix = completion?.slice(starterPrompt.length) || "";

  const createProject = useMutation({
    mutationFn: async ({ prompt, plan }: { prompt: string; plan: boolean }) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ type: "website", description: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create project");
      return { project: data, prompt, plan };
    },
    onSuccess: ({ project, prompt, plan }) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      sessionStorage.setItem(`buildcustom:first-prompt:${project.id}`, JSON.stringify({ prompt, plan }));
      navigate(`/app/editor/${project.id}`);
    },
    onError: (error: Error) => setStarterError(error.message),
  });
  const startProject = () => {
    const prompt = starterPrompt.trim();
    if (!prompt) {
      starterInputRef.current?.focus();
      return;
    }
    setStarterError("");
    createProject.mutate({ prompt, plan: starterPlanMode });
  };
  const recentProjects = [...projects]
    .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6);
  const firstName = getAppUser()?.username?.trim()?.split(/\s+/)[0] || "there";

  return (
    <div className={`relative min-h-[calc(100vh-64px)] overflow-hidden px-6 py-8 lg:px-10 ${theme === "dark" ? "bg-[#070711]" : "bg-[#f7f8fc]"}`}>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] opacity-70" style={{ background: theme === "dark" ? "radial-gradient(ellipse at 50% 100%, rgba(236,72,153,.13), transparent 60%), radial-gradient(ellipse at 20% 100%, rgba(0,201,183,.10), transparent 50%)" : "radial-gradient(ellipse at 50% 100%, rgba(99,102,241,.10), transparent 60%)" }} />
      <div className="relative mx-auto flex min-h-[calc(100vh-128px)] max-w-5xl flex-col">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className={`text-xs font-semibold uppercase tracking-[0.16em] ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Recent projects</h2>
            {projects.length > 6 && <span className={`text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>Showing 6 of {projects.length}</span>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {isLoading ? [1, 2, 3].map((item) => <div key={item} className={`h-[82px] animate-pulse rounded-2xl border ${theme === "dark" ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`} />) : recentProjects.map((project: any) => {
              const IconComponent = PROJECT_TYPE_ICONS[project.type] || Globe;
              const ageDays = Math.max(0, Math.floor((Date.now() - new Date(project.updatedAt).getTime()) / 86400000));
              return (
                <button key={project.id} onClick={() => navigate(`/app/project/${project.id}`)} className={`group flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition-all ${theme === "dark" ? "border-white/10 bg-white/[0.035] hover:border-cyan-400/30 hover:bg-white/[0.065]" : "border-gray-200 bg-white hover:border-cyan-300 hover:shadow-md"}`}>
                  <div className={`h-14 w-16 shrink-0 overflow-hidden rounded-xl ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`}>
                    <img src={project.previewImageUrl || PREVIEW_IMAGES[project.type] || previewPortfolio} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  </div>
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${theme === "dark" ? "text-white/85" : "text-gray-900"}`}>{project.name}</p>
                    <p className={`mt-1 flex items-center gap-1.5 text-[11px] ${theme === "dark" ? "text-white/35" : "text-gray-500"}`}><IconComponent size={11} /><span className="capitalize">{project.type}</span><span>·</span><span>{ageDays === 0 ? "today" : `${ageDays}d ago`}</span></p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mx-auto mt-auto w-full max-w-3xl pb-[6vh] pt-16">
          <div className="mb-6 text-center">
            <video
              poster={logoMark}
              aria-label="BuildCustom.Ai animated cube"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              className="mb-3 inline-block h-14 w-14 object-contain drop-shadow-[0_10px_18px_rgba(99,102,241,0.28)]"
            >
              <source src="/spinning-cube-logo.webm" type="video/webm" />
            </video>
            <h1 className={`font-display text-3xl font-bold tracking-tight sm:text-4xl ${theme === "dark" ? "text-white" : "text-gray-950"}`}>{firstName}, what are we building today?</h1>
            <p className={`mt-2 text-sm ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Choose a starting point or describe your idea in your own words.</p>
          </div>

          <div className="mb-3 flex flex-wrap justify-center gap-2">
            {starterSuggestions.map((suggestion) => (
              <button key={suggestion.label} onClick={() => { setStarterPrompt(suggestion.prompt); starterInputRef.current?.focus(); }} className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium transition-all ${theme === "dark" ? "border-white/10 bg-white/5 text-white/60 hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-white" : "border-gray-200 bg-white text-gray-600 hover:border-cyan-300 hover:text-gray-900"}`}>
                <suggestion.icon size={13} className="text-cyan-400" />{suggestion.label}
              </button>
            ))}
          </div>

          <div className={`overflow-hidden rounded-2xl border shadow-2xl ${theme === "dark" ? "border-white/10 bg-[#11111d] shadow-black/30 focus-within:border-cyan-400/30" : "border-gray-200 bg-white shadow-indigo-100/60 focus-within:border-cyan-400"}`}>
            <div className="relative min-h-[60px]">
              {completionSuffix && (
                <div aria-hidden="true" className={`pointer-events-none absolute inset-0 whitespace-pre-wrap px-5 py-3.5 text-base leading-7 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                  <span className="invisible">{starterPrompt}</span><span className={theme === "dark" ? "text-white/25" : "text-gray-300"}>{completionSuffix}</span>
                </div>
              )}
              <textarea
                ref={starterInputRef}
                value={starterPrompt}
                onChange={(event) => setStarterPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Tab" && completion) {
                    event.preventDefault();
                    setStarterPrompt(completion);
                  } else if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    startProject();
                  }
                }}
                placeholder="Describe what you want to build..."
                rows={1}
                className={`relative z-10 block min-h-[60px] w-full resize-none bg-transparent px-5 py-3.5 pr-28 text-base leading-7 outline-none ${theme === "dark" ? "text-white placeholder:text-white/25" : "text-gray-900 placeholder:text-gray-400"}`}
                data-testid="input-new-project-prompt"
              />
              {completionSuffix && <span className={`absolute bottom-2 right-4 z-20 rounded-md px-2 py-1 text-[10px] font-medium ${theme === "dark" ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"}`}>Tab to complete</span>}
            </div>
            <div className={`flex items-center justify-between border-t px-3 py-2.5 ${theme === "dark" ? "border-white/10" : "border-gray-100"}`}>
              <button onClick={() => setStarterPlanMode((current) => !current)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${starterPlanMode ? "border-purple-400/50 bg-purple-400/15 text-purple-300" : theme === "dark" ? "border-white/10 text-white/45 hover:text-white/70" : "border-gray-200 text-gray-500 hover:text-gray-800"}`} aria-pressed={starterPlanMode} data-testid="button-new-project-plan">
                <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${starterPlanMode ? "border-purple-400 bg-purple-400 text-white" : theme === "dark" ? "border-white/30" : "border-gray-300"}`}>{starterPlanMode && <Check size={10} />}</span>
                Plan first
              </button>
              <button onClick={startProject} disabled={!starterPrompt.trim() || createProject.isPending} className="flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 via-indigo-500 to-pink-500 px-4 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-30" data-testid="button-start-project">
                {createProject.isPending ? "Starting…" : starterPlanMode ? "Start planning" : "Start building"} <ArrowUp size={14} />
              </button>
            </div>
          </div>
          {starterError && <p className="mt-3 text-center text-xs text-red-400">{starterError}</p>}
          <p className={`mt-3 text-center text-[11px] ${theme === "dark" ? "text-white/25" : "text-gray-400"}`}>Press Enter to start · Shift + Enter for a new line</p>
        </section>
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

type RuntimeFile = { path: string; name?: string; size?: number; type?: string };
type RuntimeRelease = { id: number; commitHash: string; deploymentUrl: string; createdAt: string };
type RuntimeBuilderTurn = {
  id: number;
  mode: "plan" | "build";
  prompt: string;
  response: string;
  changedFiles: Array<{ path: string; change: string; size: number }>;
  activity: Array<{ type: string; label: string; path?: string; status?: string; createdAt: string }>;
  commitHash: string | null;
  createdAt: string;
};
type ComposerImage = {
  id: string;
  filename: string;
  mimeType: string;
  base64Data: string;
  size: number;
};
type SelectedElement = Record<string, unknown>;

function BuildActivity({
  projectId,
  theme,
  isBuilding,
}: {
  projectId: number;
  theme: string;
  isBuilding: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const statusQuery = useQuery({
    queryKey: ["runtime-status", projectId],
    enabled: !!projectId,
    refetchInterval: isBuilding ? 750 : 8000,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/status`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Runtime status unavailable.");
      return body;
    },
  });
  const filesQuery = useQuery({
    queryKey: ["runtime-files", projectId],
    enabled: !!projectId,
    refetchInterval: isBuilding ? 1500 : 10000,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runtime/files`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Workspace files unavailable.");
      return body.files as RuntimeFile[];
    },
  });
  const state = statusQuery.data?.state || {};
  const generation = state.generation || {};
  const generationStatus = generation.status || (isBuilding ? "running" : "idle");
  const files = filesQuery.data || [];
  const latestTool = state.lastConversationResponse?.tool;
  const activePath = state.currentFile || latestTool?.args?.path;
  const summary = statusQuery.isError
    ? "Runtime activity is unavailable"
    : isBuilding
      ? activePath
        ? `${latestTool?.status === "success" ? "Updated" : "Writing"} ${activePath}`
        : `${files.length || statusQuery.data?.files || 0} files · Planning changes`
      : `${files.length || statusQuery.data?.files || 0} files · ${generationStatus}`;

  useEffect(() => {
    if (!isBuilding) return;
    setOpen(true);
    const response = state.lastConversationResponse;
    const tool = response?.tool;
    const next = activePath
      ? `${tool?.status === "success" ? "Updated" : "Working on"} ${activePath}`
      : typeof response?.message === "string" && response.message.trim()
        ? response.message.trim()
        : summary;
    if (!next) return;
    setSteps((current) => current[current.length - 1] === next ? current : [...current.slice(-9), next]);
  }, [isBuilding, activePath, state.lastConversationResponse, summary]);

  const showFile = async (path: string) => {
    if (openFile === path) {
      setOpenFile(null);
      return;
    }
    setOpenFile(path);
    setLoadingFile(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      setFileContent(res.ok ? body.content : "Unable to read this file.");
    } catch {
      setFileContent("Unable to read this file.");
    } finally {
      setLoadingFile(false);
    }
  };

  useEffect(() => {
    if (!isBuilding || !activePath || openFile === activePath) return;
    setOpenFile(activePath);
    setLoadingFile(true);
    fetch(`/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(activePath)}`, { headers: authHeaders() })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        setFileContent(res.ok ? body.content : "The Agent is preparing this file.");
      })
      .catch(() => setFileContent("The Agent is preparing this file."))
      .finally(() => setLoadingFile(false));
  }, [isBuilding, activePath, projectId]);

  return (
    <div className={`rounded-xl border overflow-hidden ${theme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-gray-200 bg-gray-50"}`}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        data-testid="button-toggle-build-activity"
      >
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isBuilding ? "bg-cyan-400/15 text-cyan-300" : "bg-emerald-400/15 text-emerald-300"}`}>
          {isBuilding ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-xs font-semibold ${theme === "dark" ? "text-white/85" : "text-gray-800"}`}>Build activity</div>
          <div className={`text-[11px] truncate ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{summary}</div>
        </div>
        <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""} ${theme === "dark" ? "text-white/40" : "text-gray-400"}`} />
      </button>
      {open && (
        <div className={`px-3 pb-3 border-t ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
          <div className={`grid grid-cols-2 gap-2 py-3 text-[11px] ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
            <span>Generation <b className={theme === "dark" ? "text-white/80" : "text-gray-800"}>{generationStatus}</b></span>
            <span>Connection <b className={theme === "dark" ? "text-white/80" : "text-gray-800"}>{statusQuery.data?.connected ? "connected" : "not connected"}</b></span>
          </div>
          {steps.length > 0 && (
            <div className={`mb-3 space-y-1 border-l-2 pl-3 ${theme === "dark" ? "border-cyan-400/30" : "border-cyan-300"}`}>
              {steps.map((step, index) => (
                <div key={`${index}-${step}`} className={`text-[11px] leading-relaxed ${
                  index === steps.length - 1
                    ? theme === "dark" ? "text-cyan-200" : "text-cyan-700"
                    : theme === "dark" ? "text-white/40" : "text-gray-500"
                }`}>
                  {step}
                </div>
              ))}
            </div>
          )}
          {isBuilding && openFile && (
            <div className="mb-3">
              <div className={`mb-1 truncate font-mono text-[10px] ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>{openFile}</div>
              <pre className={`max-h-48 overflow-auto rounded-lg p-2 text-[10px] leading-relaxed ${theme === "dark" ? "bg-black/40 text-cyan-100/70" : "border border-gray-100 bg-white text-gray-600"}`}>
                {loadingFile ? "Loading current code…" : fileContent}
              </pre>
            </div>
          )}
          {files.length > 0 ? (
            <div className="space-y-1">
              {files.map((file) => (
                <div key={file.path}>
                  <button onClick={() => showFile(file.path)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${theme === "dark" ? "text-white/65 hover:bg-white/5" : "text-gray-600 hover:bg-white"}`} data-testid={`button-file-${file.path}`}>
                    <FileCode2 size={13} className="text-cyan-400 shrink-0" />
                    <span className="truncate flex-1 font-mono">{file.path}</span>
                    <span className="text-[10px] opacity-40">{file.size ? `${Math.ceil(file.size / 1024)}kb` : ""}</span>
                  </button>
                  {openFile === file.path && (
                    <pre className={`mt-1 max-h-40 overflow-auto rounded-lg p-2 text-[10px] leading-relaxed ${theme === "dark" ? "bg-black/30 text-white/55" : "bg-white text-gray-500 border border-gray-100"}`}>
                      {loadingFile ? "Loading file…" : fileContent}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={`text-[11px] py-2 ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>Files will appear here as the Agent writes them.</div>
          )}
        </div>
      )}
    </div>
  );
}

function EditorPage() {
  const { theme } = useTheme();
  const planEntitlement = getPlanEntitlement(getAppUser()?.plan);
  const [, routeParams] = useRoute("/app/editor/:id");
  const projectId = Number(routeParams?.id || 0);
  const [chatInput, setChatInput] = useState("");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [turns, setTurns] = useState<RuntimeBuilderTurn[]>([]);
  const [restoringTurnId, setRestoringTurnId] = useState<number | null>(null);
  const [openTurnFile, setOpenTurnFile] = useState<string | null>(null);
  const [turnFileContent, setTurnFileContent] = useState("");
  const [loadingTurnFile, setLoadingTurnFile] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [productionUrl, setProductionUrl] = useState("");
  const [previewEnvironment, setPreviewEnvironment] = useState<"development" | "production">("development");
  const [publishing, setPublishing] = useState(false);
  const [publishDrawerOpen, setPublishDrawerOpen] = useState(false);
  const [subdomainSlug, setSubdomainSlug] = useState("");
  const [customDomainOpen, setCustomDomainOpen] = useState(false);
  const [hostingProvider, setHostingProvider] = useState("buildcustom");
  const [customDomain, setCustomDomain] = useState("");
  const [customOrigin, setCustomOrigin] = useState("");
  const [savingPublishSettings, setSavingPublishSettings] = useState(false);
  const [publishSettingsMessage, setPublishSettingsMessage] = useState("");
  const [previewPath, setPreviewPath] = useState("/");
  const [addressDraft, setAddressDraft] = useState("dev/");
  const [publishFlow, setPublishFlow] = useState<{
    status: "idle" | "approval" | "preparing" | "deploying" | "complete" | "failed";
    message: string;
  }>({ status: "idle", message: "" });
  const [refreshingPreview, setRefreshingPreview] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [releases, setReleases] = useState<RuntimeRelease[]>([]);
  const [restoreCandidate, setRestoreCandidate] = useState<RuntimeRelease | null>(null);
  const [restoringRelease, setRestoringRelease] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [sending, setSending] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatWidth, setChatWidth] = useState(420);
  const [resizingChat, setResizingChat] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [pendingPlan, setPendingPlan] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [attachments, setAttachments] = useState<ComposerImage[]>([]);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [textContext, setTextContext] = useState<{ id: string; filename: string; content: string }[]>([]);
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);
  const [selectorEnabled, setSelectorEnabled] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const receiveElement = (event: MessageEvent) => {
      if (event.source !== previewFrameRef.current?.contentWindow || event.data?.type !== "buildcustom:element-selected") return;
      if (event.data.element && typeof event.data.element === "object") setSelectedElement(event.data.element);
    };
    window.addEventListener("message", receiveElement);
    return () => window.removeEventListener("message", receiveElement);
  }, []);

  useEffect(() => {
    const frame = previewFrameRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({ type: "buildcustom:selector", enabled: selectorEnabled }, "*");
    }
  }, [selectorEnabled, previewUrl]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 220);
    textarea.style.height = `${Math.max(nextHeight, 40)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 220 ? "auto" : "hidden";
  }, [chatInput]);

  const toggleSelector = () => {
    const enabled = !selectorEnabled;
    setSelectorEnabled(enabled);
    previewFrameRef.current?.contentWindow?.postMessage({ type: "buildcustom:selector", enabled }, "*");
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("Voice input is not supported in this browser.");
      return;
    }
    setVoiceError("");
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0]?.transcript || "")
        .join(" ");
      setChatInput((current) => `${current}${current ? " " : ""}${transcript}`.trim());
    };
    recognition.onerror = (event: any) => {
      setVoiceError(event.error === "not-allowed" ? "Microphone access was blocked." : "Voice input could not be captured.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  };

  const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });

  const addAttachmentFiles = async (selected: File[]) => {
    if (selected.length > 4) {
      setVoiceError("Attach no more than 4 files at a time.");
      return;
    }
    const imageFiles = selected.filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
    const textFiles = selected.filter((file) => !imageFiles.includes(file) && (
      file.type.startsWith("text/") || /\.(tsx?|jsx?|css|scss|html|json|md|py|sql|yaml|yml|sh|xml)$/i.test(file.name)
    ));
    if (imageFiles.some((file) => file.size > 4_000_000)) {
      setVoiceError("Images must be 4 MB or less.");
      return;
    }
    const incomingIds = new Set(imageFiles.map((file) => `${file.name}-${file.lastModified}-${file.size}`));
    const retainedImages = attachments.filter((item) => !incomingIds.has(item.id));
    if (retainedImages.length + imageFiles.length > 4) {
      setVoiceError("Attach no more than 4 images at a time.");
      return;
    }
    if (retainedImages.reduce((total, file) => total + file.size, 0) + imageFiles.reduce((total, file) => total + file.size, 0) > 8_000_000) {
      setVoiceError("Image attachments must be 8 MB or less in total.");
      return;
    }
    try {
      const images = await Promise.all(imageFiles.map(async (file) => ({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        filename: file.name,
        mimeType: file.type,
        base64Data: await readFileAsBase64(file),
        size: file.size,
      })));
      const contexts = await Promise.all(textFiles.map(async (file) => ({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        filename: file.name,
        content: (await file.text()).slice(0, 12000),
      })));
      setAttachments((current) => [...current.filter((item) => !images.some((next) => next.id === item.id)), ...images]);
      setTextContext((current) => [...current.filter((item) => !contexts.some((next) => next.id === item.id)), ...contexts]);
      if (selected.some((file) => !imageFiles.includes(file) && !textFiles.includes(file))) {
        setVoiceError("Some files were skipped. Attach PNG, JPEG, WebP, or text/code files.");
      } else {
        setVoiceError("");
      }
    } catch (error: any) {
      setVoiceError(error.message || "Could not read the attachment.");
    }
  };
  const handleAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    await addAttachmentFiles(selected);
  };
  const handleAttachmentDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingAttachment(false);
    const dropped = Array.from(event.dataTransfer.files || []);
    if (dropped.length) await addAttachmentFiles(dropped);
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
    setPreviewAttachmentId((current) => current === id ? null : current);
  };
  const removeTextContext = (id: string) => setTextContext((current) => current.filter((item) => item.id !== id));
  const previewAttachment = attachments.find((item) => item.id === previewAttachmentId) || null;

  useEffect(() => {
    if (!previewAttachment) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewAttachmentId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewAttachment]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const loadRuntime = async () => {
      try {
        const statusResponse = await fetch(`/api/projects/${projectId}/runtime/status`, { headers: authHeaders() });
        const status = await statusResponse.json().catch(() => ({}));
        if (cancelled || !statusResponse.ok) return;
        if (status.deploymentUrl) setProductionUrl(status.deploymentUrl);
        const previewResponse = await fetch(`/api/projects/${projectId}/runtime/previews`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({}),
        });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!cancelled && previewResponse.ok) {
          setPreviewUrl(preview.url || preview.previewUrl || "");
          setPreviewRevision((revision) => revision + 1);
        }
      } catch {
        // The user can retry with the preview refresh control.
      }
    };
    loadRuntime();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/runtime/publishing-settings`, { headers: authHeaders() })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          setSubdomainSlug(data.subdomainSlug || "");
          setHostingProvider(data.hostingProvider || "buildcustom");
          setCustomDomain(data.customDomain || "");
          setCustomOrigin(data.customOrigin || "");
          setCustomDomainOpen(Boolean(data.customDomain || data.customOrigin || data.hostingProvider === "custom"));
        }
      })
      .catch(() => undefined);
  }, [projectId]);

  const loadReleases = async () => {
    if (!projectId) return;
    const response = await fetch(`/api/projects/${projectId}/runtime/releases`, { headers: authHeaders() });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setReleases(data.releases || []);
  };

  useEffect(() => {
    loadReleases().catch(() => undefined);
  }, [projectId]);

  const loadTurns = async () => {
    if (!projectId) return;
    const response = await fetch(`/api/projects/${projectId}/runtime/turns`, { headers: authHeaders() });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setTurns(data.turns || []);
  };

  useEffect(() => {
    setMessages([]);
    loadTurns().catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    if (!publishing || !projectId) return;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/runtime/status`, { headers: authHeaders() });
        const data = await response.json().catch(() => ({}));
        const cloudflare = data.state?.cloudflare;
        if (cloudflare?.status === "running") {
          setPublishFlow({
            status: "deploying",
            message: "Cloudflare is uploading and activating the production Worker.",
          });
        } else if (cloudflare?.status === "failed") {
          setPublishFlow({ status: "failed", message: cloudflare.error || "Production deployment failed." });
        }
      } catch {
        // The publish request remains authoritative; a transient status poll may safely retry.
      }
    }, 1000);
    return () => window.clearInterval(poll);
  }, [publishing, projectId]);

  const handleSend = async (promptOverride?: string, planOverride?: boolean) => {
    const prompt = (promptOverride ?? chatInput).trim();
    const activePlanMode = planOverride ?? planMode;
    if (!prompt) return;
    if (!projectId) {
      setRuntimeError("Open Builder from a runtime-backed project to start an Agent session.");
      return;
    }
    setMessages((prev) => [
      ...prev,
      { role: "user" as const, content: prompt },
    ]);
    setChatInput("");
    setSending(true);
    setRuntimeError("");
    const controller = new AbortController();
    requestController.current = controller;
    setMessages((prev) => [
      ...prev,
      { role: "assistant" as const, content: activePlanMode ? "Agent is preparing a plan…" : "Agent is working on your request…" },
    ]);
    const imageContext = attachments.length
      ? `\n\nAttached images: ${attachments.map((image) => `${image.filename} (${image.mimeType}, ${image.size} bytes)`).join(", ")}`
      : "";
    const selectedContext = selectedElement
      ? `\n\nSelected element from the preview:\n${JSON.stringify(selectedElement).slice(0, 6000)}`
      : "";
    const textFileContext = textContext.length
      ? `\n\nAttached file context:\n${textContext.map((file) => `--- ${file.filename} ---\n${file.content}`).join("\n").slice(0, 30000)}`
      : "";
    const approvedPlanContext = !activePlanMode && pendingPlan
      ? `\n\nApproved implementation plan from Plan mode:\n${pendingPlan}\n\nFollow this approved plan while applying the user's request.`
      : "";
    const agentPrompt = `${prompt}${imageContext}${selectedContext}${textFileContext}${approvedPlanContext}`;
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message: agentPrompt, displayMessage: prompt, images: attachments, mode: activePlanMode ? "plan" : "build" }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Agent could not process the request.");
      }
      if (data.turn) setTurns((current) => [...current, data.turn]);
      setMessages([]);
      if (activePlanMode) {
        setPendingPlan(data.message || "");
        setPlanMode(false);
      } else {
        setPendingPlan("");
      }
      setAttachments([]);
      setTextContext([]);
      setSelectedElement(null);
      if (activePlanMode) return;
      const preview = await fetch(`/api/projects/${projectId}/runtime/previews`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({}),
      });
      const previewData = await preview.json().catch(() => ({}));
      if (preview.ok && previewData.url) setPreviewUrl(previewData.url);
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: "Build stopped. Your workspace is unchanged from the last completed step." },
        ]);
        return;
      }
      const message = error.message || "The Agent could not complete the request.";
      setRuntimeError(message);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: message },
      ]);
    } finally {
      requestController.current = null;
      setSending(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    const key = `buildcustom:first-prompt:${projectId}`;
    const stored = sessionStorage.getItem(key);
    if (!stored) return;
    sessionStorage.removeItem(key);
    try {
      const starter = JSON.parse(stored);
      if (typeof starter?.prompt === "string" && starter.prompt.trim()) {
        void handleSend(starter.prompt, Boolean(starter.plan));
      }
    } catch {
      // Leave the Builder ready for manual input if the handoff is malformed.
    }
  }, [projectId]);

  const restoreBuilderTurn = async (turn: RuntimeBuilderTurn) => {
    if (!projectId || !turn.commitHash || restoringTurnId !== null) return;
    if (!window.confirm("Restore this checkpoint to Development? Your live Production app will not change.")) return;
    const commitHash = turn.commitHash;
    setRestoringTurnId(turn.id);
    setRuntimeError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/turns/${turn.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The checkpoint could not be restored.");
      setPreviewUrl(data.previewUrl || "");
      setPreviewEnvironment("development");
      setPreviewRevision((revision) => revision + 1);
      setMessages((current) => [...current, {
        role: "assistant",
        content: `Checkpoint ${commitHash.slice(0, 8)} was restored to Development. Production is unchanged.`,
      }]);
    } catch (error: any) {
      setRuntimeError(error.message || "The checkpoint could not be restored.");
    } finally {
      setRestoringTurnId(null);
    }
  };

  const showTurnFile = async (turnId: number, path: string) => {
    const key = `${turnId}:${path}`;
    if (openTurnFile === key) {
      setOpenTurnFile(null);
      return;
    }
    setOpenTurnFile(key);
    setLoadingTurnFile(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      setTurnFileContent(response.ok ? data.content : "Unable to load this file.");
    } catch {
      setTurnFileContent("Unable to load this file.");
    } finally {
      setLoadingTurnFile(false);
    }
  };

  const stopBuild = async () => {
    if (projectId) {
      await fetch(`/api/projects/${projectId}/runtime/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      }).catch(() => undefined);
    }
    requestController.current?.abort();
    setSending(false);
  };

  const requestPublishApproval = () => {
    if (!projectId || publishing || !previewUrl) return;
    setPublishDrawerOpen(true);
    if (hostingProvider === "custom") {
      setPublishFlow({
        status: "failed",
        message: "External hosting is selected. Deploy through that provider, then point the custom domain CNAME record shown above to its origin hostname.",
      });
      return;
    }
    setPublishFlow({
      status: "approval",
      message: "Publishing updates the live app and cannot be reversed in place. Every publish is saved as a release point that can be restored to Development and published again.",
    });
  };

  const savePublishingSettings = async () => {
    if (!projectId || savingPublishSettings) return;
    setSavingPublishSettings(true);
    setPublishSettingsMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/publishing-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          subdomainSlug,
          hostingProvider,
          customDomain: customDomainOpen ? customDomain : "",
          customOrigin: customDomainOpen && hostingProvider === "custom" ? customOrigin : "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Publishing settings could not be saved.");
      setSubdomainSlug(data.subdomainSlug || "");
      setCustomDomain(data.customDomain || "");
      setCustomOrigin(data.customOrigin || "");
      setPublishSettingsMessage("Publishing settings saved.");
    } catch (error: any) {
      setPublishSettingsMessage(error.message || "Publishing settings could not be saved.");
    } finally {
      setSavingPublishSettings(false);
    }
  };

  const publishProject = async () => {
    if (!projectId || publishing) return;
    setPublishing(true);
    setRuntimeError("");
    setPublishFlow({
      status: "preparing",
      message: "Connecting to the runtime and preparing the production deployment.",
    });
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/deployments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The project could not be published.");
      setProductionUrl(data.url || "");
      setPreviewEnvironment("production");
      setPreviewRevision((revision) => revision + 1);
      setPublishFlow({
        status: "complete",
        message: "Production is live. The embedded Production preview has been updated.",
      });
      await loadReleases();
    } catch (error: any) {
      const message = error.message || "The project could not be published.";
      setRuntimeError(message);
      setPublishFlow({ status: "failed", message });
    } finally {
      setPublishing(false);
    }
  };

  const restoreReleaseToDevelopment = async () => {
    if (!projectId || !restoreCandidate || restoringRelease) return;
    setRestoringRelease(true);
    setRuntimeError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/releases/${restoreCandidate.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The release could not be restored.");
      setPreviewUrl(data.previewUrl || "");
      setPreviewEnvironment("development");
      setPreviewRevision((revision) => revision + 1);
      setRestoreCandidate(null);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `Release ${String(data.release?.commitHash || "").slice(0, 8)} was restored to Development. Production is unchanged until you publish again.`,
        },
      ]);
    } catch (error: any) {
      setRuntimeError(error.message || "The release could not be restored.");
    } finally {
      setRestoringRelease(false);
    }
  };

  const refreshActivePreview = async () => {
    if (!projectId || refreshingPreview) return;
    setRefreshingPreview(true);
    try {
      if (previewEnvironment === "production") {
        const response = await fetch(`/api/projects/${projectId}/runtime/status`, { headers: authHeaders() });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "The production URL could not be refreshed.");
        setProductionUrl(data.deploymentUrl || "");
      } else {
        const response = await fetch(`/api/projects/${projectId}/runtime/previews`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "The development preview could not be refreshed.");
        setPreviewUrl(data.url || data.previewUrl || "");
      }
      setPreviewRevision((revision) => revision + 1);
    } catch (error: any) {
      setRuntimeError(error.message || "The preview could not be refreshed.");
    } finally {
      setRefreshingPreview(false);
    }
  };

  const deviceWidths = { desktop: "100%", tablet: "768px", mobile: "390px" };
  const deviceButtons = [
    { id: "desktop" as const, icon: Monitor, label: "Desktop" },
    { id: "tablet" as const, icon: Tablet, label: "Tablet" },
    { id: "mobile" as const, icon: Smartphone, label: "Mobile" },
  ];
  const activePreviewUrl = previewEnvironment === "development" ? previewUrl : productionUrl;
  const managedCnameTarget = subdomainSlug ? `${subdomainSlug}.apps.buildcustom.ai` : "";
  const activePreviewSrc = (() => {
    if (!activePreviewUrl || previewEnvironment === "production" || previewPath === "/") return activePreviewUrl;
    try {
      const url = new URL(activePreviewUrl);
      url.pathname = `${url.pathname.replace(/\/$/, "")}${previewPath}`;
      return url.toString();
    } catch {
      return activePreviewUrl;
    }
  })();
  const navigatePreviewPath = () => {
    const raw = addressDraft.trim().replace(/^dev\/?/, "");
    const nextPath = raw ? `/${raw.replace(/^\/+/, "")}` : "/";
    setPreviewPath(nextPath);
    setAddressDraft(`dev${nextPath}`);
    setPreviewRevision((revision) => revision + 1);
  };

  const startChatResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (chatCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatWidth;
    let finalWidth = startWidth;
    setResizingChat(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      const maxWidth = Math.max(300, Math.min(760, window.innerWidth * 0.7));
      finalWidth = Math.min(maxWidth, Math.max(40, startWidth + moveEvent.clientX - startX));
      setChatWidth(finalWidth);
    };
    const onEnd = () => {
      if (finalWidth <= 72) {
        setChatCollapsed(true);
      } else if (finalWidth < 240) {
        setChatWidth(240);
      }
      setResizingChat(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <motion.aside
        initial={false}
        animate={{ width: chatCollapsed ? 40 : chatWidth }}
        transition={{ duration: resizingChat ? 0 : 0.2, ease: "easeInOut" }}
        className={`relative flex flex-col overflow-visible border-r shrink-0 ${
        theme === "dark"
          ? "bg-[#0a0a12] border-white/10"
          : "bg-white border-gray-200"
      }`}
      >
        {chatCollapsed ? (
          <div className={`h-[53px] w-10 flex items-center justify-center border-b ${
            theme === "dark" ? "border-white/10" : "border-gray-200"
          }`}>
            <button
              onClick={() => {
                setChatWidth(420);
                setChatCollapsed(false);
              }}
              className={`p-1.5 rounded-md transition-colors ${
                theme === "dark"
                  ? "text-cyan-300 hover:bg-white/10"
                  : "text-cyan-600 hover:bg-gray-100"
              }`}
              title="Expand AI chat"
              aria-label="Expand AI chat"
              data-testid="button-expand-ai-chat"
            >
              <PanelLeft size={18} />
            </button>
          </div>
        ) : (
          <>
        <div className={`px-5 py-4 border-b flex items-center gap-3 ${
          theme === "dark" ? "border-white/10" : "border-gray-200"
        }`}>
          <Zap size={18} className="text-purple-400" />
          <h2 className="font-display font-semibold text-brand-gradient">AI Builder</h2>
          <button
            onClick={() => setChatCollapsed(true)}
            className={`ml-auto p-1.5 rounded-md transition-colors ${
              theme === "dark"
                ? "text-white/50 hover:bg-white/10 hover:text-white"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            }`}
            title="Collapse AI chat"
            aria-label="Collapse AI chat"
            data-testid="button-collapse-ai-chat"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {runtimeError && <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{runtimeError}</div>}
          {!turns.length && !messages.length && !runtimeError && (
            <div className={`rounded-2xl border px-4 py-4 ${theme === "dark" ? "bg-white/5 border-white/10" : "bg-gray-100 border-gray-200"}`}>
              <p className={`text-sm font-semibold ${theme === "dark" ? "text-white/85" : "text-gray-800"}`}>What do you want to build?</p>
              <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>Describe your idea, or start with one of these:</p>
              <div className="mt-3 flex flex-col gap-2">
                {[
                  "Build a landing page for my business",
                  "Create an online store",
                  "Make a dashboard for tracking data",
                  "Build a booking website",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setChatInput(suggestion);
                      window.setTimeout(() => textareaRef.current?.focus(), 0);
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                      theme === "dark"
                        ? "border-white/10 text-white/65 hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:border-cyan-400 hover:text-gray-900"
                    }`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((turn) => (
            <div key={turn.id} className="space-y-3" data-testid={`builder-turn-${turn.id}`}>
              <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-r from-cyan-500 to-cyan-400 px-4 py-3 text-sm leading-relaxed text-black">
                  {turn.prompt}
                </div>
              </div>
              <div className="flex justify-start">
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border px-4 py-3 text-sm leading-relaxed ${
                  theme === "dark" ? "border-white/10 bg-white/5 text-white/80" : "border-gray-200 bg-gray-100 text-gray-800"
                }`}>
                  {turn.response}
                </div>
              </div>
              {turn.mode === "build" && (
                <details className={`group rounded-xl border ${
                  theme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-gray-200 bg-gray-50"
                }`}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-400"><Check size={13} /></div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs font-semibold ${theme === "dark" ? "text-white/85" : "text-gray-800"}`}>Completed checkpoint</div>
                      <div className={`text-[11px] ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
                        {(turn.activity?.length || 0)} {(turn.activity?.length || 0) === 1 ? "action" : "actions"} · {turn.changedFiles.length} changed {turn.changedFiles.length === 1 ? "file" : "files"}
                      </div>
                    </div>
                    <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
                  </summary>
                  <div className={`border-t px-3 py-3 ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
                    {(turn.activity?.length || 0) > 0 && (
                      <div className={`mb-3 space-y-1 border-b pb-3 ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
                        {turn.activity.map((entry, index) => (
                          <div key={`${entry.createdAt}-${index}`} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${
                            theme === "dark" ? "text-white/60" : "text-gray-600"
                          }`}>
                            <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
                              entry.status === "success" ? "bg-emerald-400/15 text-emerald-400" : "bg-cyan-400/15 text-cyan-400"
                            }`}>
                              {entry.type === "tool" ? <Terminal size={11} /> : <Sparkles size={11} />}
                            </div>
                            <span className="min-w-0 break-words leading-5">{entry.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {turn.changedFiles.length ? (
                      <div className="space-y-1">
                        {turn.changedFiles.map((file) => (
                          <div key={file.path}>
                            <button
                              onClick={() => showTurnFile(turn.id, file.path)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                                theme === "dark" ? "text-white/65 hover:bg-white/5" : "text-gray-600 hover:bg-white"
                              }`}
                            >
                              <FileCode2 size={13} className="shrink-0 text-cyan-400" />
                              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                              <span className="text-[10px] capitalize opacity-50">{file.change}</span>
                              <ChevronDown size={12} className={`transition-transform ${openTurnFile === `${turn.id}:${file.path}` ? "rotate-180" : ""}`} />
                            </button>
                            {openTurnFile === `${turn.id}:${file.path}` && (
                              <pre className={`mt-1 max-h-56 overflow-auto rounded-lg p-2 text-[10px] leading-relaxed ${
                                theme === "dark" ? "bg-black/40 text-cyan-100/70" : "border border-gray-100 bg-white text-gray-600"
                              }`}>
                                {loadingTurnFile ? "Loading code…" : turnFileContent}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>No file content changed in this turn.</p>
                    )}
                    {turn.commitHash && (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className={`font-mono text-[10px] ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{turn.commitHash.slice(0, 8)}</span>
                        <button
                          onClick={() => restoreBuilderTurn(turn)}
                          disabled={restoringTurnId !== null}
                          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${
                            theme === "dark" ? "border-white/10 text-cyan-300 hover:bg-white/5" : "border-gray-200 bg-white text-cyan-700 hover:bg-gray-50"
                          }`}
                        >
                          {restoringTurnId === turn.id ? "Restoring…" : "Restore checkpoint"}
                        </button>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          ))}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap px-4 py-3 rounded-2xl text-sm leading-relaxed ${
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
          {projectId > 0 && sending && (
            <BuildActivity projectId={projectId} theme={theme} isBuilding={sending} />
          )}
        </div>

        <div
          className={`relative p-4 border-t transition-colors ${
            isDraggingAttachment
              ? theme === "dark" ? "border-cyan-400 bg-cyan-400/10" : "border-cyan-500 bg-cyan-50"
              : theme === "dark" ? "border-white/10" : "border-gray-200"
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            if (Array.from(event.dataTransfer.items || []).some((item) => item.kind === "file")) setIsDraggingAttachment(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingAttachment(false);
          }}
          onDrop={handleAttachmentDrop}
          data-testid="editor-chat-dropzone"
        >
          {isDraggingAttachment && (
            <div className={`pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed text-sm font-semibold ${
              theme === "dark" ? "border-cyan-300 bg-[#101522]/95 text-cyan-200" : "border-cyan-500 bg-white/95 text-cyan-700"
            }`} data-testid="editor-chat-drop-overlay">
              Drop images to attach
            </div>
          )}
          {previewAttachment && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"
              onClick={() => setPreviewAttachmentId(null)}
              role="dialog"
              aria-modal="true"
              aria-label={`Preview ${previewAttachment.filename}`}
              data-testid="image-attachment-preview"
            >
              <div className="relative flex max-h-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0b0b14] shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-white">{previewAttachment.filename}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => removeAttachment(previewAttachment.id)}
                      className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/15"
                      aria-label={`Remove ${previewAttachment.filename} from attachments`}
                    >
                      Remove attachment
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewAttachmentId(null)}
                      className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                      aria-label="Close image preview"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 items-center justify-center overflow-auto p-4">
                  <img
                    src={`data:${previewAttachment.mimeType};base64,${previewAttachment.base64Data}`}
                    alt={previewAttachment.filename}
                    className="max-h-[78vh] max-w-full object-contain"
                  />
                </div>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept="image/png,image/jpeg,image/webp,text/*,.tsx,.ts,.jsx,.js,.css,.scss,.html,.json,.md,.py,.sql,.yaml,.yml,.sh,.xml"
            onChange={handleAttachmentChange}
            data-testid="input-editor-attachments"
          />
          {voiceError && <p className="mb-2 text-[11px] text-amber-400">{voiceError}</p>}
          <div className={`p-3 rounded-xl ${
            theme === "dark"
              ? "bg-white/5 border border-white/10"
              : "bg-gray-100 border border-gray-200"
          }`}>
            {(attachments.length > 0 || textContext.length > 0 || selectedElement || pendingPlan) && (
              <div className="mb-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto" data-testid="composer-attachment-previews">
                {attachments.map((file) => (
                  <div key={file.id} className="group relative h-16 w-20 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewAttachmentId(file.id)}
                      className={`h-full w-full overflow-hidden rounded-lg border text-left transition ${
                        theme === "dark" ? "border-white/15 bg-black/30 hover:border-cyan-300/60" : "border-gray-300 bg-white hover:border-cyan-500"
                      }`}
                      aria-label={`Preview ${file.filename}`}
                      data-testid={`preview-attachment-${file.id}`}
                    >
                      <img
                        src={`data:${file.mimeType};base64,${file.base64Data}`}
                        alt=""
                        className="h-11 w-full object-cover"
                      />
                      <span className={`block truncate px-1 py-0.5 text-[9px] ${theme === "dark" ? "text-white/65" : "text-gray-600"}`}>{file.filename}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeAttachment(file.id);
                      }}
                      aria-label={`Remove ${file.filename}`}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/30 bg-black/85 text-white shadow hover:bg-red-500"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {textContext.map((file) => (
                  <span key={file.id} className={`inline-flex h-fit items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${theme === "dark" ? "border-purple-400/20 bg-purple-400/10 text-purple-200" : "border-purple-200 bg-purple-50 text-purple-700"}`}>
                    <FileText size={11} /> {file.filename}
                    <button onClick={() => removeTextContext(file.id)} aria-label={`Remove ${file.filename}`} className="ml-0.5 opacity-60 hover:opacity-100"><X size={11} /></button>
                  </span>
                ))}
                {selectedElement && (
                  <span className={`inline-flex h-fit items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${theme === "dark" ? "border-pink-400/20 bg-pink-400/10 text-pink-200" : "border-pink-200 bg-pink-50 text-pink-700"}`}>
                    <Code2 size={11} /> Element selected
                    <button onClick={() => setSelectedElement(null)} aria-label="Remove selected element" className="ml-0.5 opacity-60 hover:opacity-100"><X size={11} /></button>
                  </span>
                )}
                {pendingPlan && (
                  <span className={`inline-flex h-fit items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${theme === "dark" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                    <Check size={11} /> Plan ready for next build
                    <button onClick={() => setPendingPlan("")} aria-label="Remove approved plan" className="ml-0.5 opacity-60 hover:opacity-100"><X size={11} /></button>
                  </span>
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Describe what you want to build..."
              rows={1}
              className={`block w-full min-h-10 max-h-[220px] bg-transparent border-none outline-none resize-none text-sm leading-6 ${
                theme === "dark"
                  ? "text-white placeholder-white/40"
                  : "text-gray-900 placeholder-gray-400"
              }`}
              data-testid="input-editor-chat"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setPlanMode((value) => !value)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${planMode ? "border-purple-400/50 bg-purple-400/15 text-purple-200" : theme === "dark" ? "border-white/10 text-white/45 hover:text-white/75" : "border-gray-200 text-gray-500 hover:text-gray-800"}`}
                  title="Plan only. No workspace files will be changed."
                  aria-pressed={planMode}
                  data-testid="button-plan-toggle"
                >Plan</button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`p-1.5 rounded-md transition-colors ${theme === "dark" ? "text-white/45 hover:bg-white/10 hover:text-white" : "text-gray-500 hover:bg-white hover:text-gray-800"}`}
                  title="Attach files"
                  data-testid="button-attach-file"
                ><Plus size={16} /></button>
                <button
                  onClick={toggleListening}
                  className={`p-1.5 rounded-md transition-colors ${listening ? "bg-cyan-400/20 text-cyan-300" : theme === "dark" ? "text-white/45 hover:bg-white/10 hover:text-white" : "text-gray-500 hover:bg-white hover:text-gray-800"}`}
                  title={listening ? "Stop listening" : "Use voice input"}
                  data-testid="button-editor-microphone"
                ><Mic size={15} /></button>
                <button
                  onClick={toggleSelector}
                  className={`p-1.5 rounded-md transition-colors ${selectorEnabled ? "bg-pink-400/20 text-pink-300" : theme === "dark" ? "text-white/45 hover:bg-white/10 hover:text-white" : "text-gray-500 hover:bg-white hover:text-gray-800"}`}
                  title={selectorEnabled ? "Turn off element selector" : "Select an element in preview"}
                  data-testid="button-element-selector"
                ><MousePointer2 size={15} /></button>
              </div>
              {sending ? (
              <button
                onClick={stopBuild}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 border border-red-400/30 text-red-300 hover:bg-red-500/25 transition-colors text-xs font-semibold"
                data-testid="button-stop-build"
              >
                <StopCircle size={16} />
                Stop
              </button>
              ) : (
              <button
                onClick={() => handleSend()}
                className="shrink-0 p-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-black transition-colors"
                data-testid="button-send-chat"
              >
                <ChevronRight size={18} />
              </button>
              )}
            </div>
          </div>
        </div>
          </>
        )}
        {!chatCollapsed && (
          <div
            onPointerDown={startChatResize}
            className="group absolute inset-y-0 -right-1 z-50 w-3 cursor-col-resize touch-none"
            role="separator"
            aria-label="Resize AI chat"
            aria-orientation="vertical"
            data-testid="resize-handle-ai-chat"
          >
            <div className={`absolute right-1 top-1/2 flex h-9 w-4 -translate-y-1/2 items-center justify-center rounded-full border opacity-0 shadow-lg transition-opacity group-hover:opacity-100 ${
              theme === "dark" ? "border-white/15 bg-[#151522] text-white/65" : "border-gray-200 bg-white text-gray-500"
            }`}>
              <GripVertical size={13} />
            </div>
          </div>
        )}
      </motion.aside>

      <div className={`min-w-0 flex-1 flex flex-col ${
        theme === "dark" ? "bg-[#060610]" : "bg-gray-50"
      }`}>
        <div className={`min-w-0 flex items-center gap-3 px-5 py-3 border-b ${
          theme === "dark" ? "border-white/10" : "border-gray-200"
        }`}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400/80" />
            <div className="w-3 h-3 rounded-full bg-amber-400/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-400/80" />
          </div>

          <div className={`flex items-center gap-1 p-1 rounded-lg shrink-0 ${
            theme === "dark" ? "bg-white/5" : "bg-gray-200"
          }`}>
            {(["development", "production"] as const).map((environment) => (
              <button
                key={environment}
                onClick={() => setPreviewEnvironment(environment)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                  previewEnvironment === environment
                    ? theme === "dark"
                      ? "bg-white/10 text-white shadow-sm"
                      : "bg-white text-gray-900 shadow-sm"
                    : theme === "dark"
                      ? "text-white/40 hover:text-white/70"
                      : "text-gray-500 hover:text-gray-700"
                }`}
                data-testid={`button-environment-${environment}`}
              >
                {environment === "development" ? "Development" : "Production"}
              </button>
            ))}
          </div>

          <div className={`ml-auto flex items-center gap-1 p-1 rounded-lg shrink-0 ${
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

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (previewEnvironment === "development") navigatePreviewPath();
            }}
            className={`w-[clamp(160px,24vw,280px)] shrink-0 overflow-hidden px-3 py-1.5 rounded-lg text-xs ${
              theme === "dark"
                ? "bg-white/5 text-white/40"
                : "bg-gray-200 text-gray-500"
            }`}
            title={activePreviewUrl || undefined}
          >
            {previewEnvironment === "development" && activePreviewUrl ? (
              <input
                value={addressDraft}
                onChange={(event) => setAddressDraft(event.target.value)}
                onBlur={navigatePreviewPath}
                aria-label="Development preview path"
                className="w-full bg-transparent text-center outline-none"
                spellCheck={false}
                data-testid="input-preview-address"
              />
            ) : (
              <div className="truncate text-center">
                {activePreviewUrl ? customDomain || activePreviewUrl : (
                previewEnvironment === "production"
                  ? "Not published yet"
                  : projectId ? "Waiting for an Agent preview…" : "Select a runtime project"
                )}
              </div>
            )}
          </form>
          <button
            onClick={() => {
              setPublishDrawerOpen(true);
              if (publishFlow.status === "idle" && !productionUrl) {
                if (hostingProvider === "custom") {
                  setPublishFlow({ status: "failed", message: "External hosting uses your provider's deployment process. After deploying there, use the custom-domain DNS instructions in this panel." });
                } else {
                  setPublishFlow({ status: "approval", message: "Review hosting and domain settings, then approve this Development version for publishing." });
                }
              }
            }}
            disabled={!previewUrl}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-400 text-black hover:bg-cyan-300 disabled:opacity-40 text-xs font-semibold transition-colors"
            data-testid="button-open-publish-drawer"
          >
            {publishing ? <RefreshCw size={13} className="animate-spin" /> : <Rocket size={13} />}
            {publishing ? "Publishing" : "Publish"}
          </button>
          {previewEnvironment === "production" && !productionUrl ? null : (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={refreshActivePreview}
                disabled={!activePreviewUrl || refreshingPreview}
                aria-label={`Refresh ${previewEnvironment} preview`}
                title={`Refresh ${previewEnvironment} preview`}
                className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
                  theme === "dark"
                    ? "hover:bg-white/10 text-white/40"
                    : "hover:bg-gray-200 text-gray-400"
                }`}
                data-testid="button-refresh-preview"
              >
                <RefreshCw size={14} className={refreshingPreview ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => activePreviewSrc && window.open(activePreviewSrc, "_blank", "noopener,noreferrer")}
                disabled={!activePreviewUrl}
                aria-label={`Open ${previewEnvironment} preview in a new tab`}
                className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
                  theme === "dark"
                    ? "hover:bg-white/10 text-white/40"
                    : "hover:bg-gray-200 text-gray-400"
                }`}
              >
                <ExternalLink size={14} />
              </button>
            </div>
          )}
        </div>

        {false && publishFlow.status !== "idle" && (
          <div className={`border-b px-5 py-4 ${
            theme === "dark" ? "border-white/10 bg-[#0b0b16]" : "border-gray-200 bg-white"
          }`} data-testid="publish-activity">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {publishing ? (
                    <RefreshCw size={15} className="animate-spin text-cyan-400" />
                  ) : publishFlow.status === "complete" ? (
                    <Check size={15} className="text-emerald-400" />
                  ) : publishFlow.status === "failed" ? (
                    <X size={15} className="text-red-400" />
                  ) : (
                    <Shield size={15} className="text-amber-400" />
                  )}
                  <h3 className={`text-sm font-semibold ${theme === "dark" ? "text-white/90" : "text-gray-900"}`}>
                    {publishFlow.status === "approval" ? "Approval required" : publishFlow.status === "complete" ? "Published" : publishFlow.status === "failed" ? "Publish failed" : "Publishing"}
                  </h3>
                </div>
                <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>{publishFlow.message}</p>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[
                    { id: "approval", label: "Approval" },
                    { id: "preparing", label: "Prepare" },
                    { id: "deploying", label: "Cloudflare" },
                    { id: "complete", label: "Live" },
                  ].map((stage, index) => {
                    const order = ["approval", "preparing", "deploying", "complete"];
                    const current = order.indexOf(publishFlow.status);
                    const done = publishFlow.status === "complete" || (current > index && publishFlow.status !== "failed");
                    const active = stage.id === publishFlow.status;
                    return (
                      <div key={stage.id}>
                        <div className={`h-1 rounded-full ${
                          done ? "bg-emerald-400" : active ? "bg-cyan-400 animate-pulse" : theme === "dark" ? "bg-white/10" : "bg-gray-200"
                        }`} />
                        <div className={`mt-1.5 text-[10px] font-medium ${
                          done || active ? theme === "dark" ? "text-white/75" : "text-gray-800" : theme === "dark" ? "text-white/30" : "text-gray-400"
                        }`}>{stage.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {publishFlow.status === "approval" && (
                  <>
                    <button
                      onClick={() => setPublishFlow({ status: "idle", message: "" })}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                        theme === "dark" ? "border-white/10 text-white/60 hover:bg-white/5" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                      data-testid="button-cancel-publish"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={publishProject}
                      className="px-3 py-1.5 rounded-lg bg-cyan-400 text-black hover:bg-cyan-300 text-xs font-semibold"
                      data-testid="button-approve-publish"
                    >
                      Approve and publish
                    </button>
                  </>
                )}
                {(publishFlow.status === "complete" || publishFlow.status === "failed") && (
                  <button
                    onClick={() => setPublishFlow({ status: "idle", message: "" })}
                    className={`p-1.5 rounded-md ${theme === "dark" ? "text-white/40 hover:bg-white/10" : "text-gray-400 hover:bg-gray-100"}`}
                    aria-label="Dismiss publish activity"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>
            {(publishFlow.status === "preparing" || publishFlow.status === "deploying") && (
              <p className={`mt-2 text-[10px] ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>
                The deployment can no longer be cancelled after approval because Cloudflare may already be activating the new Worker.
              </p>
            )}
          </div>
        )}

        {false && previewEnvironment === "production" && releases.length > 0 && (
          <div className={`border-b px-5 py-3 ${
            theme === "dark" ? "border-white/10 bg-[#090912]" : "border-gray-200 bg-gray-50"
          }`}>
            <h3 className={`text-xs font-semibold ${theme === "dark" ? "text-white/80" : "text-gray-800"}`}>Published releases</h3>
            <p className={`mb-2 text-[10px] ${theme === "dark" ? "text-white/35" : "text-gray-500"}`}>Restore a release to Development without changing the live app.</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {releases.map((release, index) => (
                <div key={release.id} className={`shrink-0 flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  theme === "dark" ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-white"
                }`}>
                  <div>
                    <div className={`text-[11px] font-semibold ${theme === "dark" ? "text-white/75" : "text-gray-700"}`}>
                      {index === 0 ? "Current production" : new Date(release.createdAt).toLocaleString()}
                    </div>
                    <div className={`font-mono text-[10px] ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{release.commitHash.slice(0, 8)}</div>
                  </div>
                  <button
                    onClick={() => setRestoreCandidate(release)}
                    disabled={restoringRelease}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border ${
                      theme === "dark" ? "border-white/10 text-cyan-300 hover:bg-white/5" : "border-gray-200 text-cyan-700 hover:bg-gray-50"
                    }`}
                  >
                    Restore to Dev
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {false && restoreCandidate && (
          <div className={`border-b px-5 py-4 ${
            theme === "dark" ? "border-amber-400/20 bg-amber-400/[0.06]" : "border-amber-200 bg-amber-50"
          }`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className={`text-sm font-semibold ${theme === "dark" ? "text-amber-100" : "text-amber-900"}`}>Restore this release to Development?</h3>
                <p className={`mt-1 text-xs ${theme === "dark" ? "text-amber-100/55" : "text-amber-800/70"}`}>
                  This creates a new Development restore point from {restoreCandidate?.commitHash.slice(0, 8)}. Production stays live and unchanged.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setRestoreCandidate(null)}
                  disabled={restoringRelease}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                    theme === "dark" ? "border-white/10 text-white/60" : "border-gray-200 bg-white text-gray-600"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={restoreReleaseToDevelopment}
                  disabled={restoringRelease}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 text-black hover:bg-amber-300 disabled:opacity-50 text-xs font-semibold"
                  data-testid="button-confirm-restore-release"
                >
                  {restoringRelease && <RefreshCw size={13} className="animate-spin" />}
                  {restoringRelease ? "Restoring" : "Restore to Development"}
                </button>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence>
          {publishDrawerOpen && (
            <>
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPublishDrawerOpen(false)}
                className="fixed inset-0 z-[70] bg-black/35"
                aria-label="Close publishing settings"
              />
              <motion.aside
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className={`fixed inset-y-0 right-0 z-[71] flex w-full max-w-[430px] flex-col border-l shadow-2xl ${
                  theme === "dark" ? "border-white/10 bg-[#0b0b16] text-white" : "border-gray-200 bg-white text-gray-900"
                }`}
                data-testid="publishing-drawer"
              >
                <div className={`flex items-center gap-3 border-b px-5 py-4 ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-400"><Rocket size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">Publish project</h2>
                    <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Subdomain, custom domain, progress, and releases</p>
                  </div>
                  <button
                    onClick={() => setPublishDrawerOpen(false)}
                    className={`rounded-lg p-2 ${theme === "dark" ? "text-white/45 hover:bg-white/10" : "text-gray-400 hover:bg-gray-100"}`}
                    aria-label="Close publishing settings"
                  >
                    <X size={17} />
                  </button>
                </div>

                <div className="flex-1 space-y-5 overflow-y-auto p-5">
                  <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide opacity-60">BuildCustom.Ai subdomain</h3>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                      Your included project address
                      <span className="group relative inline-flex" tabIndex={0}>
                        <HelpCircle size={13} className="opacity-45" />
                        <span className={`pointer-events-none absolute left-1/2 top-5 z-20 hidden w-64 -translate-x-1/2 rounded-lg border p-2.5 text-[11px] font-normal leading-relaxed shadow-xl group-hover:block group-focus:block ${
                          theme === "dark" ? "border-white/10 bg-[#171724] text-white/70" : "border-gray-200 bg-white text-gray-600"
                        }`}>
                          This address is included with your plan. Change the first part before publishing if you want a different project address.
                        </span>
                      </span>
                    </label>
                    <div className={`flex overflow-hidden rounded-xl border focus-within:border-cyan-400/60 ${
                      theme === "dark" ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"
                    }`}>
                      <input
                        value={subdomainSlug}
                        onChange={(event) => setSubdomainSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                        disabled={Boolean(productionUrl)}
                        maxLength={63}
                        aria-label="BuildCustom.Ai subdomain name"
                        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-right text-sm outline-none disabled:cursor-not-allowed disabled:opacity-55"
                        data-testid="input-subdomain-slug"
                      />
                      <span className={`flex items-center border-l px-3 text-sm ${theme === "dark" ? "border-white/10 text-white/45" : "border-gray-200 text-gray-500"}`}>
                        .apps.buildcustom.ai
                      </span>
                    </div>
                    <div className={`mt-2 flex items-center justify-between gap-3 text-[11px] ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
                      <span>{productionUrl ? "Project addresses are locked after the first publish." : `${planEntitlement.name} includes ${planEntitlement.liveProjectLimit} live ${planEntitlement.liveProjectLimit === 1 ? "project" : "projects"}.`}</span>
                      <span className="shrink-0 text-emerald-500">Hosting, SSL, and CDN included</span>
                    </div>

                    {!customDomainOpen ? (
                      <button
                        type="button"
                        onClick={() => setCustomDomainOpen(true)}
                        className={`mt-4 flex w-full items-center justify-between rounded-xl border border-dashed px-3 py-3 text-left text-xs font-semibold ${
                          theme === "dark" ? "border-white/15 text-white/65 hover:bg-white/5" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                        data-testid="button-add-custom-domain"
                      >
                        <span className="flex items-center gap-2"><Globe size={14} className="text-purple-400" /> Add a custom domain</span>
                        <Plus size={14} />
                      </button>
                    ) : (
                      <div className={`mt-4 rounded-2xl border p-4 ${theme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-gray-200 bg-gray-50"}`}>
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <h4 className="text-xs font-semibold">Custom domain</h4>
                            <p className={`mt-0.5 text-[11px] ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Use a domain you already own.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomDomainOpen(false);
                              setCustomDomain("");
                              setCustomOrigin("");
                              setHostingProvider("buildcustom");
                            }}
                            className={`rounded-lg p-1.5 ${theme === "dark" ? "text-white/40 hover:bg-white/10" : "text-gray-400 hover:bg-gray-200"}`}
                            aria-label="Remove custom domain"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <input
                          value={customDomain}
                          onChange={(event) => setCustomDomain(event.target.value)}
                          placeholder="app.example.com"
                          className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-cyan-400/60 ${
                            theme === "dark" ? "border-white/10 bg-white/5 placeholder:text-white/25" : "border-gray-200 bg-white"
                          }`}
                          data-testid="input-custom-domain"
                        />
                        <label className="mb-1.5 mt-4 block text-xs font-medium">How should this custom domain be hosted?</label>
                        <select
                          value={hostingProvider}
                          onChange={(event) => setHostingProvider(event.target.value)}
                          className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${
                            theme === "dark" ? "border-white/10 bg-[#141420]" : "border-gray-200 bg-white"
                          }`}
                        >
                          <option value="buildcustom">BuildCustom.Ai Hosting</option>
                          <option value="custom">My external hosting provider</option>
                        </select>
                        {hostingProvider === "buildcustom" && !planEntitlement.managedCustomDomains && (
                          <div className={`mt-3 rounded-xl border p-3 text-[11px] leading-relaxed ${
                            theme === "dark" ? "border-amber-400/20 bg-amber-400/[0.06] text-amber-100/70" : "border-amber-200 bg-amber-50 text-amber-800"
                          }`}>
                            BuildCustom.Ai-hosted custom domains start on Launch. Your included BuildCustom.Ai subdomain remains free.
                            <a href="/#pricing" className="ml-1 font-semibold underline underline-offset-2">View plans</a>
                          </div>
                        )}
                        {hostingProvider === "custom" && (
                          <>
                            <label className="mb-1.5 mt-4 flex items-center gap-1.5 text-xs font-medium">
                              External hosting origin
                              <span className="group relative inline-flex" tabIndex={0}>
                                <HelpCircle size={13} className="opacity-45" />
                                <span className={`pointer-events-none absolute right-0 top-5 z-20 hidden w-64 rounded-lg border p-2.5 text-[11px] font-normal leading-relaxed shadow-xl group-hover:block group-focus:block ${
                                  theme === "dark" ? "border-white/10 bg-[#171724] text-white/70" : "border-gray-200 bg-white text-gray-600"
                                }`}>
                                  Deploy with your external provider first, then enter the hostname they supply. Do not include https:// or a path.
                                </span>
                              </span>
                            </label>
                            <input
                              value={customOrigin}
                              onChange={(event) => setCustomOrigin(event.target.value)}
                              placeholder="project.hosting-provider.com"
                              className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-cyan-400/60 ${
                                theme === "dark" ? "border-white/10 bg-white/5 placeholder:text-white/25" : "border-gray-200 bg-white"
                              }`}
                              data-testid="input-custom-origin"
                            />
                          </>
                        )}
                        {customDomain && (
                          <div className={`mt-3 rounded-xl border p-3 ${theme === "dark" ? "border-white/10 bg-black/20" : "border-gray-200 bg-white"}`}>
                            <div className="flex items-center gap-1.5 text-xs font-semibold">
                              DNS record
                              <span className="group relative inline-flex" tabIndex={0}>
                                <HelpCircle size={13} className="opacity-45" />
                                <span className={`pointer-events-none absolute right-0 top-5 z-20 hidden w-64 rounded-lg border p-2.5 text-[11px] font-normal leading-relaxed shadow-xl group-hover:block group-focus:block ${
                                  theme === "dark" ? "border-white/10 bg-[#171724] text-white/70" : "border-gray-200 bg-white text-gray-600"
                                }`}>
                                  Add this record with the DNS provider that controls your domain. Apex domains may require CNAME flattening or an ALIAS/ANAME record.
                                </span>
                              </span>
                            </div>
                            <div className="mt-2 grid grid-cols-[70px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
                              <span className="opacity-40">Type</span><code>CNAME</code>
                              <span className="opacity-40">Name</span><code className="truncate">{customDomain.split(".")[0]}</code>
                              <span className="opacity-40">Target</span>
                              <code className="truncate">{hostingProvider === "custom" ? customOrigin || "Enter your hosting origin above" : managedCnameTarget}</code>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={savePublishingSettings}
                        disabled={savingPublishSettings}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                          theme === "dark" ? "border-white/10 text-cyan-300 hover:bg-white/5" : "border-gray-200 text-cyan-700 hover:bg-gray-50"
                        }`}
                        data-testid="button-save-publishing-settings"
                      >
                        {savingPublishSettings ? "Saving…" : "Save settings"}
                      </button>
                      {publishSettingsMessage && <span className={`text-[11px] ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>{publishSettingsMessage}</span>}
                    </div>
                  </section>

                  <section className={`rounded-2xl border p-4 ${theme === "dark" ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-gray-50"}`}>
                    <div className="flex items-center gap-2">
                      {publishing ? <RefreshCw size={15} className="animate-spin text-cyan-400" /> :
                        publishFlow.status === "complete" ? <Check size={15} className="text-emerald-400" /> :
                        publishFlow.status === "failed" ? <X size={15} className="text-red-400" /> :
                        <Cloud size={15} className="text-cyan-400" />}
                      <h3 className="text-sm font-semibold">
                        {publishFlow.status === "idle" ? "Ready to publish" :
                          publishFlow.status === "approval" ? "Approval required" :
                          publishFlow.status === "complete" ? "Published" :
                          publishFlow.status === "failed" ? "Publish failed" : "Publishing"}
                      </h3>
                    </div>
                    <p className={`mt-1.5 text-xs leading-relaxed ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
                      {publishFlow.message || "Publish the current Development version to Production."}
                    </p>
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {[
                        { id: "approval", label: "Approval" },
                        { id: "preparing", label: "Prepare" },
                        { id: "deploying", label: "Deploy" },
                        { id: "complete", label: "Live" },
                      ].map((stage, index) => {
                        const order = ["approval", "preparing", "deploying", "complete"];
                        const current = order.indexOf(publishFlow.status);
                        const done = publishFlow.status === "complete" || (current > index && publishFlow.status !== "failed");
                        const active = stage.id === publishFlow.status;
                        return (
                          <div key={stage.id}>
                            <div className={`h-1 rounded-full ${done ? "bg-emerald-400" : active ? "animate-pulse bg-cyan-400" : theme === "dark" ? "bg-white/10" : "bg-gray-200"}`} />
                            <div className={`mt-1.5 text-[10px] font-medium ${done || active ? "opacity-80" : "opacity-30"}`}>{stage.label}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      {publishFlow.status === "idle" && (
                        <button
                          onClick={requestPublishApproval}
                          className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-black hover:bg-cyan-300"
                        >
                          {hostingProvider === "custom" ? "View external hosting steps" : "Publish with BuildCustom.Ai"}
                        </button>
                      )}
                      {publishFlow.status === "approval" && hostingProvider !== "custom" && (
                        <>
                          <button onClick={() => setPublishFlow({ status: "idle", message: "" })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${theme === "dark" ? "border-white/10 text-white/60" : "border-gray-200 text-gray-600"}`}>Cancel</button>
                          <button onClick={publishProject} className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-black hover:bg-cyan-300">Approve and publish</button>
                        </>
                      )}
                      {(publishFlow.status === "complete" || publishFlow.status === "failed") && (
                        <button onClick={() => setPublishFlow({ status: "idle", message: "" })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${theme === "dark" ? "border-white/10 text-white/60" : "border-gray-200 text-gray-600"}`}>Done</button>
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60">Published releases</h3>
                    <p className={`mb-3 mt-1 text-[11px] ${theme === "dark" ? "text-white/35" : "text-gray-500"}`}>Restore an earlier release to Development without changing the live app.</p>
                    {releases.length ? (
                      <div className="space-y-2">
                        {releases.map((release, index) => (
                          <div key={release.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${theme === "dark" ? "border-white/10 bg-white/[0.03]" : "border-gray-200"}`}>
                            <History size={14} className="shrink-0 text-cyan-400" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold">{index === 0 ? "Current production" : new Date(release.createdAt).toLocaleString()}</div>
                              <div className="font-mono text-[10px] opacity-35">{release.commitHash.slice(0, 8)}</div>
                            </div>
                            <button onClick={() => setRestoreCandidate(release)} className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold ${theme === "dark" ? "border-white/10 text-cyan-300" : "border-gray-200 text-cyan-700"}`}>Restore to Dev</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={`rounded-xl border border-dashed px-3 py-4 text-center text-xs ${theme === "dark" ? "border-white/10 text-white/35" : "border-gray-200 text-gray-500"}`}>Your published versions will appear here.</div>
                    )}
                  </section>

                  {restoreCandidate && (
                    <section className={`rounded-2xl border p-4 ${theme === "dark" ? "border-amber-400/20 bg-amber-400/[0.06]" : "border-amber-200 bg-amber-50"}`}>
                      <h3 className="text-sm font-semibold">Restore this release to Development?</h3>
                      <p className="mt-1 text-xs opacity-60">Production stays unchanged until you publish again.</p>
                      <div className="mt-3 flex justify-end gap-2">
                        <button onClick={() => setRestoreCandidate(null)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${theme === "dark" ? "border-white/10" : "border-gray-200 bg-white"}`}>Cancel</button>
                        <button onClick={restoreReleaseToDevelopment} disabled={restoringRelease} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">
                          {restoringRelease ? "Restoring…" : "Restore to Development"}
                        </button>
                      </div>
                    </section>
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

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
             {activePreviewUrl ? (
               <iframe
                 key={`${previewEnvironment}-${previewRevision}-${activePreviewUrl}`}
                 ref={previewFrameRef}
                  src={activePreviewSrc}
                 title={`${previewEnvironment === "development" ? "Development" : "Production"} project preview`}
                 onLoad={() => previewFrameRef.current?.contentWindow?.postMessage({ type: "buildcustom:selector", enabled: selectorEnabled }, "*")}
                 className="w-full h-full border-0 bg-white"
               />
             ) : previewEnvironment === "production" ? (
               <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
                 <div className={`p-4 rounded-2xl ${theme === "dark" ? "bg-white/5" : "bg-gray-100"}`}>
                   <Rocket size={28} className="text-cyan-400" />
                 </div>
                 <div>
                   <p className={`font-semibold ${theme === "dark" ? "text-white/80" : "text-gray-800"}`}>No production deployment yet</p>
                   <p className={`mt-1 text-sm ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Publish the current development version when it is ready for users.</p>
                 </div>
                 <button
                   onClick={requestPublishApproval}
                   disabled={publishing || !previewUrl}
                   className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-400 text-black hover:bg-cyan-300 disabled:opacity-40 text-sm font-semibold transition-colors"
                 >
                   {publishing ? <RefreshCw size={15} className="animate-spin" /> : <Rocket size={15} />}
                   {publishing ? "Publishing…" : "Publish to production"}
                 </button>
               </div>
             ) : (
               <div className={`h-full flex items-center justify-center text-sm ${theme === "dark" ? "bg-[#0d0d1a] text-white/40" : "bg-white text-gray-500"}`}>
                 {projectId ? "Send an Agent request to create a preview." : "A project is required for a live preview."}
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
  const currentPlan = getPlanEntitlement(getAppUser()?.plan);
  const plans = [
    { id: "free", name: "Free", price: "$0", features: ["1 live project", "BuildCustom.Ai subdomain", "Hosting, SSL, and CDN"], current: currentPlan.id === "free" },
    { id: "launch", name: "Launch", price: "$9", features: ["5 live projects", "Custom domains", "Hosting, SSL, and CDN"], current: currentPlan.id === "launch" },
    { id: "pro", name: "Pro", price: "$19", features: ["25 live projects", "Custom domains", "Hosting, SSL, and CDN"], current: currentPlan.id === "pro" },
    { id: "agency", name: "Agency", price: "$49", features: ["100 live projects", "Custom domains", "Hosting, SSL, and CDN"], current: currentPlan.id === "agency" },
  ];

  return (
    <SettingsCard title="Plan & Billing" description="Manage your subscription">
      <p className={`mb-4 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
        AI generation and model usage are metered separately from hosting.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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

function AppDashboardContent({ user }: { user: AppUser }) {
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
      <AppSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} isAdmin={isAdminUser(user)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <AppTopBar />
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/app" component={ProjectsPage} />
            <Route path="/app/templates" component={TemplatesPage} />
            <Route path="/app/editor" component={EditorPage} />
            <Route path="/app/editor/:id" component={EditorPage} />
            {isAdminUser(user) && <Route path="/app/users" component={UsersPage} />}
            {isAdminUser(user) && <Route path="/app/analytics" component={AnalyticsPage} />}
            {isAdminUser(user) && <Route path="/app/billing" component={BillingPage} />}
            {isAdminUser(user) && <Route path="/app/support" component={SupportPage} />}
            {isAdminUser(user) && <Route path="/app/deployments" component={DeploymentsPage} />}
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
  const [appUser, setCurrentUser] = useState<AppUser | null>(() => getAppUser());
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!appUser) return;
    fetch("/api/auth/me", { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error("Unable to refresh account");
        return res.json();
      })
      .then((user: AppUser) => {
        setAppUser(user);
        setCurrentUser(user);
      })
      .catch(() => {});
  }, [appUser?.id]);

  if (!appUser) {
    navigate("/app/login");
    return null;
  }

  return (
    <ThemeProvider>
      <AppDashboardContent user={appUser} />
    </ThemeProvider>
  );
}
