import { useEffect, useRef, useState } from "react";
import { NativeAutoContinueControl } from "@/components/native-auto-continue-control";
import { Route, Switch, useLocation, Link, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { csrfToken, getAppUser, setAppUser, authHeaders, isAdminUser, signOut, clearAppUser, type AppUser } from "@/lib/auth";
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
  Activity,
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
import { publicGeneratedAppUrl, usePublicCapabilities } from "@/hooks/use-public-capabilities";
import previewPortfolio from "@/assets/preview-portfolio.jpg";
import previewFitness from "@/assets/preview-fitness.jpg";
import previewGame from "@/assets/preview-game.jpg";
import previewEcommerce from "@/assets/preview-ecommerce.jpg";
import { ThemeProvider, useTheme } from "@/contexts/theme-context";
import {
  UsersPage,
  ProjectsPage as AdminProjectsPage,
  AnalyticsPage,
  BillingPage,
  SupportPage,
  DeploymentsPage,
  SystemHealthPage,
} from "@/pages/app-admin-live-pages";
import { AdminCustomerDetailPage, AdminSupportWorkspacePage } from "@/pages/admin-customer-detail";
import CustomerSupportAccessPage from "@/pages/customer-support-access";
import CustomerSupportTicketsPage from "@/pages/customer-support-tickets";
import OwnerBootstrapPage from "@/pages/owner-bootstrap-page";
import ProjectDetail from "@/pages/project-detail";
import {
  adminNavigationForRole,
  ownerAuthorizationVisible,
  type AdminNavigationIcon,
} from "@/lib/admin-navigation";
import { getPlanEntitlement } from "@shared/plans";
import {
  answerPlanningQuestion,
  approveBuildPlan,
  buildPromptFromPlanningSession,
  isValidPlanningSession,
  startBuildPlanning,
  type PlanningQuestion,
  type PlanningSession,
} from "@shared/build-planning";
import {
  BuildActivityTimeline,
  BuildPreviewPlaceholder,
  ClarificationOptions,
  type BuilderPhase,
} from "@/components/customer-experience/BuilderExperience";
import {
  MAX_NATIVE_ACTIVITY_EVENTS,
  readNativeActivitySnapshot,
  safeBuildErrorMessage,
  writeNativeActivitySnapshot,
  type BuildActivityEvent,
} from "@/lib/native-activity";
import {
  canContinueNativeTask,
  customerLifecycleStatus,
  hasFreshApprovedOperation,
  isContextualContinuationApproval,
} from "@/lib/native-continuation";

function AppSidebar({ collapsed, onToggle, role, email }: {
  collapsed: boolean;
  onToggle: () => void;
  role: string;
  email: string;
}) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const isAdmin = role === "super_admin";

  const baseItems = [
    { path: "/app", icon: LayoutGrid, label: "Projects" },
    { path: "/app/templates", icon: Layers, label: "Templates" },
    { path: "/app/editor", icon: Code2, label: "Builder" },
  ];

  const adminIcons: Record<AdminNavigationIcon, typeof Users> = {
    users: Users,
    projects: FolderTree,
    analytics: BarChart3,
    deployments: Cloud,
    health: Activity,
    billing: Receipt,
    support: LifeBuoy,
  };
  const adminItems = adminNavigationForRole(role).map((item) => ({
    ...item,
    icon: adminIcons[item.icon],
  }));

  const navItems = [
    ...baseItems,
    ...(!isAdmin ? [{ path: "/app/support", icon: LifeBuoy, label: "Support" }] : []),
    ...(isAdmin ? adminItems : []),
    ...(ownerAuthorizationVisible(email, role)
      ? [{ path: "/app/owner-authorization", icon: Shield, label: "Owner access" }]
      : []),
    { path: "/app/settings", icon: Settings, label: "Settings" },
  ];
  const showAdminHeading = isAdmin && adminItems.length > 0;
  const adminHeadingIndex = baseItems.length;

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
            {navItems.map((item, index) => {
              const active = isActive(item.path);
              return (
                <div key={item.path}>
                  {showAdminHeading && index === adminHeadingIndex && (
                    <div className="relative group flex items-center justify-center px-2 py-2.5 text-purple-400"
                      aria-label="Admin" data-testid="nav-section-admin-collapsed">
                      <Shield size={18} />
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-[1010] -translate-y-1/2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium opacity-0 shadow-xl transition-opacity group-hover:opacity-100 ${
                          theme === "dark"
                            ? "border-white/10 bg-[#0a0a12] text-white"
                            : "border-gray-200 bg-white text-gray-700"
                        }`}
                      >
                        Admin
                      </span>
                    </div>
                  )}
                  <Link href={item.path}>
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
                </div>
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
              onClick={() => { void signOut().catch((error) => window.alert(error.message)); }}
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
              {showAdminHeading && idx === adminHeadingIndex && (
                <div className={`px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.18em] ${
                  theme === "dark" ? "text-purple-300/75" : "text-purple-600/75"
                }`} aria-label="Admin" data-testid="nav-section-admin">
                  Admin
                </div>
              )}
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
          onClick={() => { void signOut().catch((error) => window.alert(error.message)); }}
          className={`flex items-center gap-2 w-full px-2 py-2.5 rounded-xl transition-colors ${
            theme === "dark"
              ? "text-white/60 hover:text-red-400 hover:bg-red-500/10"
              : "text-gray-600 hover:text-red-600 hover:bg-red-50"
          }`}
          aria-label="Log Out"
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
      const pendingKeyName = "buildcustom:pending-project";
      const pending = JSON.parse(sessionStorage.getItem(pendingKeyName) || "null");
      const key = pending?.prompt === prompt && typeof pending?.key === "string" ? pending.key : crypto.randomUUID();
      sessionStorage.setItem(pendingKeyName, JSON.stringify({ key, prompt }));
      const token = await csrfToken();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, "Idempotency-Key": key, ...authHeaders() },
        body: JSON.stringify({ name: prompt.slice(0, 90), type: "website", description: prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create project");
      sessionStorage.removeItem(pendingKeyName);
      return { project: data, prompt, plan };
    },
    onSuccess: ({ project, prompt, plan }) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (project.runtimeStatus && project.runtimeStatus !== "ready") {
        navigate(`/app/project/${project.id}`);
        return;
      }
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

type RuntimeRelease = { id: number; commitHash: string; deploymentUrl?: string | null; publicAvailable?: boolean; createdAt: string };
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
type NativeConnectionRetry = {
  projectId: number;
  agentPrompt: string;
  images: ComposerImage[];
  lifecycle: number;
  continuationApproval?: { taskId: string; operationId: string; updatedAt: number };
  assistantMessageId?: string;
};
type SelectedElement = Record<string, unknown>;

function BuildActivity({
  projectId,
  theme,
  isBuilding,
  customerFacing = false,
  progressEvents = [],
  connectionState,
}: {
  projectId: number;
  theme: string;
  isBuilding: boolean;
  customerFacing?: boolean;
  progressEvents?: string[];
  connectionState?: string;
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
  const state = statusQuery.data?.state || {};
  const generation = state.generation || {};
  const generationStatus = generation.status || (isBuilding ? "running" : "idle");
  const latestTool = state.lastConversationResponse?.tool;
  const activePath = state.currentFile || latestTool?.args?.path;
  const summary = customerFacing
    ? "Working on your changes"
    : statusQuery.isError
    ? "Runtime activity is unavailable"
    : isBuilding
      ? activePath
        ? `${latestTool?.status === "success" ? "Updated" : "Writing"} ${activePath}`
        : `${statusQuery.data?.files || 0} files · Planning changes`
      : `${statusQuery.data?.files || 0} files · ${generationStatus}`;

  useEffect(() => {
    if (!isBuilding || customerFacing) return;
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
  }, [isBuilding, customerFacing, activePath, state.lastConversationResponse, summary]);

  useEffect(() => {
    if (!isBuilding || customerFacing || !activePath || openFile === activePath) return;
    setOpenFile(activePath);
    setLoadingFile(true);
    fetch(`/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(activePath)}`, { headers: authHeaders() })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        setFileContent(res.ok ? body.content : "The Agent is preparing this file.");
      })
      .catch(() => setFileContent("The Agent is preparing this file."))
      .finally(() => setLoadingFile(false));
  }, [isBuilding, customerFacing, activePath, projectId]);

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
          {!customerFacing && <div className={`grid grid-cols-2 gap-2 py-3 text-[11px] ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
            <span>Generation <b className={theme === "dark" ? "text-white/80" : "text-gray-800"}>{generationStatus}</b></span>
            <span>Connection <b className={theme === "dark" ? "text-white/80" : "text-gray-800"}>{connectionState || (statusQuery.data?.connected ? "connected" : "not connected")}</b></span>
          </div>}
          {!customerFacing && (steps.length > 0 || progressEvents.length > 0) && (
            <div className={`mb-3 space-y-1 border-l-2 pl-3 ${theme === "dark" ? "border-cyan-400/30" : "border-cyan-300"}`}>
              {[...steps, ...progressEvents].slice(-10).map((step, index, visibleSteps) => (
                <div key={`${index}-${step}`} className={`text-[11px] leading-relaxed ${
                  index === visibleSteps.length - 1
                    ? theme === "dark" ? "text-cyan-200" : "text-cyan-700"
                    : theme === "dark" ? "text-white/40" : "text-gray-500"
                }`}>
                  {step}
                </div>
              ))}
            </div>
          )}
          {!customerFacing && isBuilding && openFile && (
            <div className="mb-3">
              <div className={`mb-1 truncate font-mono text-[10px] ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>{openFile}</div>
              <pre className={`max-h-48 overflow-auto rounded-lg p-2 text-[10px] leading-relaxed ${theme === "dark" ? "bg-black/40 text-cyan-100/70" : "border border-gray-100 bg-white text-gray-600"}`}>
                {loadingFile ? "Loading current code…" : fileContent}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NativeBuildActivity({
  projectId,
  theme,
  phase,
  message,
  startedAt,
  events,
  connectionState,
}: {
  projectId: number;
  theme: string;
  phase: BuilderPhase;
  message: string;
  startedAt: number | null;
  events: BuildActivityEvent[];
  connectionState: string;
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const openFile = async (path: string) => {
    setSelectedFile(path);
    setFileContent(null);
    setFileLoading(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(path)}`,
        { credentials: "same-origin", headers: authHeaders(), cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Source content is unavailable.");
      setFileContent(typeof data.content === "string" ? data.content : "");
    } catch (error) {
      setFileContent(error instanceof Error ? error.message : "Source content is unavailable.");
    } finally {
      setFileLoading(false);
    }
  };

  return (
    <BuildActivityTimeline
      theme={theme}
      phase={phase}
      message={message || (phase === "idle" ? "Ready when you are." : "Waiting for runtime activity.")}
      startedAt={startedAt}
      events={events}
      connectionState={connectionState}
      currentFile={selectedFile}
      currentFileContent={fileContent}
      fileLoading={fileLoading}
      onOpenFile={(path) => void openFile(path)}
    />
  );
}

type NativeCompletionPhase = "idle" | "starting" | "running" | "recovering" | "stopping" | "paused" | "needs_input" | "success" | "error";

type NativeTaskLifecycle = {
  autoContinue?: { taskId: string; enabled: boolean; version: number; changedAt: number };
  status: string;
  customerStatus?: string;
  taskId?: string;
  operationId?: string;
  reason?: string;
  updatedAt: number;
};

const NATIVE_RECOVERY_WINDOW_MS = 10 * 60 * 1000;
const NATIVE_STREAM_QUIET_MS = 30_000;
const NATIVE_REVISION_STABILITY_MS = 5_000;
const NATIVE_RECOVERY_POLL_MS = 5_000;
const BUILDER_PLANNING_LOAD_TIMEOUT_MS = 5_000;

function nativeResourceLimitError(runtimeStatus: any, operationStartedAt?: number): string | null {
  const lifecycle = runtimeStatus?.nativeTaskLifecycle as NativeTaskLifecycle | undefined;
  if (lifecycle?.customerStatus === "CONTINUE_AVAILABLE") return null;
  if (typeof lifecycle?.status !== "string"
    || lifecycle.status.toUpperCase() !== "INCOMPLETE_RESOURCE_LIMIT"
    || typeof lifecycle.updatedAt !== "number"
    || !Number.isFinite(lifecycle.updatedAt)
    || (typeof operationStartedAt === "number" && lifecycle.updatedAt < operationStartedAt)) return null;
  return "This build paused before completion. Review your project or send another instruction.";
}

type NativeOperationBaseline = {
  revision: string | null;
  startedAt: number;
  promptAttempted: boolean;
  startingTurnCount?: number;
  promptDigest?: string;
  imageDigest?: string | null;
  approvedTaskId?: string;
  approvedOperationId?: string;
  lifecycleUpdatedAt?: number;
};

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function runtimeTurnsFromResponse(data: any): any[] | null {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.turns) ? data.turns : null;
}

function hasNativeOperationCorrelation(baseline: NativeOperationBaseline | null): baseline is NativeOperationBaseline & {
  startingTurnCount: number;
  promptDigest: string;
  imageDigest: string | null;
} {
  return Boolean(
    baseline
    && Number.isInteger(baseline.startingTurnCount)
    && (baseline.startingTurnCount as number) >= 0
    && typeof baseline.promptDigest === "string"
    && /^[a-f0-9]{64}$/.test(baseline.promptDigest)
    && (baseline.imageDigest === null || (typeof baseline.imageDigest === "string" && /^[a-f0-9]{64}$/.test(baseline.imageDigest))),
  );
}

async function hasCorrelatedNativeTurn(turns: any[], baseline: NativeOperationBaseline): Promise<boolean> {
  if (!hasNativeOperationCorrelation(baseline) || turns.length <= baseline.startingTurnCount) return false;
  const appended = turns.slice(baseline.startingTurnCount);
  const matches: any[] = [];
  for (const turn of appended) {
    if (typeof turn?.prompt !== "string" || typeof turn?.response !== "string" || !turn.response.trim()) continue;
    if (await sha256Hex(turn.prompt) !== baseline.promptDigest) continue;
    const persistedImages = Array.isArray(turn.images) ? turn.images
      : Array.isArray(turn.attachments) ? turn.attachments
        : [];
    if (baseline.imageDigest === null) {
      if (persistedImages.length > 0) continue;
    } else {
      if (persistedImages.length === 0 || persistedImages.some((image: any) => (
        typeof image?.filename !== "string"
        || typeof image?.mimeType !== "string"
        || typeof image?.size !== "number"
        || typeof image?.base64Data !== "string"
      ))) continue;
      const normalizedImages = persistedImages.map((image: any) => ({
        filename: image.filename,
        mimeType: image.mimeType,
        size: image.size,
        base64Data: image.base64Data,
      }));
      if (await sha256Hex(JSON.stringify(normalizedImages)) !== baseline.imageDigest) continue;
    }
    matches.push(turn);
  }
  return matches.length === 1;
}

async function hasNativeOperationEvidence(
  turns: any[],
  baseline: NativeOperationBaseline,
  runtimeStatus: any,
): Promise<boolean> {
  if (baseline.approvedTaskId && baseline.approvedOperationId && typeof baseline.lifecycleUpdatedAt === "number") {
    return hasFreshApprovedOperation(runtimeStatus?.nativeTaskLifecycle, {
      taskId: baseline.approvedTaskId,
      operationId: baseline.approvedOperationId,
      updatedAt: baseline.lifecycleUpdatedAt,
    });
  }
  return hasCorrelatedNativeTurn(turns, baseline);
}

function isCurrentStoppedLifecycle(lifecycle: NativeTaskLifecycle | undefined, baseline: NativeOperationBaseline | null): boolean {
  if (customerLifecycleStatus(lifecycle) !== "STOPPED") return false;
  if (!baseline) return true;
  if (!lifecycle || !Number.isFinite(lifecycle.updatedAt) || lifecycle.updatedAt < baseline.startedAt) return false;
  if (baseline.approvedTaskId && baseline.approvedOperationId && typeof baseline.lifecycleUpdatedAt === "number") {
    return hasFreshApprovedOperation(lifecycle, {
      taskId: baseline.approvedTaskId, operationId: baseline.approvedOperationId,
      updatedAt: baseline.lifecycleUpdatedAt,
    });
  }
  return true;
}

function nativeOperationStorageKey(projectId: number): string {
  return `buildcustom:native-operation:${projectId}`;
}

function readNativeOperationBaseline(projectId: number): NativeOperationBaseline | null {
  try {
    const raw = window.sessionStorage.getItem(nativeOperationStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.startedAt !== "number" || parsed.promptAttempted !== true
      || !(typeof parsed.revision === "string" || parsed.revision === null)) return null;
    return {
      revision: parsed.revision,
      startedAt: parsed.startedAt,
      promptAttempted: true,
      ...(Number.isInteger(parsed.startingTurnCount) ? { startingTurnCount: parsed.startingTurnCount } : {}),
      ...(typeof parsed.promptDigest === "string" ? { promptDigest: parsed.promptDigest } : {}),
      ...(typeof parsed.imageDigest === "string" || parsed.imageDigest === null ? { imageDigest: parsed.imageDigest } : {}),
    };
  } catch {
    return null;
  }
}

function writeNativeOperationBaseline(projectId: number, value: NativeOperationBaseline): void {
  try {
    window.sessionStorage.setItem(nativeOperationStorageKey(projectId), JSON.stringify(value));
  } catch {
    // Storage is only a recovery baseline; stock remains authoritative.
  }
}

function clearNativeOperationBaseline(projectId: number): void {
  try {
    window.sessionStorage.removeItem(nativeOperationStorageKey(projectId));
  } catch {
    // Ignore unavailable browser storage.
  }
}

function normalizeBuilderAssistantText(value: string): string {
  return value
    .replace(/using the question panel above/gi, "by replying in this chat")
    .replace(/question panel above/gi, "chat below")
    .replace(/question panel/gi, "chat")
    .replace(/\*\*(.*?)\*\*/g, "$1");
}

function EditorPage() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { publicGeneratedAppsEnabled } = usePublicCapabilities();
  const planEntitlement = getPlanEntitlement(getAppUser()?.plan);
  const [, routeParams] = useRoute("/app/editor/:id");
  const projectId = Number(routeParams?.id || 0);
  const [runtimeCapability, setRuntimeCapability] = useState<{ projectId: number; nativeThink: boolean; status: any } | null>(null);
  const [runtimeCapabilityError, setRuntimeCapabilityError] = useState("");
  const currentRuntimeCapability = runtimeCapability?.projectId === projectId ? runtimeCapability : null;
  const nativeThink = currentRuntimeCapability?.nativeThink === true;
  const nativeRuntimeReady = nativeThink && currentRuntimeCapability?.status?.runtimeStatus === "ready";
  const canPublishNative = Boolean(currentRuntimeCapability && nativeThink);
  const resourceLimitedOperation = nativeResourceLimitError(currentRuntimeCapability?.status);
  const runtimeGenerationStatus = String(currentRuntimeCapability?.status?.state?.generation?.status || "").toLowerCase();
  const currentNativeLifecycle = currentRuntimeCapability?.status?.nativeTaskLifecycle as NativeTaskLifecycle | undefined;
  const authoritativeBuildComplete = currentNativeLifecycle?.status === "COMPLETE"
    && customerLifecycleStatus(currentNativeLifecycle) === "BUILD_COMPLETE";
  const nativeRuntimeAlreadyWorking = nativeThink && (
    currentRuntimeCapability?.status?.state?.shouldBeGenerating === true
    || currentNativeLifecycle?.customerStatus === "WORKING"
    || (!resourceLimitedOperation
      && ["pending", "queued", "starting", "running", "building", "generating"].includes(runtimeGenerationStatus))
  );
  const canManageProduction = Boolean(currentRuntimeCapability && !nativeThink);
  const [chatInput, setChatInput] = useState("");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [messages, setMessages] = useState<{ id?: string; role: "user" | "assistant"; content: string }[]>([]);
  const [turns, setTurns] = useState<RuntimeBuilderTurn[]>([]);
  const [restoringTurnId, setRestoringTurnId] = useState<number | null>(null);
  const [openTurnFile, setOpenTurnFile] = useState<string | null>(null);
  const [turnFileContent, setTurnFileContent] = useState("");
  const [loadingTurnFile, setLoadingTurnFile] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [productionUrl, setProductionUrl] = useState("");
  const [nativeDeploymentComplete, setNativeDeploymentComplete] = useState(false);
  const [nativePublicAvailable, setNativePublicAvailable] = useState<boolean | null>(null);
  const [previewEnvironment, setPreviewEnvironment] = useState<"development" | "production">("development");
  const [publishing, setPublishing] = useState(false);
  const nativePublishingRef = useRef(false);
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
  const [nativeCompletionPhase, setNativeCompletionPhase] = useState<NativeCompletionPhase>("idle");
  const [autoContinueSaving, setAutoContinueSaving] = useState(false);
  const [nativeCompletionMessage, setNativeCompletionMessage] = useState("");
  const [nativeBuildFailure, setNativeBuildFailure] = useState<{
    errorCode: string | null;
    attemptId: string | null;
    lastSuccessfulStage: string | null;
    diagnosticsAvailable: boolean;
  } | null>(null);
  const [nativeRecoveryUnverified, setNativeRecoveryUnverified] = useState(false);
  const [nativeConnectionRetry, setNativeConnectionRetry] = useState<NativeConnectionRetry | null>(null);
  const [nativeProgress, setNativeProgress] = useState<BuildActivityEvent[]>(() => (
    typeof window === "undefined" || !projectId ? [] : readNativeActivitySnapshot(projectId).events
  ));
  const [nativeOperationStartedAt, setNativeOperationStartedAt] = useState<number | null>(() => (
    typeof window === "undefined" || !projectId ? null : readNativeActivitySnapshot(projectId).startedAt
  ));
  const [planningSession, setPlanningSession] = useState<PlanningSession | null>(null);
  const [planningLoaded, setPlanningLoaded] = useState(false);
  const [planningLoadError, setPlanningLoadError] = useState("");
  const [planningReloadKey, setPlanningReloadKey] = useState(0);
  const [planningSaving, setPlanningSaving] = useState(false);
  const [selectedClarificationOptions, setSelectedClarificationOptions] = useState<string[]>([]);
  const [selectedActivityFile, setSelectedActivityFile] = useState<string | null>(null);
  const [activityFileContent, setActivityFileContent] = useState<string | null>(null);
  const [activityFileLoading, setActivityFileLoading] = useState(false);
  const [nativeConnected, setNativeConnected] = useState(false);
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
  const sendAttemptRef = useRef(false);
  const stopConfirmedRef = useRef(false);
  const planningRequestRef = useRef(false);
  const planningPersistRef = useRef<Promise<void>>(Promise.resolve());
  const planningSessionRef = useRef<PlanningSession | null>(null);
  const planningLoadSequenceRef = useRef(0);
  const nativeProgressRef = useRef(nativeProgress);
  const nativeOperationStartedAtRef = useRef<number | null>(nativeOperationStartedAt);
  const nativeSocketRef = useRef<WebSocket | null>(null);
  const nativeIdleSocketRef = useRef<WebSocket | null>(null);
  const nativeIdleStopRef = useRef<() => void>(() => undefined);
  const nativeOperationControllerRef = useRef<AbortController | null>(null);
  const nativeCancelRef = useRef<() => void>(() => undefined);
  const continuationInFlightRef = useRef(false);
  const canOfferNativeContinuation = nativeThink
    && canContinueNativeTask(currentNativeLifecycle, nativeRuntimeAlreadyWorking)
    && !sending
    && !nativeRecoveryUnverified
    && !nativeOperationControllerRef.current
    && !continuationInFlightRef.current;
  const nativeLifecycleRef = useRef(0);
  const nativeMountedRef = useRef(false);
  const turnLoadSequenceRef = useRef(0);
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);

  const updatePlanningSession = (session: PlanningSession | null) => {
    planningSessionRef.current = session;
    setPlanningSession(session);
    setSelectedClarificationOptions([]);
    if (session) setMessages(session.messages);
  };

  const savePlanningSession = async (session: PlanningSession, updateConversation = true) => {
    setPlanningSaving(true);
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/projects/${projectId}/planning`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
        body: JSON.stringify({ session }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Your planning conversation could not be saved.");
      if (updateConversation) updatePlanningSession(session);
      else {
        planningSessionRef.current = session;
        setPlanningSession(session);
      }
      setRuntimeError("");
    } finally {
      setPlanningSaving(false);
    }
  };

  const deletePlanningSession = async () => {
    if (!projectId) return;
    await planningPersistRef.current;
    const token = await csrfToken();
    const response = await fetch(`/api/projects/${projectId}/planning`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": token, ...authHeaders() },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The saved planning conversation could not be cleared.");
    updatePlanningSession(null);
  };

  const markPlanningSubmitted = () => {
    const current = planningSessionRef.current;
    if (!current || current.phase === "submitted") return;
    const submitted: PlanningSession = { ...current, phase: "submitted", currentQuestion: null };
    planningSessionRef.current = submitted;
    setPlanningSession(submitted);
    planningPersistRef.current = savePlanningSession(submitted, false).catch((error) => {
      setRuntimeError(error instanceof Error
        ? `The build request was sent, but its planning record could not be updated: ${error.message}`
        : "The build request was sent, but its planning record could not be updated.");
    });
  };

  const restoreNativeActivity = (id: number) => {
    const snapshot = readNativeActivitySnapshot(id);
    nativeProgressRef.current = snapshot.events;
    nativeOperationStartedAtRef.current = snapshot.startedAt;
    setNativeProgress(snapshot.events);
    setNativeOperationStartedAt(snapshot.startedAt);
  };

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

  const scrollChatToBottom = (behavior: ScrollBehavior = "smooth") => {
    window.requestAnimationFrame(() => {
      const chat = chatScrollRef.current;
      if (chat) chat.scrollTo({ top: chat.scrollHeight, behavior });
    });
  };

  useEffect(() => {
    if (chatCollapsed) return;
    scrollChatToBottom(turns.length ? "smooth" : "auto");
  }, [turns.length, messages.length, messages.at(-1)?.content, runtimeError, sending, chatCollapsed]);

  useEffect(() => {
    if (chatCollapsed) return;
    const chat = chatScrollRef.current;
    if (!chat) return;
    const observer = new MutationObserver(() => scrollChatToBottom("smooth"));
    observer.observe(chat, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [chatCollapsed]);

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
    restoreNativeActivity(projectId);
    setSelectedActivityFile(null);
    setActivityFileContent(null);
    setPlanningLoaded(false);
    planningSessionRef.current = null;
    setPlanningSession(null);
    setProductionUrl("");
    setNativeDeploymentComplete(false);
    setNativePublicAvailable(null);
    setReleases([]);
    setSubdomainSlug("");
    setRuntimeCapabilityError("");
    const loadRuntime = async () => {
      try {
        const statusResponse = await fetch(`/api/projects/${projectId}/runtime/status`, { headers: authHeaders() });
        const status = await statusResponse.json().catch(() => ({}));
        if (cancelled) return;
        if (!statusResponse.ok) throw new Error(status.message || "Project status is unavailable.");
        const isNativeThink = status.nativeThink === true;
        setRuntimeCapability({ projectId, nativeThink: isNativeThink, status });
        if (isNativeThink) {
          setProductionUrl("");
          if (status.deploymentUrl || status.publicAvailable === true
            || status.published === true || status.deploymentComplete === true) {
            setNativeDeploymentComplete(true);
          }
          if (typeof status.publicAvailable === "boolean") setNativePublicAvailable(status.publicAvailable);
          setPreviewEnvironment("development");
          const nativePreviewUrl = status.previewUrl || status.previewURL || status.state?.previewUrl || status.state?.previewURL;
          setPreviewUrl(typeof nativePreviewUrl === "string" ? nativePreviewUrl : "");
          return;
        }
        if (status.deploymentUrl) setProductionUrl(status.deploymentUrl);
        if (status.runtimeStatus) return;
        const token = await csrfToken();
        const previewResponse = await fetch(`/api/projects/${projectId}/runtime/previews`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
          body: JSON.stringify({}),
        });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!cancelled && previewResponse.ok) {
          setPreviewUrl(preview.url || preview.previewUrl || "");
          setPreviewRevision((revision) => revision + 1);
        }
      } catch {
        if (!cancelled) setRuntimeCapabilityError("Project status is unavailable. Refresh and try again.");
      }
    };
    loadRuntime();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !nativeThink || !nativeRuntimeReady) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: number | null = null;
    const refreshLifecycle = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/runtime/status`, {
          credentials: "same-origin",
          headers: authHeaders(),
          signal: controller.signal,
        });
        const status = await response.json().catch(() => ({}));
        if (!response.ok || cancelled || activeProjectIdRef.current !== projectId) return;
        setRuntimeCapability({ projectId, nativeThink: true, status });
        const customerStatus = customerLifecycleStatus(status.nativeTaskLifecycle);
        // The old boundary is still authoritative while an approval is pending.
        // It must not cancel the socket before the new operation is accepted.
        if (continuationInFlightRef.current && customerStatus === "CONTINUE_AVAILABLE") return;
        if (customerStatus === "WORKING" && !continuationInFlightRef.current) {
          setNativeCompletionPhase("running");
          setNativeCompletionMessage("Working");
        }
        if (customerStatus === "CONTINUE_AVAILABLE" && !sending && !nativeOperationControllerRef.current) {
          setNativeCompletionPhase("paused");
          setNativeCompletionMessage("I made progress on your request, but I haven't finished everything yet. Would you like me to continue working?");
          setNativeRecoveryUnverified(false);
          setRuntimeError("");
          setSending(false);
        } else if (customerStatus === "NEEDS_INPUT" && !sending && !nativeOperationControllerRef.current) {
          setNativeCompletionPhase("needs_input");
          setNativeCompletionMessage("Needs your input");
          setNativeRecoveryUnverified(false);
          setSending(false);
        } else if (customerStatus === "BUILD_COMPLETE"
          && status.nativeTaskLifecycle?.status === "COMPLETE"
          && status.state?.shouldBeGenerating !== true
          && !["pending", "queued", "starting", "running", "building", "generating"].includes(
            String(status.state?.generation?.status || "").toLowerCase(),
          )
          && !sending
          && !readNativeOperationBaseline(projectId)
          && !nativeOperationControllerRef.current) {
          setNativeCompletionPhase("success");
          setNativeCompletionMessage("Your changes are ready to review.");
          setNativeRecoveryUnverified(false);
          setRuntimeError("");
          setSending(false);
        } else if (isCurrentStoppedLifecycle(status.nativeTaskLifecycle, readNativeOperationBaseline(projectId))) {
          // Terminal owner state also settles an open/recovering stream. This
          // cancels only local observation, never the stopped native operation.
          nativeCancelRef.current();
          nativeOperationControllerRef.current?.abort();
          nativeOperationControllerRef.current = null;
          clearNativeOperationBaseline(projectId);
          setNativeCompletionPhase("error");
          setNativeCompletionMessage("This build stopped before completion.");
          setNativeRecoveryUnverified(false);
          setRuntimeError("");
          setSending(false);
        }
      } catch {
        // A transient status failure does not change the current customer-facing state.
      } finally {
        if (!cancelled) timer = window.setTimeout(refreshLifecycle, 3000);
      }
    };
    void refreshLifecycle();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [projectId, nativeThink, nativeRuntimeReady, nativeCompletionPhase, sending, canOfferNativeContinuation]);

  useEffect(() => {
    const lifecycle = ++nativeLifecycleRef.current;
    nativeMountedRef.current = true;
    return () => {
      nativeMountedRef.current = false;
      if (nativeLifecycleRef.current === lifecycle) nativeLifecycleRef.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      nativeOperationControllerRef.current?.abort();
      nativeOperationControllerRef.current = null;
      nativeCancelRef.current();
      nativeIdleStopRef.current();
      nativeSocketRef.current?.close(1000, "Project view closed");
      nativeSocketRef.current = null;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !nativeRuntimeReady || sending) return;
    const idleProjectId = projectId;
    let active = true;
    let retryCount = 0;
    let retryTimer: number | null = null;
    let connectionTimer: number | null = null;
    let stabilityTimer: number | null = null;
    let socket: WebSocket | null = null;

    const stop = () => {
      if (!active) return;
      active = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (connectionTimer !== null) window.clearTimeout(connectionTimer);
      if (stabilityTimer !== null) window.clearTimeout(stabilityTimer);
      retryTimer = null;
      connectionTimer = null;
      stabilityTimer = null;
      socket?.close(1000, "Idle native connection stopped");
      if (nativeIdleSocketRef.current === socket) nativeIdleSocketRef.current = null;
      socket = null;
      if (nativeIdleStopRef.current === stop) nativeIdleStopRef.current = () => undefined;
      if (activeProjectIdRef.current === idleProjectId) setNativeConnected(false);
    };
    nativeIdleStopRef.current = stop;

    const scheduleRetry = () => {
      if (!active || retryTimer !== null || retryCount >= 5) return;
      retryCount += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, Math.min(2 ** retryCount * 1000, 30_000));
    };
    const connect = () => {
      if (!active || activeProjectIdRef.current !== idleProjectId) return;
      const websocketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socketUrl = `${websocketProtocol}//${window.location.host}/api/projects/${idleProjectId}/runtime/ws`;
      try {
        const nextSocket = new WebSocket(socketUrl);
        socket = nextSocket;
        nativeIdleSocketRef.current = nextSocket;
        connectionTimer = window.setTimeout(() => {
          if (active && socket === nextSocket && nextSocket.readyState === WebSocket.CONNECTING) {
            nextSocket.close();
          }
        }, 30_000);
        nextSocket.onopen = () => {
          if (!active || activeProjectIdRef.current !== idleProjectId || socket !== nextSocket) {
            nextSocket.close(1000, "Stale native project connection");
            return;
          }
          if (connectionTimer !== null) window.clearTimeout(connectionTimer);
          connectionTimer = null;
          stabilityTimer = window.setTimeout(() => {
            stabilityTimer = null;
            if (active && socket === nextSocket && nextSocket.readyState === WebSocket.OPEN) retryCount = 0;
          }, 30_000);
          setNativeConnected(true);
          try {
            nextSocket.send(JSON.stringify({ type: "get_conversation_state" }));
          } catch {
            nextSocket.close();
          }
        };
        nextSocket.onclose = () => {
          if (connectionTimer !== null) window.clearTimeout(connectionTimer);
          if (stabilityTimer !== null) window.clearTimeout(stabilityTimer);
          connectionTimer = null;
          stabilityTimer = null;
          if (!active || socket !== nextSocket) return;
          if (nativeIdleSocketRef.current === nextSocket) nativeIdleSocketRef.current = null;
          socket = null;
          if (activeProjectIdRef.current === idleProjectId) setNativeConnected(false);
          scheduleRetry();
        };
        nextSocket.onerror = () => nextSocket.close();
      } catch {
        scheduleRetry();
      }
    };
    connect();
    return stop;
  }, [projectId, nativeRuntimeReady, sending]);

  useEffect(() => {
    if (!projectId || !nativeThink || nativeRuntimeReady) return;
    let cancelled = false;
    let requestInFlight = false;
    let requestController: AbortController | null = null;
    const pollReadiness = async () => {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;
      const controller = new AbortController();
      requestController = controller;
      try {
        const response = await fetch(`/api/projects/${projectId}/runtime/status`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        const status = await response.json().catch(() => ({}));
        if (!cancelled && response.ok && status.nativeThink === true
          && activeProjectIdRef.current === projectId) {
          setRuntimeCapability({ projectId, nativeThink: true, status });
          if (status.runtimeStatus === "ready") {
            const nativePreviewUrl = status.previewUrl || status.previewURL
              || status.state?.previewUrl || status.state?.previewURL;
            if (typeof nativePreviewUrl === "string") setPreviewUrl(nativePreviewUrl);
            setPreviewEnvironment("development");
          }
        }
      } catch {
        // Keep waiting for the native runtime to report readiness.
      } finally {
        if (requestController === controller) requestController = null;
        requestInFlight = false;
      }
    };
    const poll = window.setInterval(() => { void pollReadiness(); }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      requestController?.abort();
    };
  }, [projectId, nativeThink, nativeRuntimeReady]);

  useEffect(() => {
    if (!projectId || !nativeThink || !resourceLimitedOperation
      || currentRuntimeCapability?.status?.state?.shouldBeGenerating !== true) return;
    let cancelled = false;
    let requestInFlight = false;
    let controller: AbortController | null = null;
    const refreshTerminalStatus = async () => {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch(`/api/projects/${projectId}/runtime/status`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          cancelled = true; // No authentication retries; a manual reopen is required.
          return;
        }
        const status = await response.json().catch(() => ({}));
        if (!cancelled && response.ok && status.nativeThink === true
          && activeProjectIdRef.current === projectId) {
          setRuntimeCapability({ projectId, nativeThink: true, status });
        }
      } catch {
        // Keep input disabled until a successful owner-status read confirms idle.
      } finally {
        requestInFlight = false;
        controller = null;
      }
    };
    void refreshTerminalStatus();
    const poll = window.setInterval(() => { void refreshTerminalStatus(); }, NATIVE_RECOVERY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      controller?.abort();
    };
  }, [
    projectId,
    nativeThink,
    resourceLimitedOperation,
    currentRuntimeCapability?.status?.state?.shouldBeGenerating,
  ]);

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
    if (response.ok) {
      const releaseRows = Array.isArray(data.releases) ? data.releases : [];
      const latestRelease = releaseRows[0];
      const nextReleases = releaseRows.map((release: RuntimeRelease) => {
        const { deploymentUrl: _privateDeploymentUrl, ...safeRelease } = release;
        return safeRelease;
      });
      setReleases(nextReleases);
      if (activeProjectIdRef.current === projectId && releaseRows.length > 0) {
        setNativeDeploymentComplete(true);
        if (typeof latestRelease?.publicAvailable === "boolean") setNativePublicAvailable(latestRelease.publicAvailable);
      }
    }
  };

  useEffect(() => {
    loadReleases().catch(() => undefined);
  }, [projectId]);

  const loadTurns = async () => {
    if (!projectId) return;
    const sequence = ++turnLoadSequenceRef.current;
    const response = await fetch(`/api/projects/${projectId}/runtime/turns`, { headers: authHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Conversation history is unavailable.");
    if (sequence === turnLoadSequenceRef.current) setTurns(Array.isArray(data) ? data : data.turns || []);
  };

  useEffect(() => {
    requestController.current?.abort();
    requestController.current = null;
    setSending(false);
    sendAttemptRef.current = false;
    setNativeCompletionPhase("idle");
    setNativeCompletionMessage("");
    setNativeRecoveryUnverified(false);
    setTurns([]);
    setMessages([]);
    setChatInput("");
    setRuntimeError("");
    restoreNativeActivity(projectId);
    setNativeConnected(false);
    setPlanMode(false);
    setPendingPlan("");
    setAttachments([]);
    setTextContext([]);
    setSelectedElement(null);
    loadTurns().catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || currentRuntimeCapability?.projectId !== projectId) return;
    const sequence = ++planningLoadSequenceRef.current;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), BUILDER_PLANNING_LOAD_TIMEOUT_MS);
    setPlanningLoaded(false);
    setPlanningLoadError("");
    const loadPlanningSession = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/planning`, {
          credentials: "same-origin",
          headers: authHeaders(),
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 404) {
          setPlanningLoadError("");
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Saved planning could not be restored.");
        if (cancelled || sequence !== planningLoadSequenceRef.current) return;
        setPlanningLoadError("");
        if (data.session !== null && data.session !== undefined) {
          if (!isValidPlanningSession(data.session)) throw new Error("Saved planning data is invalid.");
          updatePlanningSession(data.session);
        } else {
          updatePlanningSession(null);
        }
      } catch {
        if (!cancelled && sequence === planningLoadSequenceRef.current) {
          setPlanningLoadError("Saved planning could not be restored. You can still reply in this chat.");
        }
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled && sequence === planningLoadSequenceRef.current) setPlanningLoaded(true);
      }
    };
    void loadPlanningSession();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [projectId, currentRuntimeCapability?.projectId, planningReloadKey]);

  useEffect(() => {
    if (!nativeThink) return;
    loadTurns().catch((error: any) => setRuntimeError(error.message || "Conversation history is unavailable."));
  }, [projectId, nativeThink]);

  useEffect(() => {
    if (!projectId || !nativeThink || !currentRuntimeCapability) return;
    const savedBaseline = readNativeOperationBaseline(projectId);
    const status = currentRuntimeCapability.status || {};
    const state = status.state || {};
    const openedCustomerStatus = customerLifecycleStatus(status.nativeTaskLifecycle);
    if (openedCustomerStatus === "CONTINUE_AVAILABLE") {
      setNativeCompletionPhase("paused");
      setNativeCompletionMessage("I made progress on your request, but I haven't finished everything yet. Would you like me to continue working?");
      setNativeRecoveryUnverified(false);
      setRuntimeError("");
      setSending(false);
      return;
    }
    if (openedCustomerStatus === "NEEDS_INPUT") {
      setNativeCompletionPhase("needs_input");
      setNativeCompletionMessage("Needs your input");
      setNativeRecoveryUnverified(false);
      setSending(false);
      return;
    }
    if (openedCustomerStatus === "STOPPED" || String(status.nativeTaskLifecycle?.status || "").toUpperCase() === "BLOCKED") {
      setNativeCompletionPhase("error");
      setNativeCompletionMessage("This build stopped before completion.");
      setNativeRecoveryUnverified(false);
      setRuntimeError("");
      setSending(false);
      return;
    }
    if (openedCustomerStatus === "BUILD_COMPLETE"
      && status.nativeTaskLifecycle?.status === "COMPLETE"
      && state.shouldBeGenerating !== true
      && !["pending", "queued", "starting", "running", "building", "generating"].includes(
        String(state.generation?.status || state.generationStatus || state.status || "").toLowerCase(),
      )
      && !savedBaseline) {
      setNativeCompletionPhase("success");
      setNativeCompletionMessage("Your changes are ready to review.");
      setNativeRecoveryUnverified(false);
      setSending(false);
      return;
    }
    const generationStatus = String(state.generation?.status || state.generationStatus || state.status || "").toLowerCase();
    const runtimeActive = state.shouldBeGenerating === true
      || ["pending", "queued", "starting", "running", "building", "generating"].includes(generationStatus);
    if (!savedBaseline) {
      const terminalError = nativeResourceLimitError(status);
      if (terminalError) {
        setNativeCompletionPhase("error");
        setNativeCompletionMessage(terminalError);
        setNativeRecoveryUnverified(false);
        setRuntimeError(terminalError);
        setSending(false);
        return;
      }
      if (!runtimeActive) return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const recoveryStartedAt = Date.now();
    const recoveryDeadline = recoveryStartedAt + NATIVE_RECOVERY_WINDOW_MS;
    let recoveryWaitTimer: number | null = null;
    let finishRecoveryWait: (() => void) | null = null;
    const wait = (ms: number) => new Promise<void>((resolve) => {
      finishRecoveryWait = () => {
        if (recoveryWaitTimer !== null) window.clearTimeout(recoveryWaitTimer);
        recoveryWaitTimer = null;
        finishRecoveryWait = null;
        resolve();
      };
      recoveryWaitTimer = window.setTimeout(() => finishRecoveryWait?.(), ms);
    });
    const fetchRuntime = async (path: string, init?: RequestInit) => {
      const response = await fetch(`/api/projects/${projectId}/runtime/${path}`, {
        credentials: "same-origin",
        ...init,
        signal: controller.signal,
        headers: { ...authHeaders(), ...(init?.headers || {}) },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = response.status === 401
          ? `The runtime returned HTTP 401 while checking ${path.replaceAll("/", " ")}. The build outcome is unverified.`
          : body.message || `Unable to load ${path.replaceAll("/", " ")}.`;
        throw new Error(message);
      }
      return body;
    };
    const isIdle = (runtimeStatus: any) => {
      const runtimeState = runtimeStatus?.state || {};
      const generation = String(
        runtimeState.generation?.status
          || runtimeState.generationStatus
          || runtimeState.generation_status
          || runtimeStatus?.generation?.status
          || runtimeStatus?.generationStatus
          || runtimeStatus?.status
          || "",
      ).toLowerCase();
      const shouldGenerate = typeof runtimeState.shouldBeGenerating === "boolean"
        ? runtimeState.shouldBeGenerating
        : runtimeStatus?.shouldBeGenerating;
      return shouldGenerate === false && ["idle", "complete", "completed", "success", "succeeded"].includes(generation);
    };
    const terminalRuntimeError = (runtimeStatus: any): string | null => {
      const resourceLimitError = nativeResourceLimitError(runtimeStatus, savedBaseline?.startedAt);
      if (resourceLimitError) return resourceLimitError;
      const runtimeState = runtimeStatus?.state || {};
      const generation = String(
        runtimeState.generation?.status
          || runtimeState.generationStatus
          || runtimeState.generation_status
          || runtimeStatus?.generation?.status
          || runtimeStatus?.generationStatus
          || "",
      ).toLowerCase();
      return ["failed", "error", "stopped", "cancelled", "canceled"].includes(generation)
        ? "This build stopped before completion. Review the project and try again."
        : null;
    };
    const reconcile = async () => {
      if (!savedBaseline) {
        setNativeCompletionPhase("error");
        setNativeCompletionMessage("This Agent was already working when the editor opened. No request was sent, but this session cannot verify its starting revision. Refresh to check its latest state.");
        setNativeRecoveryUnverified(true);
        setRuntimeError("The existing Agent operation has no saved revision baseline. It was not restarted.");
        setSending(false);
        return;
      }
      const baselineCorrelatable = hasNativeOperationCorrelation(savedBaseline);
      setSending(true);
      setNativeCompletionPhase("recovering");
      setNativeCompletionMessage("Reopened during a build · checking stock runtime state…");
      setRuntimeError("");
      recordNativeProgress("Reopened editor · reconciling the existing Agent operation");
      let candidateRevision: string | null = null;
      let candidateSince = 0;
      let lastError = baselineCorrelatable
        ? "The existing Agent operation could not yet be verified."
        : "The saved operation is missing its authoritative turn-count or prompt digest baseline.";

      while (!cancelled && Date.now() < recoveryDeadline) {
        try {
          const [runtimeStatus, revisionData] = await Promise.all([
            fetchRuntime("status"),
            fetchRuntime("revision"),
          ]);
          if (cancelled || activeProjectIdRef.current !== projectId) return;
          const customerStatus = customerLifecycleStatus(runtimeStatus.nativeTaskLifecycle);
          if (customerStatus === "CONTINUE_AVAILABLE" || customerStatus === "NEEDS_INPUT"
            || isCurrentStoppedLifecycle(runtimeStatus.nativeTaskLifecycle, savedBaseline)) {
            setRuntimeCapability({ projectId, nativeThink: true, status: runtimeStatus });
            clearNativeOperationBaseline(projectId);
            setNativeCompletionPhase(customerStatus === "CONTINUE_AVAILABLE" ? "paused"
              : customerStatus === "NEEDS_INPUT" ? "needs_input" : "error");
            setNativeCompletionMessage(customerStatus === "CONTINUE_AVAILABLE"
              ? "I made progress on your request, but I haven't finished everything yet. Would you like me to continue working?"
              : customerStatus === "NEEDS_INPUT" ? "Needs your input" : "This build stopped before completion.");
            setNativeRecoveryUnverified(false);
            setRuntimeError("");
            setSending(false);
            return;
          }
          const terminalError = terminalRuntimeError(runtimeStatus);
          if (terminalError) {
            setRuntimeCapability({ projectId, nativeThink: true, status: runtimeStatus });
            clearNativeOperationBaseline(projectId);
            setNativeCompletionPhase("error");
            setNativeCompletionMessage(terminalError);
            setNativeRecoveryUnverified(false);
            setRuntimeError(terminalError);
            setSending(false);
            return;
          }
          if (!isIdle(runtimeStatus)) {
            candidateRevision = null;
            candidateSince = 0;
            setNativeCompletionMessage("The existing Agent is still working · checking again…");
          } else {
            const revision = typeof revisionData.commitHash === "string" ? revisionData.commitHash : null;
            if (!revision || revision === savedBaseline.revision) {
              candidateRevision = null;
              candidateSince = 0;
              lastError = "The Agent is idle, but there is no new committed revision for the saved operation.";
            } else if (candidateRevision !== revision) {
              candidateRevision = revision;
              candidateSince = Date.now();
              setNativeCompletionMessage("The Agent is idle · confirming its committed revision is stable…");
            } else if (Date.now() - candidateSince >= NATIVE_STREAM_QUIET_MS) {
              const [filesData, finalStatus, finalRevision] = await Promise.all([
                fetchRuntime("files"),
                fetchRuntime("status"),
                fetchRuntime("revision"),
              ]);
              if (cancelled || activeProjectIdRef.current !== projectId) return;
              const files = Array.isArray(filesData) ? filesData : Array.isArray(filesData.files) ? filesData.files : [];
              if (isIdle(finalStatus) && files.length > 0 && finalRevision.commitHash === candidateRevision) {
                if (!baselineCorrelatable) throw new Error(lastError);
                const turnsBeforePreview = runtimeTurnsFromResponse(await fetchRuntime("turns"));
                if (cancelled || activeProjectIdRef.current !== projectId) return;
                if (!turnsBeforePreview || !await hasNativeOperationEvidence(turnsBeforePreview, savedBaseline, finalStatus)) {
                  throw new Error("The changed revision is not yet correlated with this operation's appended prompt turn and assistant response.");
                }
                const previewState = finalStatus.state || {};
                const deployedCommit = previewState.lastDeployedCommit || finalStatus.lastDeployedCommit;
                const signedPreview = finalStatus.previewUrl || finalStatus.previewURL
                  || previewState.previewUrl || previewState.previewURL || "";
                let finalPreview = deployedCommit === candidateRevision && typeof signedPreview === "string" ? signedPreview : "";
                if (!finalPreview) {
                  const token = await csrfToken();
                  const preview = await fetchRuntime("previews", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
                    body: JSON.stringify({}),
                  });
                  finalPreview = typeof preview.url === "string" ? preview.url : typeof preview.previewUrl === "string" ? preview.previewUrl : "";
                }
                if (!finalPreview) throw new Error("A preview URL is not available for the verified revision.");
                const [turnsData, lastStatus, lastRevision] = await Promise.all([
                  fetchRuntime("turns"),
                  fetchRuntime("status"),
                  fetchRuntime("revision"),
                ]);
                if (cancelled || activeProjectIdRef.current !== projectId) return;
                const finalError = terminalRuntimeError(lastStatus);
                if (finalError) {
                  setRuntimeCapability({ projectId, nativeThink: true, status: lastStatus });
                  clearNativeOperationBaseline(projectId);
                  setNativeCompletionPhase("error");
                  setNativeCompletionMessage(finalError);
                  setNativeRecoveryUnverified(false);
                  setRuntimeError(finalError);
                  setSending(false);
                  return;
                }
                if (!isIdle(lastStatus) || lastRevision.commitHash !== candidateRevision) {
                  candidateRevision = null;
                  candidateSince = 0;
                  lastError = "The runtime changed while its completed revision was being verified.";
                } else {
                  const finalTurns = runtimeTurnsFromResponse(turnsData);
                  if (!finalTurns || !await hasNativeOperationEvidence(finalTurns, savedBaseline, lastStatus)) {
                    lastError = "No newly appended user turn with this prompt fingerprint and a completed assistant response is verified yet.";
                  } else {
                    const [verifiedStatus, verifiedRevision] = await Promise.all([
                      fetchRuntime("status"),
                      fetchRuntime("revision"),
                    ]);
                    if (cancelled || activeProjectIdRef.current !== projectId) return;
                    const verifiedError = terminalRuntimeError(verifiedStatus);
                    if (verifiedError) {
                      setRuntimeCapability({ projectId, nativeThink: true, status: verifiedStatus });
                      clearNativeOperationBaseline(projectId);
                      setNativeCompletionPhase("error");
                      setNativeCompletionMessage(verifiedError);
                      setNativeRecoveryUnverified(false);
                      setRuntimeError(verifiedError);
                      setSending(false);
                      return;
                    }
                    if (!isIdle(verifiedStatus)
                      || verifiedStatus?.nativeTaskLifecycle?.status !== "COMPLETE"
                      || customerLifecycleStatus(verifiedStatus?.nativeTaskLifecycle) !== "BUILD_COMPLETE"
                      || typeof verifiedStatus?.nativeTaskLifecycle?.updatedAt !== "number"
                      || verifiedStatus.nativeTaskLifecycle.updatedAt < savedBaseline.startedAt
                      || verifiedRevision.commitHash !== candidateRevision) {
                      candidateRevision = null;
                      candidateSince = 0;
                      lastError = "The runtime changed after turn correlation and preview verification.";
                    } else {
                      setTurns(finalTurns);
                      setRuntimeCapability({ projectId, nativeThink: true, status: verifiedStatus });
                      setPreviewUrl(finalPreview);
                      setPreviewEnvironment("development");
                      setPreviewRevision((previous) => previous + 1);
                      queryClient.invalidateQueries({ queryKey: ["runtime-status", projectId] });
                      queryClient.invalidateQueries({ queryKey: ["runtime-files", projectId] });
                      queryClient.invalidateQueries({ queryKey: ["runtime-file-content", projectId] });
                      clearNativeOperationBaseline(projectId);
                      setRuntimeError("");
                      setNativeCompletionPhase("success");
                      setNativeCompletionMessage("Your changes are ready to review.");
                      setNativeRecoveryUnverified(false);
                      recordNativeProgress(`${files.length} project files verified · preview ready`);
                      setSending(false);
                      return;
                    }
                  }
                }
              } else {
                candidateRevision = null;
                candidateSince = 0;
                lastError = "The runtime is not yet stably idle with the same committed files.";
              }
            }
          }
        } catch (error: any) {
          if (cancelled || error?.name === "AbortError") return;
          lastError = error?.message || lastError;
        }
        await wait(NATIVE_RECOVERY_POLL_MS);
      }

      if (cancelled) return;
      setNativeCompletionPhase("error");
      setNativeCompletionMessage(`BuildCustom could not verify the last operation before the recovery window ended. Your project may still have saved work. Refresh the editor to check the latest stock state. ${lastError}`);
      setNativeRecoveryUnverified(true);
      setRuntimeError("The operation's final state is still unverified. Refresh to check the latest project state; no request was resent.");
      setSending(false);
    };

    void reconcile();
    return () => {
      cancelled = true;
      controller.abort();
      finishRecoveryWait?.();
    };
  }, [projectId, nativeThink]);

  const setNativeActivityStart = (startedAt: number | null) => {
    nativeOperationStartedAtRef.current = startedAt;
    setNativeOperationStartedAt(startedAt);
    writeNativeActivitySnapshot(projectId, {
      events: nativeProgressRef.current,
      startedAt,
    });
  };

  const recordNativeProgress = (
    label: string,
    status: BuildActivityEvent["status"] = "info",
    path?: string,
  ) => {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    const current = nativeProgressRef.current;
    const last = current[current.length - 1];
    if (last?.label === cleanLabel && last.status === status && last.path === path
      && Date.now() - last.observedAt < 1500) return;
    const event: BuildActivityEvent = {
      id: `${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: cleanLabel.slice(0, 300),
      observedAt: Date.now(),
      status,
      ...(path ? { path: path.slice(0, 500) } : {}),
    };
    const next = [...current, event].slice(-MAX_NATIVE_ACTIVITY_EVENTS);
    nativeProgressRef.current = next;
    setNativeProgress(next);
    writeNativeActivitySnapshot(projectId, {
      events: next,
      startedAt: nativeOperationStartedAtRef.current,
    });
  };

  const streamNativeTurn = async (
    agentPrompt: string,
    images: ComposerImage[],
    lifecycle: number,
    continuationApproval?: { taskId: string; operationId: string; updatedAt: number },
    assistantMessageId?: string,
  ) => {
    setNativeConnectionRetry(null);
    nativeIdleStopRef.current();
    const operationController = new AbortController();
    nativeOperationControllerRef.current = operationController;
    const isOperationActive = () => nativeMountedRef.current
      && nativeLifecycleRef.current === lifecycle
      && activeProjectIdRef.current === projectId;
    const [baselineResponse, turnsResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/runtime/revision`, {
        credentials: "same-origin",
        headers: authHeaders(),
        signal: operationController.signal,
      }),
      fetch(`/api/projects/${projectId}/runtime/turns`, {
        credentials: "same-origin",
        headers: authHeaders(),
        signal: operationController.signal,
      }),
    ]);
    const [baselineData, startingTurnsData] = await Promise.all([
      baselineResponse.json().catch(() => ({})),
      turnsResponse.json().catch(() => ({})),
    ]);
    if (!isOperationActive()) {
      operationController.abort();
      return;
    }
    if (!baselineResponse.ok) {
      throw new Error(baselineData.message || "Unable to read the current runtime revision. Your prompt was not sent.");
    }
    if (!turnsResponse.ok) {
      throw new Error(startingTurnsData.message || "Unable to read the current conversation turns. Your prompt was not sent.");
    }
    const startingTurns = runtimeTurnsFromResponse(startingTurnsData);
    if (!startingTurns) throw new Error("The current authoritative conversation turns could not be verified. Your prompt was not sent.");
    let lifecycleUpdatedAt: number | undefined;
    if (continuationApproval) {
      const statusResponse = await fetch(`/api/projects/${projectId}/runtime/status`, {
        credentials: "same-origin",
        headers: authHeaders(),
        signal: operationController.signal,
      });
      const latestStatus = await statusResponse.json().catch(() => ({}));
      const latestLifecycle = latestStatus?.nativeTaskLifecycle as NativeTaskLifecycle | undefined;
      const latestGeneration = String(latestStatus?.state?.generation?.status
        || latestStatus?.state?.generationStatus || latestStatus?.state?.status || "").toLowerCase();
      const latestWorking = latestStatus?.state?.shouldBeGenerating === true
        || ["pending", "queued", "starting", "running", "building", "generating"].includes(latestGeneration);
      if (!statusResponse.ok
        || !canContinueNativeTask(latestLifecycle, latestWorking)
        || latestLifecycle.taskId !== continuationApproval.taskId
        || latestLifecycle.operationId !== continuationApproval.operationId
        || latestLifecycle.updatedAt !== continuationApproval.updatedAt) {
        throw new Error("This continuation is no longer available. Refresh the project status and try again.");
      }
      lifecycleUpdatedAt = latestLifecycle.updatedAt;
    }
    const promptDigest = await sha256Hex(agentPrompt);
    let imageDigest: string | null = null;
    if (images.length) {
      if (images.some((image) => typeof image.base64Data !== "string" || !image.base64Data
        || typeof image.filename !== "string" || typeof image.mimeType !== "string" || typeof image.size !== "number")) {
        throw new Error("The attached image turn cannot be fingerprinted safely. Your prompt was not sent.");
      }
      imageDigest = await sha256Hex(JSON.stringify(images.map((image) => ({
        filename: image.filename,
        mimeType: image.mimeType,
        size: image.size,
        base64Data: image.base64Data,
      }))));
    }
    if (!isOperationActive()) {
      operationController.abort();
      return;
    }
    const baselineCommitHash = typeof baselineData.commitHash === "string"
      ? baselineData.commitHash
      : typeof baselineData.revision?.commitHash === "string" ? baselineData.revision.commitHash : null;
    const startedAt = Date.now();
    const operationBaseline: NativeOperationBaseline = {
      revision: baselineCommitHash,
      startedAt,
      promptAttempted: false,
      startingTurnCount: startingTurns.length,
      promptDigest,
      imageDigest,
      ...(continuationApproval ? {
        approvedTaskId: continuationApproval.taskId,
        approvedOperationId: continuationApproval.operationId,
        lifecycleUpdatedAt,
      } : {}),
    };
    writeNativeOperationBaseline(projectId, operationBaseline);

    const websocketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socketUrl = `${websocketProtocol}//${window.location.host}/api/projects/${projectId}/runtime/ws`;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketUrl);
      nativeSocketRef.current = socket;
      let lastFrameAt = startedAt;
      let frameSequence = 0;
      let generationComplete = false;
      let assistantStreaming = false;
      let suggestionSent = false;
      let promptAttempted = false;
      let recoveryStarted = false;
      let finished = false;
      let settleTimer: number | null = null;
      let settling = false;
      let settleAgain = false;
      let revisionCandidate: { commitHash: string; checkedAt: number; frameSequence: number } | null = null;
      const activeWork = new Set<string>();
      let settlementWaitReason = "The Agent did not reach a verifiable idle state.";
      const cancelForLifecycle = () => {
        if (finished) return;
        finished = true;
        if (settleTimer !== null) window.clearTimeout(settleTimer);
        operationController.abort();
        if (nativeOperationControllerRef.current === operationController) nativeOperationControllerRef.current = null;
        if (nativeSocketRef.current === socket) nativeSocketRef.current = null;
        if (nativeCancelRef.current === cancelForLifecycle) nativeCancelRef.current = () => undefined;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close(1000, "Editor closed; operation will be recovered from stock state");
        } catch {
          // Preserve the attempted-operation baseline for remount recovery.
        }
        resolve();
      };
      nativeCancelRef.current = cancelForLifecycle;

      const replaceAssistantMessage = (content: string) => {
        setMessages((current) => {
          const index = assistantMessageId
            ? current.findIndex((message) => message.id === assistantMessageId)
            : current.findLastIndex((message) => message.role === "assistant");
          if (index < 0) return [...current, { id: assistantMessageId, role: "assistant", content }];
          return current.map((message, messageIndex) => messageIndex === index ? { ...message, content } : message);
        });
      };

      const closeAndFinish = (error?: Error) => {
        if (finished) return;
        finished = true;
        if (settleTimer !== null) window.clearTimeout(settleTimer);
        operationController.abort();
        if (nativeOperationControllerRef.current === operationController) nativeOperationControllerRef.current = null;
        const ownsSocket = nativeSocketRef.current === socket;
        if (ownsSocket) nativeSocketRef.current = null;
        if (nativeCancelRef.current === cancelForLifecycle) nativeCancelRef.current = () => undefined;
        if (ownsSocket && isOperationActive()) setNativeConnected(false);
        socket.close(1000, error ? "Build stream ended with an error" : "Build stream settled");
        if (error) reject(error);
        else resolve();
      };

      const settleCustomerBoundary = (runtimeStatus: any): boolean => {
        const lifecycle = runtimeStatus?.nativeTaskLifecycle;
        if (typeof lifecycle?.updatedAt !== "number" || lifecycle.updatedAt < startedAt) return false;
        if (continuationApproval && !hasFreshApprovedOperation(lifecycle, continuationApproval)) return false;
        const customerStatus = customerLifecycleStatus(runtimeStatus?.nativeTaskLifecycle);
        if (customerStatus === "CONTINUE_AVAILABLE" && lifecycle.autoContinue?.enabled) {
          setNativeCompletionPhase("starting");
          setNativeCompletionMessage("Starting...");
          return false;
        }
        if (customerStatus !== "CONTINUE_AVAILABLE" && customerStatus !== "NEEDS_INPUT" && customerStatus !== "STOPPED") return false;
        if (customerStatus === "STOPPED") stopConfirmedRef.current = true;
        setRuntimeCapability({ projectId, nativeThink: true, status: runtimeStatus });
        setNativeCompletionPhase(customerStatus === "CONTINUE_AVAILABLE" ? "paused"
          : customerStatus === "NEEDS_INPUT" ? "needs_input" : "error");
        setNativeCompletionMessage(customerStatus === "CONTINUE_AVAILABLE"
          ? "I made progress on your request, but I haven't finished everything yet. Would you like me to continue working?"
          : customerStatus === "NEEDS_INPUT" ? "Needs your input" : "This build stopped before completion.");
        setNativeRecoveryUnverified(false);
        setRuntimeError("");
        setSending(false);
        clearNativeOperationBaseline(projectId);
        closeAndFinish();
        return true;
      };

      const failTurn = (message: string, recoverable = false, runtimeStatus?: any) => {
        const error = new Error(message);
        if (isOperationActive()) {
          if (runtimeStatus) setRuntimeCapability({ projectId, nativeThink: true, status: runtimeStatus });
          setRuntimeError(message);
          replaceAssistantMessage(message);
          setNativeCompletionPhase("error");
          setNativeCompletionMessage(recoverable ? "The result is not verified yet · refresh to check the latest project state." : message);
          setNativeRecoveryUnverified(recoverable);
        }
        if (!recoverable) clearNativeOperationBaseline(projectId);
        closeAndFinish(error);
      };

      const failBeforePrompt = () => {
        if (promptAttempted || suggestionSent) {
          failTurn("Connection failed. The build request may already be running; refresh the project status before retrying.");
          return;
        }
        setNativeConnectionRetry({
          projectId,
          agentPrompt,
          images: images.map((image) => ({ ...image })),
          lifecycle,
          ...(continuationApproval ? { continuationApproval } : {}),
          ...(assistantMessageId ? { assistantMessageId } : {}),
        });
        const failedEvents = nativeProgressRef.current.map((event) =>
          event.status === "active" ? { ...event, status: "error" as const } : event);
        nativeProgressRef.current = failedEvents;
        setNativeProgress(failedEvents);
        writeNativeActivitySnapshot(projectId, {
          events: failedEvents,
          startedAt: nativeOperationStartedAtRef.current,
        });
        recordNativeProgress("Connection failed before the build request was sent", "error");
        failTurn("Connection failed. Your approved plan and conversation are saved. No build prompt was sent.");
      };

      const fetchJson = async (path: string, init?: RequestInit) => {
        const response = await fetch(`/api/projects/${projectId}/runtime/${path}`, {
          credentials: "same-origin",
          ...init,
          signal: operationController.signal,
          headers: { ...authHeaders(), ...(init?.headers || {}) },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || `Unable to load ${path.replaceAll("/", " ")}.`);
        return body;
      };

      const isRuntimeIdle = (runtimeStatus: any) => {
        const state = runtimeStatus.state || {};
        const generationStatus = String(
          state.generation?.status
            || state.generationStatus
            || state.generation_status
            || state.status
            || runtimeStatus.generation?.status
            || runtimeStatus.generationStatus
            || runtimeStatus.generation_status
            || runtimeStatus.status
            || runtimeStatus.runtimeStatus
            || "",
        ).toLowerCase();
        const runningStatuses = ["pending", "queued", "starting", "running", "building", "generating"];
        const terminalErrors = ["failed", "error", "stopped", "cancelled", "canceled"];
        const settledStatuses = ["idle", "complete", "completed", "success", "succeeded"];
        const generationSignal = typeof state.shouldBeGenerating === "boolean"
          ? state.shouldBeGenerating
          : typeof runtimeStatus.shouldBeGenerating === "boolean" ? runtimeStatus.shouldBeGenerating : undefined;
        if (generationSignal === true || runningStatuses.includes(generationStatus) || terminalErrors.includes(generationStatus)) return false;
        return generationSignal === false && settledStatuses.includes(generationStatus);
      };
      const runtimeTerminalError = (runtimeStatus: any): string | null => {
        const resourceLimitError = nativeResourceLimitError(runtimeStatus, startedAt);
        if (resourceLimitError) return resourceLimitError;
        const state = runtimeStatus?.state || {};
        const status = String(
          state.generation?.status
            || state.generationStatus
            || state.generation_status
            || runtimeStatus?.generation?.status
            || runtimeStatus?.generationStatus
            || runtimeStatus?.generation_status
            || "",
        ).toLowerCase();
        return ["failed", "error", "stopped", "cancelled", "canceled"].includes(status)
          ? "This build stopped before completion. Review the project and try again."
          : null;
      };

      const settle = async () => {
        if (finished) return;
        if (!isOperationActive()) {
          cancelForLifecycle();
          return;
        }
        if (settling) {
          settleAgain = true;
          return;
        }
        if (!isOperationActive()) {
          cancelForLifecycle();
          return;
        }
        if (Date.now() - startedAt > NATIVE_RECOVERY_WINDOW_MS) {
          failTurn(`BuildCustom could not verify the operation within the recovery window. Your project may still contain saved work. Refresh the editor to check the latest stock state. ${settlementWaitReason}`, true);
          return;
        }
        const quietFallbackReady = suggestionSent && Date.now() - lastFrameAt >= NATIVE_STREAM_QUIET_MS
          && (!generationComplete || recoveryStarted || assistantStreaming || activeWork.size > 0);
        if (!generationComplete && !recoveryStarted && !quietFallbackReady) {
          if (suggestionSent) scheduleSettle();
          return;
        }
        if (!quietFallbackReady && !recoveryStarted && (assistantStreaming || activeWork.size > 0)) {
          scheduleSettle();
          return;
        }
        const requiredQuietMs = quietFallbackReady || recoveryStarted ? NATIVE_STREAM_QUIET_MS : NATIVE_REVISION_STABILITY_MS;
        if (Date.now() - lastFrameAt < requiredQuietMs) {
          scheduleSettle();
          return;
        }

        settling = true;
        const checkFrameSequence = frameSequence;
        try {
          const status = await fetchJson("status");
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          if (continuationApproval && !hasFreshApprovedOperation(status.nativeTaskLifecycle, continuationApproval)) {
            setNativeCompletionPhase("starting");
            setNativeCompletionMessage("Starting...");
            scheduleSettle();
            return;
          }
          if (settleCustomerBoundary(status)) return;
          if (frameSequence !== checkFrameSequence || Date.now() - lastFrameAt < requiredQuietMs) {
            revisionCandidate = null;
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          const statusError = runtimeTerminalError(status);
          if (statusError) {
            failTurn(statusError, false, status);
            return;
          }
          if (!isRuntimeIdle(status)) {
            revisionCandidate = null;
            settlementWaitReason = "Runtime generation has not reported an idle or complete state.";
            if (isOperationActive()) {
              setNativeCompletionPhase(recoveryStarted || quietFallbackReady ? "recovering" : "running");
              setNativeCompletionMessage(recoveryStarted || quietFallbackReady
                ? "Waiting for the stock runtime to stop changing before verification…"
                : "The Agent is still working…");
            }
            scheduleSettle(quietFallbackReady || recoveryStarted ? NATIVE_RECOVERY_POLL_MS : 1200);
            return;
          }

          const revisionData = await fetchJson("revision");
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          if (frameSequence !== checkFrameSequence || Date.now() - lastFrameAt < requiredQuietMs) {
            revisionCandidate = null;
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          const currentCommitHash = typeof revisionData.commitHash === "string"
            ? revisionData.commitHash
            : typeof revisionData.revision?.commitHash === "string" ? revisionData.revision.commitHash : null;
          if (!currentCommitHash || currentCommitHash === baselineCommitHash) {
            revisionCandidate = null;
            settlementWaitReason = "The Agent did not produce a new authoritative project revision.";
            if (quietFallbackReady || recoveryStarted) {
              setNativeCompletionPhase("recovering");
              setNativeCompletionMessage("The runtime is idle, but no new committed revision is verified yet…");
            }
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          if (!revisionCandidate
            || revisionCandidate.frameSequence !== checkFrameSequence
            || revisionCandidate.commitHash !== currentCommitHash) {
            revisionCandidate = { commitHash: currentCommitHash, checkedAt: Date.now(), frameSequence: checkFrameSequence };
            settlementWaitReason = "Waiting to confirm the authoritative revision is stable.";
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          if (Date.now() - revisionCandidate.checkedAt < 5000) {
            scheduleSettle(NATIVE_REVISION_STABILITY_MS);
            return;
          }

          const [fileData, latestStatus] = await Promise.all([
            fetchJson("files"),
            fetchJson("status"),
          ]);
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          if (settleCustomerBoundary(latestStatus)) return;
          if (frameSequence !== checkFrameSequence || Date.now() - lastFrameAt < requiredQuietMs) {
            revisionCandidate = null;
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          const finalStatusError = runtimeTerminalError(latestStatus);
          if (finalStatusError) {
            failTurn(finalStatusError, false, latestStatus);
            return;
          }
          if (!isRuntimeIdle(latestStatus)) {
            revisionCandidate = null;
            settlementWaitReason = "Runtime generation did not remain idle while verifying the new revision.";
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          const files = Array.isArray(fileData) ? fileData : Array.isArray(fileData.files) ? fileData.files : [];
          if (files.length === 0) {
            settlementWaitReason = "The new authoritative revision contains no verifiable project files.";
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }

          const finalRevisionData = await fetchJson("revision");
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          const finalCommitHash = typeof finalRevisionData.commitHash === "string"
            ? finalRevisionData.commitHash
            : typeof finalRevisionData.revision?.commitHash === "string" ? finalRevisionData.revision.commitHash : null;
          if (frameSequence !== checkFrameSequence || Date.now() - lastFrameAt < requiredQuietMs) {
            revisionCandidate = null;
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          if (finalCommitHash !== currentCommitHash) {
            revisionCandidate = null;
            settlementWaitReason = "The authoritative project revision changed during verification.";
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }

          const turnsBeforePreviewData = await fetchJson("turns");
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          const turnsBeforePreview = runtimeTurnsFromResponse(turnsBeforePreviewData);
          if (!turnsBeforePreview || !await hasNativeOperationEvidence(turnsBeforePreview, operationBaseline, latestStatus)) {
            settlementWaitReason = "The revision is not yet correlated with an appended user turn matching this prompt and a completed assistant response.";
            setNativeCompletionPhase("recovering");
            setNativeCompletionMessage("The revision is saved · verifying its matching conversation turn before completion…");
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }

          const previewState = latestStatus.state || {};
          const lastDeployedCommit = previewState.lastDeployedCommit || latestStatus.lastDeployedCommit;
          const signedPreviewUrl = latestStatus.previewUrl
            || latestStatus.previewURL
            || previewState.previewUrl
            || previewState.previewURL
            || "";
          let previewUrl = lastDeployedCommit === currentCommitHash && typeof signedPreviewUrl === "string"
            ? signedPreviewUrl
            : "";
          if (!previewUrl) {
            const token = await csrfToken();
            const preview = await fetchJson("previews", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
              body: JSON.stringify({}),
            });
            previewUrl = typeof preview.url === "string" ? preview.url : typeof preview.previewUrl === "string" ? preview.previewUrl : "";
          }
          if (!previewUrl) throw new Error("Build files were verified, but the runtime did not return a preview URL.");

          const turnsSequence = ++turnLoadSequenceRef.current;
          const turnsData = await fetchJson("turns");
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          const finalTurns = runtimeTurnsFromResponse(turnsData);
          if (!finalTurns || turnsSequence !== turnLoadSequenceRef.current
            || !await hasNativeOperationEvidence(finalTurns, operationBaseline, latestStatus)) {
            settlementWaitReason = "The new revision is not yet correlated with an appended user turn matching this prompt and an assistant response.";
            setNativeCompletionPhase("recovering");
            setNativeCompletionMessage("The revision is saved · verifying its matching conversation turn before completion…");
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          const [verifiedStatus, verifiedRevision] = await Promise.all([
            fetchJson("status"),
            fetchJson("revision"),
          ]);
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          const verifiedStatusError = runtimeTerminalError(verifiedStatus);
          if (verifiedStatusError) {
            failTurn(verifiedStatusError, false, verifiedStatus);
            return;
          }
          if (settleCustomerBoundary(verifiedStatus)) return;
          const verifiedCommitHash = typeof verifiedRevision.commitHash === "string"
            ? verifiedRevision.commitHash
            : typeof verifiedRevision.revision?.commitHash === "string" ? verifiedRevision.revision.commitHash : null;
          if (frameSequence !== checkFrameSequence || Date.now() - lastFrameAt < requiredQuietMs) {
            revisionCandidate = null;
            settlementWaitReason = "Native progress resumed during final verification.";
            setNativeCompletionPhase("recovering");
            setNativeCompletionMessage("The Agent is still updating this project · checking again after activity settles.");
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          if (!isRuntimeIdle(verifiedStatus)
            || verifiedStatus?.nativeTaskLifecycle?.status !== "COMPLETE"
            || typeof verifiedStatus?.nativeTaskLifecycle?.updatedAt !== "number"
            || verifiedStatus.nativeTaskLifecycle.updatedAt < startedAt
            || customerLifecycleStatus(verifiedStatus?.nativeTaskLifecycle) !== "BUILD_COMPLETE"
            || (operationBaseline.approvedTaskId
              && !hasFreshApprovedOperation(verifiedStatus?.nativeTaskLifecycle, {
                taskId: operationBaseline.approvedTaskId,
                operationId: operationBaseline.approvedOperationId || "",
                updatedAt: operationBaseline.lifecycleUpdatedAt || 0,
              }))
            || verifiedCommitHash !== currentCommitHash) {
            revisionCandidate = null;
            settlementWaitReason = verifiedStatus?.nativeTaskLifecycle?.status !== "COMPLETE"
              ? "The authoritative task lifecycle has not established completion."
              : "Runtime activity or a changed revision was detected after preview and turn verification.";
            setNativeCompletionPhase("recovering");
            setNativeCompletionMessage("The runtime changed after verification · checking its final state again…");
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
            return;
          }
          if (turnsSequence === turnLoadSequenceRef.current) setTurns(finalTurns);
          setRuntimeCapability({ projectId, nativeThink: true, status: verifiedStatus });
          setRuntimeError("");
          setMessages([]);
          setPreviewUrl(previewUrl);
          setPreviewEnvironment("development");
          clearNativeOperationBaseline(projectId);
          setNativeCompletionPhase("success");
          setNativeCompletionMessage("Your changes are ready to review.");
          setNativeRecoveryUnverified(false);
          void deletePlanningSession().catch(() => undefined);
          setPreviewRevision((revision) => revision + 1);
          queryClient.invalidateQueries({ queryKey: ["runtime-status", projectId] });
          const runtimeFilesQueryKey = ["runtime-files", projectId] as const;
          queryClient.invalidateQueries({ queryKey: runtimeFilesQueryKey });
          queryClient.invalidateQueries({ queryKey: ["runtime-file-content", projectId] });
          recordNativeProgress(`${files.length} project file${files.length === 1 ? "" : "s"} verified · preview ready`);
          closeAndFinish();
        } catch (error: any) {
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          if (Date.now() - startedAt >= NATIVE_RECOVERY_WINDOW_MS) {
            failTurn(`BuildCustom could not verify the operation within the recovery window. Your project may still contain saved work. Refresh the editor to check the latest stock state. ${error.message || settlementWaitReason}`, true);
          } else {
            settlementWaitReason = error.message || "Stock runtime verification is temporarily unavailable.";
            setNativeCompletionPhase("recovering");
            setNativeCompletionMessage("The Agent is done streaming · verifying the stock revision and preview…");
            scheduleSettle(NATIVE_RECOVERY_POLL_MS);
          }
        } finally {
          settling = false;
          if (settleAgain && !finished) {
            settleAgain = false;
            scheduleSettle();
          }
        }
      };

      const scheduleSettle = (delay = 1200) => {
        if (finished) return;
        if (!isOperationActive()) {
          cancelForLifecycle();
          return;
        }
        if (settling) {
          settleAgain = true;
          return;
        }
        if (settleTimer !== null) return;
        settleTimer = window.setTimeout(() => {
          settleTimer = null;
          void settle();
        }, delay);
      };

      const beginRecovery = () => {
        if (finished || !suggestionSent) return false;
        if (!isOperationActive()) {
          cancelForLifecycle();
          return false;
        }
        if (recoveryStarted) return true;
        recoveryStarted = true;
        lastFrameAt = Date.now();
        frameSequence += 1;
        revisionCandidate = null;
        assistantStreaming = false;
        activeWork.clear();
        settlementWaitReason = "The runtime did not produce a verifiable committed revision after the connection was interrupted.";
        if (isOperationActive()) {
          setNativeConnected(false);
          setNativeCompletionPhase("recovering");
          setNativeCompletionMessage("Connection interrupted · verifying the latest stock revision before marking this build complete…");
          replaceAssistantMessage("Connection interrupted. Verifying the committed revision before marking this build complete…");
          recordNativeProgress("Connection interrupted · verifying runtime status and revision");
        }
        scheduleSettle();
        try {
          socket.close(1000, "Connection interrupted; verifying committed revision");
        } catch {
          // A browser may already have closed the socket after an error event.
        }
        return true;
      };

      socket.onopen = () => {
        try {
          if (!isOperationActive()) {
            cancelForLifecycle();
            return;
          }
          setNativeConnected(true);
          socket.send(JSON.stringify({ type: "get_conversation_state" }));
          lastFrameAt = Date.now();
          scheduleSettle();
        } catch {
          failTurn("The native Agent connection could not send your request.");
        }
      };

      socket.onmessage = (event) => {
        if (!isOperationActive()) {
          cancelForLifecycle();
          return;
        }
        let frame: any;
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!frame || typeof frame.type !== "string") return;
        if (!isOperationActive()) {
          cancelForLifecycle();
          return;
        }
        lastFrameAt = Date.now();
        frameSequence += 1;
        revisionCandidate = null;
        const streamedTaskLifecycle = frame.nativeTaskLifecycle
          || (frame.code === "INCOMPLETE_RESOURCE_LIMIT"
            ? { status: frame.code, reason: frame.reason }
            : null);
        if (continuationApproval && hasFreshApprovedOperation(streamedTaskLifecycle, continuationApproval)
          && customerLifecycleStatus(streamedTaskLifecycle) === "WORKING") {
          setRuntimeCapability((current) => ({
            projectId, nativeThink: true,
            status: { ...(current?.projectId === projectId ? current.status : {}),
              nativeTaskLifecycle: streamedTaskLifecycle, state: { shouldBeGenerating: true } },
          }));
          setNativeCompletionPhase("running");
          setNativeCompletionMessage("Working");
        }
        if (streamedTaskLifecycle?.customerStatus === "CONTINUE_AVAILABLE"
          || streamedTaskLifecycle?.customerStatus === "NEEDS_INPUT"
          || customerLifecycleStatus(streamedTaskLifecycle) === "STOPPED") {
          if (customerLifecycleStatus(streamedTaskLifecycle) === "STOPPED") stopConfirmedRef.current = true;
          if (settleCustomerBoundary({ nativeTaskLifecycle: streamedTaskLifecycle })) return;
        }
        const streamedResourceLimit = nativeResourceLimitError({
          nativeTaskLifecycle: streamedTaskLifecycle,
          state: { shouldBeGenerating: false },
        }, startedAt);
        if (streamedResourceLimit && !(streamedTaskLifecycle?.autoContinue?.enabled
          && customerLifecycleStatus(streamedTaskLifecycle) === "CONTINUE_AVAILABLE")) {
          failTurn(streamedResourceLimit);
          return;
        }

        const tool = frame.tool || {};
        const toolName = typeof tool.name === "string" ? tool.name : "";
        const toolPath = typeof tool.args?.path === "string" ? tool.args.path : "";
        const eventPath = typeof frame.path === "string" ? frame.path
          : typeof frame.file?.filePath === "string" ? frame.file.filePath
            : typeof frame.file?.path === "string" ? frame.file.path
            : typeof frame.filePath === "string" ? frame.filePath : "";
        const toolKey = String(tool.id || `${toolName}:${toolPath}`);

        switch (frame.type) {
          case "agent_connected": {
            if (promptAttempted) break;
            if (frame.state?.shouldBeGenerating === true) {
              clearNativeOperationBaseline(projectId);
              failTurn("This Agent is already working on another operation. No prompt was sent; refresh the editor to check its latest state.", true);
              return;
            }
            if (typeof frame.state?.shouldBeGenerating !== "boolean") {
              clearNativeOperationBaseline(projectId);
              failTurn("The Agent connection did not confirm whether it was safe to send. No prompt was sent; refresh and try again.", true);
              return;
            }
            promptAttempted = true;
            setNativeConnectionRetry(null);
            writeNativeOperationBaseline(projectId, { ...operationBaseline, promptAttempted: true });
            try {
              setNativeCompletionPhase(continuationApproval ? "starting" : "running");
              setNativeCompletionMessage(continuationApproval ? "Starting..." : "Agent started · streaming progress");
              socket.send(JSON.stringify({
                type: "user_suggestion",
                message: continuationApproval ? "Continue" : agentPrompt,
                ...(continuationApproval ? {
                  continuationApproval: {
                    taskId: continuationApproval.taskId,
                    operationId: continuationApproval.operationId,
                  },
                } : {}),
                ...(images.length ? { images } : {}),
              }));
              suggestionSent = true;
              markPlanningSubmitted();
              lastFrameAt = Date.now();
            } catch {
              failTurn("BuildCustom could not send the request. No automatic retry was attempted.", true);
              return;
            }
            break;
          }
          case "conversation_response": {
            if (typeof frame.message === "string" && frame.message) {
              const safeMessage = normalizeBuilderAssistantText(frame.message);
              setMessages((current) => {
                const index = assistantMessageId
                  ? current.findIndex((message) => message.id === assistantMessageId)
                  : current.findLastIndex((message) => message.role === "assistant");
                if (index < 0) return [...current, { id: assistantMessageId, role: "assistant", content: safeMessage }];
                return current.map((message, messageIndex) => messageIndex === index
                  ? { ...message, content: frame.isDelta ? `${message.content}${safeMessage}` : safeMessage }
                  : message);
              });
            }
            assistantStreaming = frame.isStreaming === true;
            if (toolName) {
              if (["start", "running", "pending", "started"].includes(String(tool.status || "").toLowerCase())) {
                activeWork.add(toolKey);
              } else if (tool.status) {
                activeWork.delete(toolKey);
              }
              const label = toolPath
                ? `${tool.status === "success" ? "Updated" : "Working on"} ${toolPath}`
                : toolName.replaceAll("_", " ");
              recordNativeProgress(label,
                ["success", "complete", "completed"].includes(String(tool.status || "").toLowerCase()) ? "complete"
                  : ["start", "running", "pending", "started"].includes(String(tool.status || "").toLowerCase()) ? "active" : "info",
                toolPath || undefined);
            }
            break;
          }
          case "generation_started":
            activeWork.add("generation");
            setNativeBuildFailure(null);
            setNativeActivityStart(nativeOperationStartedAtRef.current || Date.now());
            recordNativeProgress("Agent started the build", "active");
            break;
          case "generation_complete":
            generationComplete = true;
            activeWork.delete("generation");
            setNativeCompletionPhase("recovering");
            setNativeCompletionMessage("The runtime reported completion. Verifying committed files and preview…");
            recordNativeProgress("Agent reported generation complete · verifying files and preview", "complete");
            break;
          case "phase_generating":
          case "phase_implementing":
          case "phase_validating": {
            const phase = frame.type.slice("phase_".length);
            activeWork.add(`phase:${phase}`);
            recordNativeProgress(phase === "generating" ? "Generating project files"
              : phase === "implementing" ? "Applying project changes" : "Validating the project", "active");
            break;
          }
          case "phase_generated":
            activeWork.delete("phase:generating");
            recordNativeProgress("Project file generation phase completed", "complete");
            break;
          case "phase_implemented":
            activeWork.delete("phase:implementing");
            recordNativeProgress("Project implementation phase completed", "complete");
            break;
          case "phase_validated":
            activeWork.delete("phase:validating");
            recordNativeProgress("Project validation phase completed", "complete");
            break;
          case "file_generating":
            if (eventPath) {
              activeWork.add(`file:${eventPath}`);
              recordNativeProgress(`Writing ${eventPath}`, "active", eventPath);
            }
            break;
          case "file_generated":
          case "file_regenerated":
          case "file_chunk_generated":
            if (eventPath) {
              activeWork.delete(`file:${eventPath}`);
              recordNativeProgress(`Updated ${eventPath}`, "complete", eventPath);
            }
            break;
          case "file_deleted":
            if (eventPath) {
              activeWork.delete(`file:${eventPath}`);
              recordNativeProgress(`Removed ${eventPath}`, "complete", eventPath);
            }
            break;
          case "deployment_started":
            activeWork.add("deployment");
            recordNativeProgress("Runtime is preparing the preview", "active");
            break;
          case "deployment_completed":
            activeWork.delete("deployment");
            recordNativeProgress("Runtime preview deployment completed", "complete");
            break;
          case "deployment_failed":
            activeWork.delete("deployment");
            recordNativeProgress("Runtime preview deployment failed", "error");
            break;
          case "error": {
            const statusCode = Number(frame.status ?? frame.statusCode ?? frame.error?.status);
            const errorCode = typeof frame.errorCode === "string" ? frame.errorCode : null;
            const attemptId = typeof frame.attemptId === "string" && /^[0-9a-f-]{36}$/i.test(frame.attemptId)
              ? frame.attemptId : null;
            const message = statusCode === 401
              ? "The runtime could not authorize a status or build request. The result is not confirmed; refresh the editor and check your account access."
              : statusCode === 402
                ? "The AI provider reported a payment or credit limit. The build result is not confirmed."
                : statusCode === 429
                  ? "The AI provider is rate-limiting this request. Wait before trying again."
                  : safeBuildErrorMessage(errorCode)
                    || "This build stopped before completion. The conversation is preserved, but the runtime did not provide a safe diagnostic category.";
            setNativeBuildFailure({
              errorCode,
              attemptId,
              lastSuccessfulStage: null,
              diagnosticsAvailable: frame.diagnosticsAvailable === true && Boolean(attemptId),
            });
            if (attemptId && projectId > 0) {
              const failedProjectId = projectId;
              void fetch(`/api/projects/${failedProjectId}/build-activity`, {
                credentials: "same-origin",
                headers: authHeaders(),
                cache: "no-store",
              }).then(async (response) => {
                if (!response.ok) {
                  setNativeBuildFailure((current) => {
                    if (!current || current.attemptId !== attemptId) return current;
                    return { ...current, diagnosticsAvailable: false };
                  });
                  return null;
                }
                return await response.json().catch(() => null) as {
                  attempts?: Array<{ attemptId: string; lastSuccessfulStage: string | null }>;
                } | null;
              }).then((result) => {
                if (activeProjectIdRef.current !== failedProjectId || !result?.attempts) return;
                const attempt = result.attempts.find((entry) => entry.attemptId === attemptId);
                if (attempt) setNativeBuildFailure((current) => {
                  if (!current || current.attemptId !== attemptId) return current;
                  return { ...current, lastSuccessfulStage: attempt.lastSuccessfulStage, diagnosticsAvailable: true };
                });
                else setNativeBuildFailure((current) => {
                  if (!current || current.attemptId !== attemptId) return current;
                  return { ...current, diagnosticsAvailable: false };
                });
              }).catch(() => undefined);
            }
            recordNativeProgress(message, "error");
            failTurn(message);
            return;
          }
          case "generation_stopped":
          case "generation_cancelled":
            activeWork.clear();
            stopConfirmedRef.current = true;
            recordNativeProgress("The runtime confirmed the build stopped. The project may contain partial saved changes.", "error");
            failTurn("The runtime confirmed the build stopped. The project may contain partial saved changes.");
            return;
          default:
            break;
        }
        scheduleSettle();
      };

      socket.onerror = () => {
        if (!isOperationActive()) {
          cancelForLifecycle();
          return;
        }
        if (!beginRecovery()) {
          failBeforePrompt();
        }
      };

      socket.onclose = () => {
        if (!isOperationActive()) {
          cancelForLifecycle();
          return;
        }
        if (nativeSocketRef.current === socket) {
          nativeSocketRef.current = null;
          setNativeConnected(false);
        }
        if (!finished) {
          if (!beginRecovery()) {
            failBeforePrompt();
          }
        }
      };
    });
  };

  useEffect(() => {
    if (!publishing || !projectId || nativeThink) return;
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
  }, [publishing, projectId, nativeThink]);

  const handleAutoContinue = async (enabled: boolean) => {
    const taskId = currentNativeLifecycle?.taskId;
    if (!projectId || !taskId || autoContinueSaving) return;
    const savedProjectId = projectId;
    setAutoContinueSaving(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(`${protocol}//${location.host}/api/projects/${savedProjectId}/runtime/ws`);
        let sent = false;
        const timer = window.setTimeout(() => finish(new Error("Auto Continue could not be saved. Please try again.")), 15000);
        const finish = (error?: Error) => {
          window.clearTimeout(timer);
          socket.onclose = null;
          socket.close();
          if (error) reject(error); else resolve();
        };
        socket.onmessage = (event) => {
          let frame: any;
          try { frame = JSON.parse(String(event.data)); } catch { return; }
          if (frame.type === "agent_connected" && !sent) {
            sent = true;
            socket.send(JSON.stringify({ type: "set_auto_continue", taskId, enabled }));
          } else if (frame.type === "auto_continue_updated"
            && frame.preference?.taskId === taskId && frame.preference?.enabled === enabled) {
            finish();
          } else if (frame.type === "error") {
            finish(new Error("Auto Continue could not be saved. Refresh the task and try again."));
          }
        };
        socket.onerror = () => finish(new Error("Auto Continue could not be saved. Please try again."));
        socket.onclose = () => finish(new Error("Auto Continue could not be saved. Please try again."));
      });
      const response = await fetch(`/api/projects/${savedProjectId}/runtime/status`, { headers: authHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error("Auto Continue was saved, but the latest task could not be checked. Refresh to check its state.");
      const status = await response.json();
      if (activeProjectIdRef.current === savedProjectId) {
        setRuntimeCapability({ projectId: savedProjectId, nativeThink: true, status });
      }
    } catch (error) {
      if (activeProjectIdRef.current === savedProjectId) setRuntimeError(error instanceof Error ? error.message : "Auto Continue could not be saved.");
    } finally {
      setAutoContinueSaving(false);
    }
  };

  const handleContinue = async () => {
    if (continuationInFlightRef.current || sending || !projectId || !nativeThink || nativeRecoveryUnverified) return;
    const offeredLifecycle = currentNativeLifecycle;
    if (!canContinueNativeTask(offeredLifecycle, nativeRuntimeAlreadyWorking)) return;
    continuationInFlightRef.current = true;
    const requestLifecycle = nativeLifecycleRef.current;
    setSending(true);
    setRuntimeError("");
    setNativeCompletionPhase("starting");
    setNativeCompletionMessage("Starting...");
    const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setNativeActivityStart(Date.now());
    setMessages((current) => [
      ...current,
      { role: "user", content: "Continue" },
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/status`, {
        credentials: "same-origin",
        headers: authHeaders(),
      });
      const status = await response.json().catch(() => ({}));
      const latestLifecycle = status?.nativeTaskLifecycle as NativeTaskLifecycle | undefined;
      const generation = String(status?.state?.generation?.status || "").toLowerCase();
      const latestIsWorking = status?.state?.shouldBeGenerating === true
        || ["pending", "queued", "starting", "running", "building", "generating"].includes(generation);
      if (!response.ok || !canContinueNativeTask(latestLifecycle, latestIsWorking)
        || latestLifecycle.taskId !== offeredLifecycle.taskId
        || latestLifecycle.operationId !== offeredLifecycle.operationId
        || latestLifecycle.updatedAt !== offeredLifecycle.updatedAt) {
        throw new Error("This continuation is no longer available. Refresh the project status and try again.");
      }
      setRuntimeCapability({ projectId, nativeThink: true, status });
      await streamNativeTurn("Continue", [], requestLifecycle, {
        taskId: latestLifecycle.taskId!,
        operationId: latestLifecycle.operationId!,
        updatedAt: latestLifecycle.updatedAt!,
      }, assistantMessageId);
      if (nativeLifecycleRef.current !== requestLifecycle || activeProjectIdRef.current !== projectId) return;
    } catch {
      if (nativeLifecycleRef.current === requestLifecycle && activeProjectIdRef.current === projectId) {
        nativeOperationControllerRef.current?.abort();
        nativeOperationControllerRef.current = null;
        setNativeCompletionPhase("error");
        setNativeCompletionMessage("The request to continue could not be verified. Refresh and try again.");
        setRuntimeError("The request to continue could not be verified. Refresh and try again.");
        setMessages((current) => current.map((message) => message.id === assistantMessageId
          ? { ...message, content: "The request to continue could not be verified. Refresh and try again." }
          : message));
        // Retry is available only when an owner read still confirms this exact
        // unstarted boundary. Ambiguous accepted work stays in recovery.
        try {
          const response = await fetch(`/api/projects/${projectId}/runtime/status`, { headers: authHeaders(), cache: "no-store" });
          const status = await response.json();
          const lifecycle = status.nativeTaskLifecycle;
          if (response.ok && canContinueNativeTask(lifecycle, status.state?.shouldBeGenerating === true)
            && lifecycle.taskId === offeredLifecycle.taskId
            && lifecycle.operationId === offeredLifecycle.operationId) {
            setRuntimeCapability({ projectId, nativeThink: true, status });
            setNativeCompletionPhase("paused");
            setNativeRecoveryUnverified(false);
            clearNativeOperationBaseline(projectId);
          }
        } catch { /* Keep unknown outcomes in recovery without automatic retry. */ }
      }
    } finally {
      continuationInFlightRef.current = false;
      if (nativeLifecycleRef.current === requestLifecycle && activeProjectIdRef.current === projectId) setSending(false);
    }
  };

  const handleRetryNativeConnection = async () => {
    const retry = nativeConnectionRetry;
    if (!retry || retry.projectId !== projectId || sending || sendAttemptRef.current
      || nativeRuntimeAlreadyWorking || nativeRecoveryUnverified) return;
    sendAttemptRef.current = true;
    setNativeConnectionRetry(null);
    setSending(true);
    setNativeCompletionPhase("starting");
    setNativeCompletionMessage("Retrying the connection. The build prompt will only be sent after the Agent confirms it is ready.");
    setRuntimeError("");
    recordNativeProgress("Retrying the Agent connection", "active");
    try {
      await streamNativeTurn(
        retry.agentPrompt,
        retry.images,
        retry.lifecycle,
        retry.continuationApproval,
        retry.assistantMessageId,
      );
      if (activeProjectIdRef.current !== retry.projectId) return;
      setPendingPlan("");
      setAttachments([]);
      setTextContext([]);
      setSelectedElement(null);
    } catch (error: any) {
      if (activeProjectIdRef.current !== retry.projectId) return;
      const message = error?.message || "The Agent could not reconnect.";
      setRuntimeError(message);
      setNativeCompletionPhase("error");
      setNativeCompletionMessage(message);
      if (retry.assistantMessageId) {
        setMessages((previous) => previous.map((item) => item.id === retry.assistantMessageId
          ? { ...item, content: message }
          : item));
      }
    } finally {
      if (activeProjectIdRef.current === retry.projectId) setSending(false);
      sendAttemptRef.current = false;
    }
  };

  const handleSend = async (
    promptOverride?: string,
    planOverride?: boolean,
    options?: {
      bypassPlanning?: boolean;
      approvePlan?: boolean;
      planningAction?: "answer" | "skip" | "decide";
      selectedOptions?: string[];
      agentPromptOverride?: string;
      acknowledgement?: string;
      appendUserMessage?: boolean;
      appendAcknowledgement?: boolean;
    },
  ) => {
    let prompt = (promptOverride ?? chatInput).trim();
    let requestOptions = options || {};
    if (nativeThink
      && !requestOptions.approvePlan
      && attachments.length === 0
      && textContext.length === 0
      && !selectedElement
      && isContextualContinuationApproval(prompt, currentNativeLifecycle, nativeRuntimeAlreadyWorking)) {
      setChatInput("");
      void handleContinue();
      return;
    }
    if (sendAttemptRef.current) return;
    if (nativeThink && (sending || nativeRuntimeAlreadyWorking || nativeRecoveryUnverified || nativeConnectionRetry)) {
      if (!sending && nativeRuntimeAlreadyWorking) {
        const message = "This Agent is already working. The existing operation was not restarted; refresh to check its latest state.";
        setNativeCompletionPhase("recovering");
        setNativeCompletionMessage(message);
        setRuntimeError(message);
      }
      return;
    }
    if (!prompt && !requestOptions.approvePlan) return;
    if (!projectId) {
      setRuntimeError("Open Builder from a runtime-backed project to start an Agent session.");
      return;
    }
    if (!currentRuntimeCapability) {
      setRuntimeError(runtimeCapabilityError || "Checking project runtime before starting an Agent session.");
      return;
    }
    if (!planningLoaded && !requestOptions.bypassPlanning && !requestOptions.approvePlan) {
      setRuntimeError("Restoring saved planning before sending your request. No build has been started.");
      return;
    }

    sendAttemptRef.current = true;
    const sendingProjectId = projectId;
    const sendingLifecycle = nativeLifecycleRef.current;
    const isSendingContextActive = () => nativeMountedRef.current
      && nativeLifecycleRef.current === sendingLifecycle
      && activeProjectIdRef.current === sendingProjectId;
    try {
      let activePlanMode = planOverride ?? planMode;
      const currentPlan = planningSessionRef.current;

      if (requestOptions.approvePlan && currentPlan?.mode === "plan"
        && currentPlan.phase === "awaiting_approval") {
        const approved = approveBuildPlan(currentPlan);
        const approvedWithAcknowledgement: PlanningSession = {
          ...approved,
          messages: [...approved.messages, {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: "Plan approved. I'll start building it now.",
            createdAt: Date.now(),
          }],
        };
        await savePlanningSession(approvedWithAcknowledgement);
        prompt = currentPlan.originalPrompt;
        requestOptions = {
          ...requestOptions,
          bypassPlanning: true,
          agentPromptOverride: buildPromptFromPlanningSession(approvedWithAcknowledgement),
          appendUserMessage: false,
          appendAcknowledgement: false,
        };
        activePlanMode = false;
        setPlanMode(false);
      } else if (currentPlan?.phase === "clarifying" && !requestOptions.bypassPlanning) {
        const advance = answerPlanningQuestion(
          currentPlan,
          prompt,
          requestOptions.selectedOptions || [],
          requestOptions.planningAction || "answer",
        );
        await savePlanningSession(advance.session);
        setChatInput("");
        if (advance.kind !== "build") return;
        prompt = advance.session.originalPrompt;
        requestOptions = {
          ...requestOptions,
          bypassPlanning: true,
          agentPromptOverride: advance.buildPrompt,
          appendUserMessage: false,
          appendAcknowledgement: false,
        };
        activePlanMode = false;
        setPlanMode(false);
      } else if (currentPlan?.phase === "awaiting_approval"
        && currentPlan.mode === "plan" && !requestOptions.bypassPlanning) {
        const nextPlan: PlanningSession = {
          ...currentPlan,
          originalPrompt: `${currentPlan.originalPrompt}\nAdditional direction: ${prompt}`.trim().slice(0, 6000),
          planSummary: `${currentPlan.planSummary || "First-pass plan"}\n\nAdditional direction: ${prompt}`.slice(0, 2000),
          messages: [
            ...currentPlan.messages,
            { id: `user-${Date.now()}`, role: "user", content: prompt, createdAt: Date.now() },
            { id: `assistant-${Date.now()}-note`, role: "assistant", content: "I added that direction to the plan. Review it, then approve the build when you're ready.", createdAt: Date.now() + 1 },
          ],
        };
        await savePlanningSession(nextPlan);
        setChatInput("");
        return;
      } else if (currentPlan?.phase === "submitted" && !requestOptions.bypassPlanning) {
        await deletePlanningSession();
      }

      const hasSupportingContext = attachments.length > 0 || textContext.length > 0 || Boolean(selectedElement);
      const shouldStartPlanning = !requestOptions.bypassPlanning
        && !requestOptions.approvePlan
        && (activePlanMode || (!turns.length && !messages.length))
        && (!hasSupportingContext || activePlanMode);
      if (shouldStartPlanning) {
        const decision = startBuildPlanning(prompt, activePlanMode);
        if (decision.kind === "planning") {
          await savePlanningSession(decision.session);
          setPlanMode(false);
          setChatInput("");
          return;
        }
        prompt = decision.prompt || prompt;
        requestOptions = {
          ...requestOptions,
          acknowledgement: decision.acknowledgement,
          agentPromptOverride: decision.prompt || prompt,
        };
      }

      if (!prompt) return;
      const appendUserMessage = requestOptions.appendUserMessage !== false;
      const appendAcknowledgement = requestOptions.appendAcknowledgement !== false;
      const acknowledgement = requestOptions.acknowledgement
        || "I have enough detail to start. I'll focus on the workflow you described and show updates here as the runtime reports them.";
      const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const visiblePrompt = prompt;
      setMessages((previous) => [
        ...previous,
        ...(appendUserMessage ? [{ role: "user" as const, content: visiblePrompt }] : []),
        ...(appendAcknowledgement ? [{ role: "assistant" as const, content: acknowledgement }] : []),
        { id: assistantMessageId, role: "assistant" as const, content: "" },
      ]);
      setNativeCompletionPhase(nativeThink ? "starting" : "idle");
      setNativeCompletionMessage(nativeThink ? "Connecting to the project runtime. No build request is sent until the connection is confirmed." : "");
      setNativeActivityStart(Date.now());
      setChatInput("");
      setSending(true);
      setRuntimeError("");
      const controller = new AbortController();
      requestController.current = controller;
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
      const conversationUiInstruction = nativeThink
        && (turns.length === 0 || planningSessionRef.current !== null)
        ? "\n\nBuildCustom chat behavior: If you need another detail, ask the customer directly in this chat and wait for their reply here. Do not refer to a question panel or any external panel. Do not claim completion until the runtime confirms it."
        : "";
      const promptBase = requestOptions.agentPromptOverride || prompt;
      const agentPrompt = `${promptBase}${imageContext}${selectedContext}${textFileContext}${approvedPlanContext}${conversationUiInstruction}`;
      if (nativeThink) {
        requestController.current = null;
        try {
          await streamNativeTurn(agentPrompt, attachments, sendingLifecycle, undefined, assistantMessageId);
          if (!isSendingContextActive()) return;
          setPendingPlan("");
          setAttachments([]);
          setTextContext([]);
          setSelectedElement(null);
          if (nativeCompletionPhase === "success" || nativeCompletionPhase === "paused"
            || nativeCompletionPhase === "needs_input" || nativeCompletionPhase === "error") {
            void deletePlanningSession().catch(() => undefined);
          }
        } catch (error: any) {
          if (!isSendingContextActive()) return;
          const message = error?.message || "The native Agent could not complete the request.";
          setRuntimeError(message);
          setNativeCompletionPhase("error");
          setNativeCompletionMessage((current) => current || "The request could not be completed or verified.");
          setMessages((previous) => previous.map((item) => item.id === assistantMessageId
            ? { ...item, content: message }
            : item));
        } finally {
          if (isSendingContextActive()) setSending(false);
        }
        return;
      }
      try {
        const response = await fetch(`/api/projects/${projectId}/runtime/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            message: agentPrompt,
            displayMessage: visiblePrompt,
            images: attachments,
            mode: activePlanMode ? "plan" : "build",
          }),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Agent could not process the request.");
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
        void deletePlanningSession().catch(() => undefined);
        const token = await csrfToken();
        const preview = await fetch(`/api/projects/${projectId}/runtime/previews`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
          body: JSON.stringify({}),
        });
        const previewData = await preview.json().catch(() => ({}));
        if (preview.ok && previewData.url) setPreviewUrl(previewData.url);
      } catch (error: any) {
        if (activeProjectIdRef.current !== sendingProjectId) return;
        if (error?.name === "AbortError") {
          const stopMessage = stopConfirmedRef.current
            ? "The runtime confirmed the build stopped. The project may contain partial saved changes."
            : "The local request was interrupted, but the runtime did not confirm cancellation. The build may still be running.";
          setMessages((previous) => previous.map((item) => item.id === assistantMessageId
            ? { ...item, content: stopMessage }
            : item));
          setNativeCompletionPhase(stopConfirmedRef.current ? "error" : "stopping");
          setNativeCompletionMessage(stopMessage);
          setRuntimeError(stopMessage);
          return;
        }
        const message = error.message || "The Agent could not complete the request.";
        setRuntimeError(message);
        setMessages((previous) => previous.map((item) => item.id === assistantMessageId
          ? { ...item, content: message }
          : item));
      } finally {
        if (requestController.current === controller) requestController.current = null;
        if (activeProjectIdRef.current === sendingProjectId) setSending(false);
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "The request could not be prepared.");
    } finally {
      sendAttemptRef.current = false;
    }
  };

  useEffect(() => {
    if (!projectId || !currentRuntimeCapability || !planningLoaded || sending) return;
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
  }, [projectId, currentRuntimeCapability?.projectId, planningLoaded, sending, handleSend]);

  const restoreBuilderTurn = async (turn: RuntimeBuilderTurn) => {
    if (!canManageProduction || !projectId || !turn.commitHash || restoringTurnId !== null) return;
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
    if (nativeThink) {
      const socket = nativeSocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        try {
          stopConfirmedRef.current = false;
          socket.send(JSON.stringify({ type: "stop_generation" }));
          setNativeCompletionPhase("stopping");
          setNativeCompletionMessage("Stop requested. Waiting for the runtime to confirm what happens next.");
          setRuntimeError("");
          recordNativeProgress("Stop requested; waiting for runtime confirmation", "info");
        } catch {
          setNativeCompletionPhase("recovering");
          setNativeCompletionMessage("The stop request could not be sent. The build may still be running.");
          setRuntimeError("The runtime connection could not send the stop request. Its current state is not confirmed.");
        }
      } else {
        setNativeCompletionPhase("recovering");
        setNativeCompletionMessage("The runtime connection is unavailable. Checking status before reporting a stop.");
        try {
          const response = await fetch(`/api/projects/${projectId}/runtime/status`, {
            credentials: "same-origin",
            headers: authHeaders(),
            cache: "no-store",
          });
          const status = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(response.status === 401
            ? "The runtime returned HTTP 401 while checking the stop request."
            : status.message || "Runtime status could not be checked.");
          if (isCurrentStoppedLifecycle(status.nativeTaskLifecycle, readNativeOperationBaseline(projectId))) {
            stopConfirmedRef.current = true;
            setNativeCompletionPhase("error");
            setNativeCompletionMessage("The runtime confirmed the build stopped. The project may contain partial saved changes.");
            setNativeRecoveryUnverified(false);
            setSending(false);
            recordNativeProgress("Runtime confirmed the build stopped", "error");
            return;
          }
          setNativeRecoveryUnverified(true);
          setSending(false);
          setRuntimeError("The runtime did not confirm that the build stopped. It may still be working; no retry was sent.");
          setNativeCompletionMessage("Stop status is unverified. Refresh to check the existing runtime state.");
        } catch (error) {
          setNativeRecoveryUnverified(true);
          setSending(false);
          const message = error instanceof Error ? error.message : "Runtime status could not be checked.";
          setRuntimeError(`${message} The build may still be running; no retry was sent.`);
          setNativeCompletionMessage("Stop status is unverified. Refresh to check the existing runtime state.");
        }
      }
      return;
    }
    if (!projectId) return;
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/projects/${projectId}/runtime/stop`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The stop request could not be sent.");
      if (data.stopped === true && data.acknowledged === true && data.terminalState === "generation_stopped") {
        stopConfirmedRef.current = true;
        requestController.current?.abort();
        setSending(false);
        setRuntimeError("The runtime confirmed the build stopped. The project may contain partial saved changes.");
        return;
      }
      setRuntimeError(data.terminalState === "generation_complete"
        ? "The runtime completed before it could stop. Checking the saved project state."
        : "The stop request was accepted, but the runtime has not confirmed cancellation. It may still be working.");
    } catch (error) {
      setRuntimeError(error instanceof Error
        ? `${error.message} The build may still be working.`
        : "The stop request could not be verified. The build may still be working.");
    }
  };

  const requestPublishApproval = () => {
    if (!canManageProduction || !projectId || publishing || !previewUrl) return;
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
    if (!canManageProduction || !projectId || publishing) return;
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

  const publishNativeProject = async () => {
    if (!canPublishNative || !projectId || publishing || nativePublishingRef.current) return;
    const safeSlug = subdomainSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 63);
    if (safeSlug && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(safeSlug)) {
      setPublishFlow({ status: "failed", message: "Use 1–63 lowercase letters, numbers, or hyphens for the project address." });
      return;
    }
    nativePublishingRef.current = true;
    setPublishing(true);
    setPublishFlow({ status: "preparing", message: "Publishing your project…" });
    try {
      const token = await csrfToken();
      const headers = { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() };
      const capabilityResponse = await fetch(`/api/projects/${projectId}/runtime/publishing-capabilities`, {
        headers: authHeaders(),
      });
      const capability = await capabilityResponse.json().catch(() => ({}));
      if (!capabilityResponse.ok || capability.buildId !== "immutable-v2"
        || capability.publishProtocol !== "immutable-v2") {
        throw new Error("This staging server is not ready for immutable publishing. Refresh and try again.");
      }
      const publishHeaders = { ...headers, "X-Publish-Protocol": capability.publishProtocol };
      if (safeSlug && !nativeDeploymentComplete) {
        const settingsResponse = await fetch(`/api/projects/${projectId}/runtime/publishing-settings`, {
          method: "PUT",
          headers: publishHeaders,
          body: JSON.stringify({
            subdomainSlug: safeSlug,
            hostingProvider: "buildcustom",
            customDomain: "",
            customOrigin: "",
          }),
        });
        const settings = await settingsResponse.json().catch(() => ({}));
        if (!settingsResponse.ok) throw new Error(settings.message || "The project address could not be saved.");
        setSubdomainSlug(settings.subdomainSlug || safeSlug);
      }

      const response = await fetch(`/api/projects/${projectId}/runtime/publish-immutable-v2`, {
        method: "POST",
        headers: publishHeaders,
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The project could not be published.");
      const publicAvailable = typeof data.publicAvailable === "boolean"
        ? data.publicAvailable
        : publicGeneratedAppsEnabled;
      setNativeDeploymentComplete(true);
      setNativePublicAvailable(publicAvailable);
      setPublishFlow({
        status: "complete",
        message: publicAvailable ? "Published" : "Published internally; public apps are not enabled yet.",
      });
      await loadReleases().catch(() => undefined);
    } catch (error: any) {
      setPublishFlow({ status: "failed", message: error.message || "The project could not be published." });
    } finally {
      nativePublishingRef.current = false;
      setPublishing(false);
    }
  };

  const restoreReleaseToDevelopment = async () => {
    if (!canManageProduction || !projectId || !restoreCandidate || restoringRelease) return;
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
    if (!projectId || refreshingPreview || (nativeThink && previewEnvironment === "production")) return;
    setRefreshingPreview(true);
    try {
      if (previewEnvironment === "production") {
        const response = await fetch(`/api/projects/${projectId}/runtime/status`, { headers: authHeaders() });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "The production URL could not be refreshed.");
        setProductionUrl(data.deploymentUrl || "");
      } else {
        const token = await csrfToken();
        const response = await fetch(`/api/projects/${projectId}/runtime/previews`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
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
  const nativeHasDeployment = nativeDeploymentComplete;
  const nativePublicUrl = publicGeneratedAppUrl(
    subdomainSlug,
    publicGeneratedAppsEnabled && nativePublicAvailable !== false,
  );
  const deviceButtons = [
    { id: "desktop" as const, icon: Monitor, label: "Desktop" },
    { id: "tablet" as const, icon: Tablet, label: "Tablet" },
    { id: "mobile" as const, icon: Smartphone, label: "Mobile" },
  ];
  const activePreviewUrl = previewEnvironment === "development"
    ? previewUrl
    : nativeThink ? (nativeHasDeployment ? nativePublicUrl || "" : "") : productionUrl;
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
          {nativeThink && nativeCompletionPhase !== "idle"
            && (nativeCompletionPhase !== "success" || authoritativeBuildComplete) && (
            <span
              role="status"
              aria-live="polite"
              data-testid="native-completion-state"
              data-state={nativeCompletionPhase}
              className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${
                nativeCompletionPhase === "success"
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  : nativeCompletionPhase === "error"
                    ? /paused before completion/i.test(nativeCompletionMessage)
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                      : "border-red-400/30 bg-red-400/10 text-red-200"
                    : nativeCompletionPhase === "paused" || nativeCompletionPhase === "needs_input"
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                      : "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
              }`}
            >
              {nativeCompletionPhase === "success" ? "Build complete"
                : nativeCompletionPhase === "paused" ? "Continue available"
                  : nativeCompletionPhase === "needs_input" ? "Needs your input"
                    : nativeCompletionPhase === "error"
                      ? stopConfirmedRef.current ? "Stopped"
                        : nativeRecoveryUnverified ? "Status unverified"
                          : /paused before completion/i.test(nativeCompletionMessage) ? "Paused" : "Needs attention"
                      : nativeCompletionPhase === "starting" ? "Starting..."
                        : nativeCompletionPhase === "stopping" ? "Stopping…"
                          : nativeCompletionPhase === "recovering" ? "Checking status" : "Working"}
            </span>
          )}
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

        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="builder-chat-scroll">
          {nativeThink && currentNativeLifecycle?.taskId && (
            <NativeAutoContinueControl
              enabled={currentNativeLifecycle.autoContinue?.taskId === currentNativeLifecycle.taskId
                && currentNativeLifecycle.autoContinue?.enabled === true}
              busy={autoContinueSaving}
              onChange={handleAutoContinue}
            />
          )}
          {runtimeError && <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{runtimeError}</div>}
          {runtimeCapabilityError && <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{runtimeCapabilityError}</div>}
          {!currentRuntimeCapability && !runtimeCapabilityError && <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Checking project runtime…</p>}
          {canOfferNativeContinuation && (
            <section
              className={`rounded-xl border px-4 py-3 ${
                theme === "dark" ? "border-amber-300/20 bg-amber-300/[0.07]" : "border-amber-200 bg-amber-50"
              }`}
              aria-live="polite"
              data-testid="native-continuation-prompt"
            >
              <p className={`text-sm leading-relaxed ${theme === "dark" ? "text-white/85" : "text-gray-800"}`}>
                I made progress on your request, but I haven't finished everything yet. Would you like me to continue working?
              </p>
              <button
                type="button"
                onClick={() => void handleContinue()}
                disabled={sending || continuationInFlightRef.current || nativeRecoveryUnverified}
                className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                aria-busy={sending || continuationInFlightRef.current}
                data-testid="button-native-continue"
              >
                {sending || continuationInFlightRef.current ? "Continuing…" : "Continue"}
              </button>
            </section>
          )}
          {customerLifecycleStatus(currentNativeLifecycle) === "NEEDS_INPUT" && (
            <p className={`rounded-xl border px-4 py-3 text-sm ${
              theme === "dark" ? "border-amber-300/20 bg-amber-300/[0.07] text-amber-100" : "border-amber-200 bg-amber-50 text-amber-900"
            }`} role="status" data-testid="native-needs-input">
              Needs your input
            </p>
          )}
          {nativeCompletionPhase === "success" && authoritativeBuildComplete && (
            <p className={`rounded-xl border px-4 py-3 text-sm ${
              theme === "dark" ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100" : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`} role="status" data-testid="native-build-complete">
              Build complete. Your changes are ready to review.
            </p>
          )}
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
              {turn.mode !== "build" && <div className="flex justify-start">
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border px-4 py-3 text-sm leading-relaxed ${
                  theme === "dark" ? "border-white/10 bg-white/5 text-white/80" : "border-gray-200 bg-gray-100 text-gray-800"
                }`} data-testid={`builder-turn-plan-response-${turn.id}`}>
                  {normalizeBuilderAssistantText(turn.response)}
                </div>
              </div>}
              {turn.mode === "build" && (
                <details className={`group rounded-xl border ${
                  theme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-gray-200 bg-gray-50"
                }`} data-testid={`builder-turn-checkpoint-${turn.id}`}>
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
                    {turn.commitHash && canManageProduction && (
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
              {turn.mode === "build" && <div className="flex justify-start">
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border px-4 py-3 text-sm leading-relaxed ${
                  theme === "dark" ? "border-white/10 bg-white/5 text-white/80" : "border-gray-200 bg-gray-100 text-gray-800"
                }`} data-testid={`builder-turn-build-response-${turn.id}`}>
                  {normalizeBuilderAssistantText(turn.response)}
                </div>
              </div>}
            </div>
          ))}
          {messages
            .filter((msg) => msg.content.trim().length > 0
              && !(planningSession?.currentQuestion && msg.role === "assistant"
                && msg.content === planningSession.currentQuestion.prompt))
            .map((msg, i) => (
            <div key={msg.id || i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-gradient-to-r from-cyan-500 to-cyan-400 text-black rounded-br-md"
                  : theme === "dark"
                  ? "bg-white/5 text-white/80 border border-white/10 rounded-bl-md"
                  : "bg-gray-100 text-gray-800 border border-gray-200 rounded-bl-md"
              }`}>
                {msg.role === "assistant" ? normalizeBuilderAssistantText(msg.content) : msg.content}
              </div>
            </div>
          ))}
          {planningSession?.currentQuestion && (
            <ClarificationOptions
              theme={theme}
              question={planningSession.currentQuestion}
              selectedOptions={selectedClarificationOptions}
              disabled={sending || planningSaving || !planningLoaded}
              onToggle={(option) => setSelectedClarificationOptions((current) => (
                planningSession.currentQuestion?.multiple
                  ? current.includes(option) ? current.filter((item) => item !== option) : [...current, option]
                  : current.includes(option) ? [] : [option]
              ))}
              onSubmit={() => void handleSend(selectedClarificationOptions.join(", "), undefined, {
                selectedOptions: selectedClarificationOptions,
              })}
              onSkip={() => void handleSend("Skip", undefined, { planningAction: "skip" })}
              onYouDecide={() => void handleSend("You decide", undefined, { planningAction: "decide" })}
              onSomethingElse={() => {
                setChatInput("");
                window.setTimeout(() => textareaRef.current?.focus(), 0);
              }}
            />
          )}
          {planningSession?.phase === "awaiting_approval" && planningSession.mode === "plan" && (
            <section className={`rounded-2xl border p-4 ${
              theme === "dark" ? "border-teal-300/20 bg-[#101b20]" : "border-teal-900/10 bg-[#f5fbf9]"
            }`} data-testid="approved-plan-card">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${theme === "dark" ? "text-teal-200/70" : "text-teal-800/70"}`}>
                Review before building
              </p>
              <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${theme === "dark" ? "text-white/80" : "text-gray-700"}`}>
                {planningSession.planSummary}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleSend("", false, { approvePlan: true })}
                  disabled={planningSaving || sending || nativeRuntimeAlreadyWorking || nativeRecoveryUnverified || nativeConnectionRetry !== null}
                  className="min-h-10 rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-gray-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {planningSaving ? "Saving plan…" : "Approve and build"}
                </button>
                <button type="button" onClick={() => {
                  setChatInput("");
                  window.setTimeout(() => textareaRef.current?.focus(), 0);
                }} className={`min-h-10 rounded-xl border px-4 text-sm font-medium ${
                  theme === "dark" ? "border-white/10 text-white/70 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-white"
                }`}>
                  Add a note in chat
                </button>
              </div>
            </section>
          )}
          {planningSession?.phase === "submitted" && (
            <p className={`rounded-xl border px-3 py-2.5 text-xs leading-5 ${
              theme === "dark" ? "border-white/10 bg-white/[0.025] text-white/55" : "border-gray-200 bg-gray-50 text-gray-600"
            }`}>
              {nativeConnectionRetry
                ? "The approved plan and conversation are saved. The Agent connection failed before any build prompt was sent."
                : "The build request was sent. The editor will check the existing runtime state and will not submit it again."}
            </p>
          )}
          {nativeConnectionRetry && (
            <section
              className={`rounded-xl border px-3 py-3 ${
                theme === "dark" ? "border-amber-400/25 bg-amber-400/10" : "border-amber-200 bg-amber-50"
              }`}
              role="status"
              data-testid="native-connection-failed"
            >
              <p className={`text-xs leading-5 ${theme === "dark" ? "text-amber-100" : "text-amber-900"}`}>
                Connection failed. Your conversation and approved plan are saved. No build prompt was sent.
              </p>
              <button
                type="button"
                onClick={() => void handleRetryNativeConnection()}
                disabled={sending || nativeRuntimeAlreadyWorking || nativeRecoveryUnverified}
                className="mt-2 min-h-9 rounded-lg bg-cyan-400 px-3 text-xs font-semibold text-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-retry-native-connection"
              >
                Retry connection
              </button>
            </section>
          )}
          {nativeThink ? (
            <NativeBuildActivity
              projectId={projectId}
              theme={theme}
              phase={nativeConnectionRetry
                ? "error"
                : planningSession?.phase === "clarifying"
                ? "clarifying"
                : planningSession?.phase === "awaiting_approval"
                  ? "planning"
                    : planningSession?.phase === "submitted" && nativeCompletionPhase === "idle"
                    ? "recovering"
                    : nativeCompletionPhase === "error" && /paused before completion/i.test(nativeCompletionMessage)
                      ? "paused"
                    : nativeCompletionPhase === "idle" && sending ? "starting" : nativeCompletionPhase as BuilderPhase}
              message={planningSession?.phase === "submitted" && !nativeCompletionMessage
                ? "A build request was sent. Checking the existing runtime state."
                : nativeCompletionMessage}
              startedAt={nativeOperationStartedAt}
              events={nativeProgress}
              connectionState={nativeConnected ? "Connected" : nativeCompletionPhase === "idle" ? "Idle" : "Disconnected"}
            />
          ) : projectId > 0 && sending && (
            <BuildActivity
              projectId={projectId}
              theme={theme}
              isBuilding={sending}
            />
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
          {!planningLoaded && currentRuntimeCapability && (
            <p
              className={`mb-2 text-[11px] ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}
              role="status"
              data-testid="planning-load-status"
            >
              Restoring saved planning. You can type while it loads.
            </p>
          )}
          {planningLoaded && planningLoadError && (
            <div
              className={`mb-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] ${
                theme === "dark" ? "border-amber-400/25 bg-amber-400/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
              role="status"
              data-testid="planning-load-error"
            >
              <span>{planningLoadError}</span>
              <button
                type="button"
                onClick={() => setPlanningReloadKey((value) => value + 1)}
                className="shrink-0 font-semibold underline underline-offset-2"
                data-testid="button-retry-planning"
              >
                Retry
              </button>
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
              disabled={!currentRuntimeCapability || planningSaving || (nativeThink && (sending || nativeRuntimeAlreadyWorking || nativeRecoveryUnverified || nativeConnectionRetry !== null))}
              placeholder={!currentRuntimeCapability
                ? "Checking project runtime…"
                : planningSession?.phase === "clarifying"
                  ? "Reply here in the chat…"
                  : planningSession?.phase === "awaiting_approval"
                    ? "Add a note to the plan, or approve it above…"
                    : "Describe what you want to build…"}
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
                {!nativeThink && <button
                  onClick={() => setPlanMode((value) => !value)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${planMode ? "border-purple-400/50 bg-purple-400/15 text-purple-200" : theme === "dark" ? "border-white/10 text-white/45 hover:text-white/75" : "border-gray-200 text-gray-500 hover:text-gray-800"}`}
                  title="Plan only. No workspace files will be changed."
                  aria-pressed={planMode}
                  data-testid="button-plan-toggle"
                >Plan</button>
                }
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
                disabled={!currentRuntimeCapability || !planningLoaded || planningSaving || (nativeThink && (sending || nativeRuntimeAlreadyWorking || nativeRecoveryUnverified))}
                className="shrink-0 p-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-black transition-colors disabled:cursor-not-allowed disabled:opacity-40"
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
            {(canManageProduction ? ["development", "production"] as const : ["development"] as const).map((environment) => (
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
                  ? nativeThink && nativeHasDeployment ? "Not publicly available yet" : "Not published yet"
                  : projectId ? "Waiting for an Agent preview…" : "Select a runtime project"
                )}
              </div>
            )}
          </form>
          {canPublishNative && <button
            onClick={() => {
              setPublishDrawerOpen(true);
              setPublishFlow(nativeHasDeployment
                ? { status: "complete", message: "Published" }
                : { status: "idle", message: "" });
            }}
            disabled={publishing}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-400 text-black hover:bg-cyan-300 disabled:opacity-40 text-xs font-semibold transition-colors"
            data-testid="button-open-native-publish"
          >
            {publishing ? <RefreshCw size={13} className="animate-spin" /> : <Rocket size={13} />}
            {publishing ? "Publishing" : "Publish"}
          </button>}
          {canManageProduction && <button
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
          </button>}
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
          {publishDrawerOpen && (canManageProduction || canPublishNative) && (
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
                    <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{nativeThink ? "Publish your project and view its public address" : "Subdomain, custom domain, progress, and releases"}</p>
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
                  {nativeThink ? (
                    <section className={`space-y-5 rounded-2xl border p-4 ${theme === "dark" ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-gray-50"}`} data-testid="native-publish-panel">
                      <div>
                        <label htmlFor="native-publish-slug" className="mb-2 block text-xs font-semibold">
                          {publicGeneratedAppsEnabled ? "Project address (optional)" : "Reserved project address (not live)"}
                        </label>
                        <div className={`flex overflow-hidden rounded-xl border focus-within:border-cyan-400/60 ${theme === "dark" ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                          <input
                            id="native-publish-slug"
                            value={subdomainSlug.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 63)}
                            onChange={(event) => setSubdomainSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 63))}
                            disabled={nativeHasDeployment || publishing}
                            maxLength={63}
                            aria-label="Project address"
                            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-right text-sm outline-none disabled:cursor-not-allowed disabled:opacity-55"
                            data-testid="input-native-publish-slug"
                          />
                          <span className={`flex items-center border-l px-3 text-sm ${theme === "dark" ? "border-white/10 text-white/45" : "border-gray-200 text-gray-500"}`}>.apps.buildcustom.ai</span>
                        </div>
                      </div>
                      <div role="status" aria-live="polite" data-testid="native-publish-status">
                        <div className="flex items-center gap-2">
                          {publishing ? <RefreshCw size={15} className="animate-spin text-cyan-400" /> :
                            publishFlow.status === "failed" ? <X size={15} className="text-red-400" /> :
                            publishFlow.status === "complete" || nativeHasDeployment ? <Check size={15} className="text-emerald-400" /> :
                            <Cloud size={15} className="text-cyan-400" />}
                          <span className="text-sm font-semibold">
                            {publishing ? "Publishing" : publishFlow.status === "failed" ? "Publish failed"
                              : nativeHasDeployment ? (nativePublicUrl ? "Published" : "Published internally")
                              : publishFlow.status === "complete" ? (nativePublicUrl ? "Published" : "Published internally")
                              : "Ready to publish"}
                          </span>
                        </div>
                        {publishFlow.status === "failed" && <p role="alert" className={`mt-2 text-xs ${theme === "dark" ? "text-red-300" : "text-red-600"}`}>{publishFlow.message}</p>}
                        {nativePublicUrl && nativeHasDeployment ? (
                          <a href={nativePublicUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex max-w-full items-center gap-1.5 break-all text-xs font-semibold text-cyan-400 underline" data-testid="link-native-public-url">
                            <ExternalLink size={13} className="shrink-0" />{nativePublicUrl}
                          </a>
                        ) : nativeHasDeployment || !publicGeneratedAppsEnabled || nativePublicAvailable === false ? (
                          <p className={`mt-2 text-xs ${theme === "dark" ? "text-amber-200/80" : "text-amber-700"}`} data-testid="native-public-apps-disabled">
                            {nativeHasDeployment
                              ? publicGeneratedAppsEnabled
                                ? "This deployment is not publicly available yet."
                                : "This deployment is internal only; its private address is hidden until public apps are enabled."
                              : publicGeneratedAppsEnabled
                                ? "A public address is not available yet."
                                : "Public generated apps are not enabled yet. This reserved address will not be live until the public gateway is enabled."}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={publishNativeProject}
                        disabled={publishing}
                        className="w-full rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-black hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="button-publish-native"
                      >
                        {publishing ? "Publishing…" : nativeHasDeployment ? "Publish updates" : "Publish"}
                      </button>
                    </section>
                  ) : (
                  <>
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
                  </>
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
                  sandbox="allow-scripts allow-forms"
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
                <div className="h-full w-full">
                  <BuildPreviewPlaceholder
                    theme={theme}
                    phase={planningSession?.phase === "clarifying"
                      ? "clarifying"
                      : planningSession?.phase === "awaiting_approval"
                        ? "planning"
                        : planningSession?.phase === "submitted" && nativeCompletionPhase === "idle"
                          ? "recovering"
                          : nativeCompletionPhase === "error" && /paused before completion/i.test(nativeCompletionMessage)
                            ? "paused"
                          : nativeThink
                            ? nativeCompletionPhase === "idle" && sending ? "starting" : nativeCompletionPhase as BuilderPhase
                            : sending ? "running" : "idle"}
                    message={planningSession?.phase === "submitted" && !nativeCompletionMessage
                      ? "A build request was sent. Checking the existing runtime state."
                      : nativeCompletionMessage || (projectId ? "" : "A project is required for a live preview.")}
                    startedAt={nativeOperationStartedAt}
                    failureCode={nativeBuildFailure?.errorCode}
                    lastSuccessfulStage={nativeBuildFailure?.lastSuccessfulStage}
                    attemptId={nativeBuildFailure?.attemptId}
                    diagnosticsAvailable={nativeBuildFailure?.diagnosticsAvailable}
                    onContinue={() => {
                      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                      textareaRef.current?.focus();
                    }}
                    onOpenActivity={(attemptId) => {
                      if (projectId <= 0) return;
                      const activityParams = new URLSearchParams({ tab: "activity" });
                      if (attemptId) activityParams.set("attempt", attemptId);
                      const activityHref = `/app/project/${projectId}?${activityParams.toString()}`;
                      const activityWindow = window.open(activityHref, "_blank");
                      if (activityWindow) {
                        // Keep the sessionStorage activity snapshot cloned into the new same-origin tab,
                        // then sever its opener relationship.
                        activityWindow.opener = null;
                      } else {
                        navigate(activityHref);
                      }
                    }}
                  />
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
    { id: "api", label: "AI Provider", icon: Key },
    { id: "security", label: "Security", icon: Shield },
    ...(getAppUser()?.role === "user" ? [{ id: "support", label: "Support Access", icon: LifeBuoy }] : []),
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
          {activeTab === "support" && <CustomerSupportAccessPage />}
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
      const token = await csrfToken();
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
        body: JSON.stringify({ name: form.name.trim() }),
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
            readOnly
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
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [providerId, setProviderId] = useState("anthropic");
  const [modelId, setModelId] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [models, setModels] = useState<Array<{ id: string; label: string; providerModelId: string }>>([]);
  const [unavailableModels, setUnavailableModels] = useState<Array<{ providerModelId: string; label: string; reason: string }>>([]);
  const [useOwnKey, setUseOwnKey] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sessionExpiredMessage = "Your session could not be verified. Sign in again to continue.";

  async function readResponse(response: Response, fallback: string) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        clearAppUser();
        throw new Error(sessionExpiredMessage);
      }
      throw new Error(data.message || fallback);
    }
    return data;
  }

  const settings = useQuery({
    queryKey: ["ai-credentials"],
    queryFn: async () => {
      const response = await fetch("/api/ai-credentials", {
        credentials: "same-origin",
        headers: authHeaders(),
      });
      const data = await readResponse(response, "AI provider settings could not be loaded.");
      return data as {
        mode: "managed" | "byok";
        provider: string | null;
        modelId: string | null;
        keySaved: boolean;
        byokAvailable: boolean;
        providers: Array<{ id: string; label: string }>;
      };
    },
  });

  useEffect(() => {
    if (!settings.data) return;
    setUseOwnKey(settings.data.mode === "byok");
    if (settings.data.provider) setProviderId(settings.data.provider);
    if (settings.data.modelId) setModelId(settings.data.modelId);
  }, [settings.data]);

  const connect = useMutation({
    mutationFn: async () => {
      const token = await csrfToken();
      const response = await fetch("/api/ai-credentials/connect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
        body: JSON.stringify({ provider: providerId, apiKey }),
      });
      return readResponse(response, "The provider could not be connected.");
    },
    onSuccess: async (data) => {
      setApiKey("");
      setError("");
      setUseOwnKey(true);
      setModels(data.models || []);
      setUnavailableModels(data.unavailable || []);
      setModelId(data.modelId || "");
      setMessage(data.projectsPending
        ? `Provider model list verified and key saved securely. ${data.projectsPending} existing project(s) will update when they reconnect.`
        : "Provider model list verified and key saved securely. Choose a compatible model below.");
      await queryClient.invalidateQueries({ queryKey: ["ai-credentials"] });
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message);
    },
  });

  const refreshModels = useMutation({
    mutationFn: async () => {
      const token = await csrfToken();
      const response = await fetch("/api/ai-credentials/models", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": token, ...authHeaders() },
      });
      return readResponse(response, "Available models could not be refreshed.");
    },
    onSuccess: (data) => {
      setModels(data.models || []);
      setUnavailableModels(data.unavailable || []);
      setModelId((current) => data.models?.find((model: { id: string }) => model.id === current)?.id
        || data.models?.find((model: { id: string }) => model.id === data.modelId)?.id
        || data.models?.[0]?.id
        || "");
      setError("");
      setMessage("Model list refreshed. Provider model listing does not guarantee generation access or available billing.");
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message);
    },
  });

  const useModel = useMutation({
    mutationFn: async () => {
      const token = await csrfToken();
      const response = await fetch("/api/ai-credentials/model", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
        body: JSON.stringify({ modelId }),
      });
      return readResponse(response, "The selected model could not be saved.");
    },
    onSuccess: async (data) => {
      setError("");
      setMessage(data.projectsPending
        ? `Model saved. ${data.projectsPending} existing project(s) will update when they reconnect.`
        : "Model saved and applied to your eligible projects.");
      await queryClient.invalidateQueries({ queryKey: ["ai-credentials"] });
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message);
    },
  });

  const useManaged = useMutation({
    mutationFn: async () => {
      const token = await csrfToken();
      const response = await fetch("/api/ai-credentials", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": token, ...authHeaders() },
      });
      return readResponse(response, "BuildCustom AI could not be selected.");
    },
    onSuccess: async (data) => {
      setApiKey("");
      setModels([]);
      setUnavailableModels([]);
      setError("");
      setUseOwnKey(false);
      setMessage(data.projectsPending
        ? `BuildCustom AI is selected. ${data.projectsPending} existing project(s) will update when they reconnect.`
        : "BuildCustom AI is selected for your projects.");
      await queryClient.invalidateQueries({ queryKey: ["ai-credentials"] });
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message);
    },
  });

  const fieldClass = `w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${
    theme === "dark"
      ? "bg-white/5 border-white/10 text-white focus:border-cyan-400/50"
      : "bg-gray-50 border-gray-200 text-gray-900 focus:border-cyan-400"
  }`;

  if (settings.isLoading) {
    return <SettingsCard title="AI Provider" description="Choose how your Builder requests use AI.">Loading settings…</SettingsCard>;
  }

  if (settings.isError) {
    return <SettingsCard title="AI Provider" description="Choose how your Builder requests use AI.">
      <p className="text-sm text-red-400">{(settings.error as Error).message}
        {(settings.error as Error).message === sessionExpiredMessage && <> <a href="/login" className="underline">Sign in again</a>.</>}
      </p>
    </SettingsCard>;
  }

  const savedKey = settings.data?.keySaved === true;
  const connectedForSelectedProvider = savedKey && settings.data?.provider === providerId;
  const visibleModels = models.filter((model) => {
    const term = modelSearch.trim().toLowerCase();
    return !term || `${model.label} ${model.providerModelId}`.toLowerCase().includes(term);
  });
  const sessionExpired = error === sessionExpiredMessage;

  return (
    <>
      <SettingsCard title="AI Provider" description="Use BuildCustom’s managed Gemini by default, or connect a supported provider key.">
        {settings.data?.byokAvailable !== true && (
          <p className={`rounded-xl border px-4 py-3 mb-4 text-sm ${
            theme === "dark" ? "border-amber-400/20 bg-amber-400/5 text-amber-200/80" : "border-amber-200 bg-amber-50 text-amber-800"
          }`}>
            Bring-your-own-key setup is not available yet. BuildCustom AI remains the default.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setError("");
              if (savedKey) useManaged.mutate();
              else setUseOwnKey(false);
            }}
            className={`text-left rounded-xl border p-4 transition-colors ${
              !useOwnKey
                ? "border-cyan-400/60 bg-cyan-400/10"
                : theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"
            }`}
            data-testid="button-managed-ai"
          >
            <span className="block text-sm font-semibold">BuildCustom AI</span>
            <span className={`block text-xs mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
              Managed Gemini. No provider key setup required.
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setUseOwnKey(true); setMessage(""); setError(""); }}
            disabled={settings.data?.byokAvailable !== true}
            className={`text-left rounded-xl border p-4 transition-colors disabled:opacity-50 ${
              useOwnKey
                ? "border-cyan-400/60 bg-cyan-400/10"
                : theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"
            }`}
            data-testid="button-own-ai-key"
          >
            <span className="block text-sm font-semibold">Use my provider key</span>
            <span className={`block text-xs mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
              Google AI Studio, OpenAI, Anthropic, or xAI.
            </span>
          </button>
        </div>

        {useOwnKey && (
          <div className="space-y-4">
            <div>
              <label htmlFor="ai-provider" className="block text-sm font-medium mb-2">AI provider</label>
              <select
                id="ai-provider"
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setModels([]);
                  setUnavailableModels([]);
                  setModelSearch("");
                  setMessage("");
                  setError("");
                }}
                className={fieldClass}
                data-testid="select-ai-provider"
              >
                {(settings.data?.providers || []).map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ai-provider-key" className="block text-sm font-medium mb-2">Provider API key</label>
              <input
                id="ai-provider-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={connectedForSelectedProvider ? "Enter a new key to replace the saved key" : "Paste your provider API key"}
                className={fieldClass}
                data-testid="input-ai-provider-key"
              />
              <p className={`text-xs mt-2 ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
                The key is checked with the provider’s model-list API, encrypted before storage, and never shown again. Provider charges apply; BuildCustom AI credits are not used for these requests.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setError(""); setMessage(""); connect.mutate(); }}
              disabled={!settings.data?.byokAvailable || !apiKey.trim() || connect.isPending}
              className="px-5 py-2.5 rounded-xl bg-cyan-400 text-black font-semibold text-sm disabled:opacity-50"
              data-testid="button-connect-ai-provider"
            >
              {connect.isPending ? "Checking provider…" : connectedForSelectedProvider ? "Replace provider key" : "Connect provider"}
            </button>

            {connectedForSelectedProvider && (
              <div className="space-y-3 rounded-xl border border-white/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      Saved key for {settings.data?.providers.find((provider) => provider.id === providerId)?.label || providerId}
                    </p>
                    <p className={`text-xs mt-1 ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
                      Model listing confirms this key can list models, not generation access or billing.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshModels.mutate()}
                    disabled={refreshModels.isPending}
                    className={`px-3 py-2 rounded-lg border text-sm disabled:opacity-50 ${theme === "dark" ? "border-white/15" : "border-gray-200"}`}
                    data-testid="button-refresh-ai-models"
                  >
                    {refreshModels.isPending ? "Refreshing…" : "Refresh models"}
                  </button>
                </div>
                {models.length > 0 && (
                  <>
                    <label htmlFor="ai-model-search" className="block text-sm font-medium">Search compatible models</label>
                    <input
                      id="ai-model-search"
                      value={modelSearch}
                      onChange={(event) => setModelSearch(event.target.value)}
                      placeholder="Search by name or exact model ID"
                      className={fieldClass}
                      data-testid="input-ai-model-search"
                    />
                    <label htmlFor="ai-provider-model" className="block text-sm font-medium">Provider model</label>
                    <select
                      id="ai-provider-model"
                      value={modelId}
                      onChange={(event) => setModelId(event.target.value)}
                      className={fieldClass}
                      data-testid="select-ai-provider-model"
                    >
                      {visibleModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label} · {model.providerModelId}
                        </option>
                      ))}
                    </select>
                    {modelId !== settings.data?.modelId && (
                      <button
                        type="button"
                        onClick={() => useModel.mutate()}
                        disabled={!modelId || useModel.isPending}
                        className="px-5 py-2.5 rounded-xl bg-cyan-400 text-black font-semibold text-sm disabled:opacity-50"
                        data-testid="button-use-ai-model"
                      >
                        {useModel.isPending ? "Saving model…" : "Use this model"}
                      </button>
                    )}
                  </>
                )}
                {unavailableModels.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer">
                      {unavailableModels.length} model(s) unavailable for the coding agent
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {unavailableModels.map((model) => (
                        <li key={model.providerModelId}>
                          <span className="font-medium">{model.label}</span> ({model.providerModelId}): {model.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
          {sessionExpired && <> <a href="/login" className="underline">Sign in again</a>.</>}
        </p>}
        {message && <p role="status" className="mt-4 text-sm text-emerald-400">{message}</p>}
        {savedKey && (
          <p className={`mt-4 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
            A provider key is saved for {settings.data?.provider}. BuildCustom does not return the key to this page.
          </p>
        )}
      </SettingsCard>
    </>
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
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        role={user.role}
        email={user.email}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <AppTopBar />
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/app" component={ProjectsPage} />
            <Route path="/app/templates" component={TemplatesPage} />
            <Route path="/app/editor" component={EditorPage} />
            <Route path="/app/editor/:id" component={EditorPage} />
            {isAdminUser(user) && <Route path="/app/admin/customers/:customerId" component={AdminCustomerDetailPage} />}
            {isAdminUser(user) && <Route path="/app/admin/support-sessions/:sessionId" component={AdminSupportWorkspacePage} />}
            {isAdminUser(user) && <Route path="/app/admin/projects" component={AdminProjectsPage} />}
            {isAdminUser(user) && <Route path="/app/users" component={UsersPage} />}
            {isAdminUser(user) && <Route path="/app/analytics" component={AnalyticsPage} />}
            {isAdminUser(user) && <Route path="/app/billing" component={BillingPage} />}
            {isAdminUser(user) && <Route path="/app/support" component={SupportPage} />}
            {!isAdminUser(user) && <Route path="/app/support" component={CustomerSupportTicketsPage} />}
            {isAdminUser(user) && <Route path="/app/deployments" component={DeploymentsPage} />}
            {isAdminUser(user) && <Route path="/app/system-health" component={SystemHealthPage} />}
            {ownerAuthorizationVisible(user.email, user.role)
              && <Route path="/app/owner-authorization" component={OwnerBootstrapPage} />}
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
  const [checkingSession, setCheckingSession] = useState(true);
  const [, navigate] = useLocation();

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Unable to refresh account");
        return res.json();
      })
      .then((user: AppUser | null) => {
        if (!active) return;
        if (!user) { setCurrentUser(null); navigate("/login"); return; }
        setAppUser(user);
        setCurrentUser(user);
      })
      .catch(() => { if (active) { setCurrentUser(null); navigate("/login"); } })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, [navigate]);

  if (checkingSession || !appUser) return null;

  return (
    <ThemeProvider>
      <AppDashboardContent user={appUser} />
    </ThemeProvider>
  );
}
