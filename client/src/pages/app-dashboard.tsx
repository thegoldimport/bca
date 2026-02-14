import { useState } from "react";
import { Route, Switch, useLocation, Link } from "wouter";
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
} from "lucide-react";
import logo from "@/assets/logo.png";
import previewPortfolio from "@/assets/preview-portfolio.jpg";
import previewFitness from "@/assets/preview-fitness.jpg";
import previewGame from "@/assets/preview-game.jpg";
import previewEcommerce from "@/assets/preview-ecommerce.jpg";
import { ThemeProvider, useTheme } from "@/contexts/theme-context";
import { UsersPage, AnalyticsPage, BillingPage, SupportPage, DeploymentsPage } from "@/pages/app-admin-pages";

type UserRole = "super_admin" | "user";
const CURRENT_USER_ROLE: UserRole = "super_admin";

function AppSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  const baseItems = [
    { path: "/app", icon: LayoutGrid, label: "Projects" },
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
            <img src={logo} alt="BuildCustom.Ai" className="h-8 w-auto" />
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={`font-display font-semibold text-lg whitespace-nowrap ${
                  theme === "dark" ? "text-white" : "text-gray-900"
                }`}
              >
              </motion.span>
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
          const showDivider = CURRENT_USER_ROLE === "super_admin" && item.path === "/app/users";
          return (
            <div key={item.path}>
              {showDivider && (
                <div className={`my-3 mx-2 border-t ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
                  {!collapsed && (
                    <span className={`block text-[10px] uppercase tracking-widest font-semibold mt-3 mb-1 px-1 ${
                      theme === "dark" ? "text-white/25" : "text-gray-400"
                    }`}>Admin</span>
                  )}
                </div>
              )}
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

      <div className="flex items-center gap-4">
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
          theme === "dark"
            ? "hover:bg-white/5"
            : "hover:bg-gray-100"
        }`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
            U
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-brand-gradient">{CURRENT_USER_ROLE === "super_admin" ? "Admin" : "User"}</p>
            <p className={`text-xs ${
              theme === "dark" ? "text-white/50" : "text-gray-500"
            }`}>{CURRENT_USER_ROLE === "super_admin" ? "Super Admin" : "Pro Plan"}</p>
          </div>
          <ChevronDown size={14} className={theme === "dark" ? "text-white/40" : "text-gray-400"} />
        </div>
      </div>
    </header>
  );
}

const DEMO_PROJECTS = [
  { id: "1", name: "Portfolio Website", type: "website", icon: Globe, status: "live", lastEdited: "2 hours ago", url: "portfolio.buildcustom.ai", preview: previewPortfolio },
  { id: "2", name: "Fitness Tracker", type: "app", icon: Smartphone, status: "draft", lastEdited: "1 day ago", url: null, preview: previewFitness },
  { id: "3", name: "Space Invaders", type: "game", icon: Gamepad2, status: "live", lastEdited: "3 days ago", url: "spacegame.buildcustom.ai", preview: previewGame },
  { id: "4", name: "E-Commerce Store", type: "saas", icon: ShoppingBag, status: "building", lastEdited: "5 hours ago", url: null, preview: previewEcommerce },
];

function ProjectsPage() {
  const { theme } = useTheme();
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">Projects</h1>
          <p className={`mt-1 ${
            theme === "dark" ? "text-white/50" : "text-gray-500"
          }`}>Build, manage, and deploy your creations</p>
        </div>
        <button
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
          className={`rounded-2xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-colors min-h-[240px] ${
            theme === "dark"
              ? "border-white/20 hover:border-cyan-400/50 hover:bg-cyan-500/5"
              : "border-gray-300 hover:border-cyan-400 hover:bg-cyan-50"
          }`}
          data-testid="card-create-project"
        >
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
            theme === "dark"
              ? "bg-white/10"
              : "bg-gray-100"
          }`}>
            <Sparkles size={24} className="text-cyan-400" />
          </div>
          <div className="text-center">
            <p className={`font-semibold ${
              theme === "dark" ? "text-white" : "text-gray-900"
            }`}>Start from Scratch</p>
            <p className={`text-sm mt-1 ${
              theme === "dark" ? "text-white/50" : "text-gray-500"
            }`}>Describe your idea and let AI build it</p>
          </div>
        </motion.div>

        {DEMO_PROJECTS.map((project) => (
          <motion.div
            key={project.id}
            whileHover={{ scale: 1.02, y: -2 }}
            onMouseEnter={() => setHoveredProject(project.id)}
            onMouseLeave={() => setHoveredProject(null)}
            className={`rounded-2xl border cursor-pointer transition-all relative overflow-hidden flex flex-col ${
              theme === "dark"
                ? "bg-white/[0.03] border-white/10 hover:border-white/20 hover:bg-white/[0.06]"
                : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-lg"
            }`}
            data-testid={`card-project-${project.id}`}
          >
            <div className="relative w-full h-40 overflow-hidden">
              <img
                src={project.preview}
                alt={`${project.name} preview`}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className={`absolute inset-0 ${
                theme === "dark"
                  ? "bg-gradient-to-t from-[#0a0a12] via-transparent to-transparent"
                  : "bg-gradient-to-t from-white via-transparent to-transparent"
              }`} />
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
                    theme === "dark"
                      ? "bg-gradient-to-br from-cyan-500/20 to-purple-500/20"
                      : "bg-gradient-to-br from-cyan-50 to-purple-50"
                  }`}>
                    <project.icon size={18} className="text-cyan-400" />
                  </div>
                  <div>
                    <h3 className={`font-semibold ${
                      theme === "dark" ? "text-white" : "text-gray-900"
                    }`}>{project.name}</h3>
                    <p className={`text-xs capitalize ${
                      theme === "dark" ? "text-white/40" : "text-gray-500"
                    }`}>{project.type}</p>
                  </div>
                </div>
                <button
                  className={`p-1.5 rounded-lg transition-colors ${
                    theme === "dark"
                      ? "hover:bg-white/10 text-white/40"
                      : "hover:bg-gray-100 text-gray-400"
                  }`}
                  data-testid={`button-project-menu-${project.id}`}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>

              <div className={`mt-auto pt-3 border-t flex items-center gap-1.5 ${
                theme === "dark" ? "border-white/10" : "border-gray-100"
              }`}>
                <Clock size={13} className={theme === "dark" ? "text-white/30" : "text-gray-400"} />
                <span className={`text-xs ${
                  theme === "dark" ? "text-white/40" : "text-gray-500"
                }`}>{project.lastEdited}</span>
                {project.url && (
                  <>
                    <span className={`mx-1.5 ${theme === "dark" ? "text-white/20" : "text-gray-300"}`}>·</span>
                    <ExternalLink size={12} className="text-cyan-400/60" />
                    <span className="text-xs text-cyan-400/80">{project.url}</span>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function EditorPage() {
  const { theme } = useTheme();
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "assistant", content: "Hi! I'm your AI builder. Describe what you'd like to create and I'll build it for you." },
  ]);

  const handleSend = () => {
    if (!chatInput.trim()) return;
    setMessages((prev) => [
      ...prev,
      { role: "user" as const, content: chatInput },
      { role: "assistant" as const, content: "I'm working on building that for you. This is a preview of the builder interface — the actual AI generation will be powered by the VibeSdk on app.buildcustom.ai." },
    ]);
    setChatInput("");
  };

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
          <div className={`flex-1 px-4 py-1.5 rounded-lg text-center text-xs ${
            theme === "dark"
              ? "bg-white/5 text-white/40"
              : "bg-gray-200 text-gray-500"
          }`}>
            preview.buildcustom.ai
          </div>
          <button className={`p-1.5 rounded-lg transition-colors ${
            theme === "dark"
              ? "hover:bg-white/10 text-white/40"
              : "hover:bg-gray-200 text-gray-400"
          }`}>
            <ExternalLink size={14} />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className={`w-20 h-20 rounded-2xl mx-auto flex items-center justify-center ${
              theme === "dark"
                ? "bg-white/5 border border-white/10"
                : "bg-gray-100 border border-gray-200"
            }`}>
              <Code2 size={32} className="text-cyan-400/60" />
            </div>
            <div>
              <p className="font-display font-semibold text-lg text-brand-gradient">Preview Area</p>
              <p className={`text-sm mt-1 max-w-xs ${
                theme === "dark" ? "text-white/30" : "text-gray-400"
              }`}>
                Describe your project in the chat and watch it come to life here in real-time
              </p>
            </div>
          </div>
        </div>
      </div>
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
  return (
    <>
      <SettingsCard title="Profile" description="Manage your account details">
        <div className="flex items-center gap-5 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white font-bold text-xl">
            U
          </div>
          <button className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            theme === "dark"
              ? "bg-white/10 text-white hover:bg-white/15"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}>Change Avatar</button>
        </div>
        <SettingsInput label="Full Name" value="User" />
        <SettingsInput label="Email" value="user@example.com" type="email" />
        <button className="px-5 py-2.5 rounded-xl bg-cyan-400 text-black font-semibold text-sm hover:bg-cyan-300 transition-colors mt-2" data-testid="button-save-profile">
          Save Changes
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
  return (
    <>
      <SettingsCard title="Password" description="Update your password">
        <SettingsInput label="Current Password" value="" type="password" />
        <SettingsInput label="New Password" value="" type="password" />
        <SettingsInput label="Confirm Password" value="" type="password" />
        <button className="px-5 py-2.5 rounded-xl bg-cyan-400 text-black font-semibold text-sm hover:bg-cyan-300 transition-colors mt-2" data-testid="button-update-password">
          Update Password
        </button>
      </SettingsCard>
      <SettingsCard title="Two-Factor Authentication" description="Add an extra layer of security">
        <button className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
          theme === "dark"
            ? "bg-white/10 text-white hover:bg-white/15"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
        }`} data-testid="button-enable-2fa">
          Enable 2FA
        </button>
      </SettingsCard>
    </>
  );
}

function AppDashboardContent() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { theme } = useTheme();

  return (
    <div className={`flex h-screen overflow-hidden ${
      theme === "dark"
        ? "bg-[#060610]"
        : "bg-gray-50"
    }`}>
      <AppSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <AppTopBar />
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/app" component={ProjectsPage} />
            <Route path="/app/editor" component={EditorPage} />
            <Route path="/app/editor/:id" component={EditorPage} />
            <Route path="/app/users" component={UsersPage} />
            <Route path="/app/analytics" component={AnalyticsPage} />
            <Route path="/app/billing" component={BillingPage} />
            <Route path="/app/support" component={SupportPage} />
            <Route path="/app/deployments" component={DeploymentsPage} />
            <Route path="/app/settings" component={SettingsPage} />
            <Route>{() => <ProjectsPage />}</Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}

export default function AppDashboard() {
  return (
    <ThemeProvider>
      <AppDashboardContent />
    </ThemeProvider>
  );
}
