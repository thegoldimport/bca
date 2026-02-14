import { useState } from "react";
import {
  Search,
  MoreHorizontal,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  FolderGit2,
  Globe,
  DollarSign,
  TrendingUp,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquare,
  ExternalLink,
  Filter,
  Download,
  RefreshCw,
  Zap,
  Server,
  HardDrive,
  Cpu,
  Wifi,
  Ban,
  Eye,
  Mail,
} from "lucide-react";
import { useTheme } from "@/contexts/theme-context";

const DEMO_USERS = [
  { id: "1", name: "Alex Johnson", email: "alex@example.com", plan: "Pro", status: "active", projects: 8, joined: "Jan 15, 2026", avatar: "AJ" },
  { id: "2", name: "Sarah Chen", email: "sarah@example.com", plan: "Enterprise", status: "active", projects: 23, joined: "Dec 3, 2025", avatar: "SC" },
  { id: "3", name: "Mike Rivera", email: "mike@example.com", plan: "Starter", status: "active", projects: 2, joined: "Feb 1, 2026", avatar: "MR" },
  { id: "4", name: "Emily Park", email: "emily@example.com", plan: "Pro", status: "suspended", projects: 5, joined: "Nov 20, 2025", avatar: "EP" },
  { id: "5", name: "David Kim", email: "david@example.com", plan: "Pro", status: "active", projects: 12, joined: "Jan 28, 2026", avatar: "DK" },
  { id: "6", name: "Lisa Zhang", email: "lisa@example.com", plan: "Starter", status: "active", projects: 1, joined: "Feb 10, 2026", avatar: "LZ" },
  { id: "7", name: "Tom Wilson", email: "tom@example.com", plan: "Enterprise", status: "active", projects: 31, joined: "Oct 5, 2025", avatar: "TW" },
  { id: "8", name: "Nina Patel", email: "nina@example.com", plan: "Pro", status: "inactive", projects: 0, joined: "Dec 18, 2025", avatar: "NP" },
];

export function UsersPage() {
  const { theme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");

  const filtered = DEMO_USERS.filter((u) => {
    const matchesSearch = u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPlan = filterPlan === "all" || u.plan.toLowerCase() === filterPlan;
    return matchesSearch && matchesPlan;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">Users</h1>
          <p className={`mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
            {DEMO_USERS.length} total users · {DEMO_USERS.filter((u) => u.status === "active").length} active
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 35%, #a855f7 65%, #ec4899 100%)" }}
          data-testid="button-export-users"
        >
          <Download size={16} className="text-white" />
          <span className="text-white">Export</span>
        </button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl flex-1 max-w-md ${
          theme === "dark" ? "bg-white/5 border border-white/10" : "bg-gray-100 border border-gray-200"
        }`}>
          <Search size={16} className={theme === "dark" ? "text-white/40" : "text-gray-400"} />
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`bg-transparent border-none outline-none text-sm w-full ${
              theme === "dark" ? "text-white placeholder-white/40" : "text-gray-900 placeholder-gray-400"
            }`}
            data-testid="input-search-users"
          />
        </div>
        <select
          value={filterPlan}
          onChange={(e) => setFilterPlan(e.target.value)}
          className={`px-4 py-2.5 rounded-xl text-sm border outline-none ${
            theme === "dark"
              ? "bg-white/5 border-white/10 text-white"
              : "bg-white border-gray-200 text-gray-900"
          }`}
          data-testid="select-filter-plan"
        >
          <option value="all">All Plans</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      <div className={`rounded-2xl border overflow-hidden ${
        theme === "dark" ? "bg-white/[0.02] border-white/10" : "bg-white border-gray-200"
      }`}>
        <table className="w-full">
          <thead>
            <tr className={theme === "dark" ? "border-b border-white/10" : "border-b border-gray-200"}>
              {["User", "Plan", "Projects", "Status", "Joined", "Actions"].map((h) => (
                <th key={h} className={`px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider ${
                  theme === "dark" ? "text-white/40" : "text-gray-500"
                }`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id} className={`transition-colors ${
                theme === "dark" ? "hover:bg-white/[0.03] border-b border-white/5" : "hover:bg-gray-50 border-b border-gray-100"
              }`}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">
                      {user.avatar}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{user.name}</p>
                      <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    user.plan === "Enterprise"
                      ? theme === "dark" ? "bg-purple-500/15 text-purple-400" : "bg-purple-50 text-purple-600"
                      : user.plan === "Pro"
                      ? theme === "dark" ? "bg-cyan-500/15 text-cyan-400" : "bg-cyan-50 text-cyan-600"
                      : theme === "dark" ? "bg-white/10 text-white/60" : "bg-gray-100 text-gray-600"
                  }`}>{user.plan}</span>
                </td>
                <td className={`px-6 py-4 text-sm ${theme === "dark" ? "text-white/60" : "text-gray-600"}`}>{user.projects}</td>
                <td className="px-6 py-4">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 w-fit ${
                    user.status === "active"
                      ? theme === "dark" ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : user.status === "suspended"
                      ? theme === "dark" ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
                      : theme === "dark" ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"
                  }`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                  </span>
                </td>
                <td className={`px-6 py-4 text-sm ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{user.joined}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1">
                    <button className={`p-1.5 rounded-lg transition-colors ${
                      theme === "dark" ? "hover:bg-white/10 text-white/40" : "hover:bg-gray-100 text-gray-400"
                    }`} title="View"><Eye size={14} /></button>
                    <button className={`p-1.5 rounded-lg transition-colors ${
                      theme === "dark" ? "hover:bg-white/10 text-white/40" : "hover:bg-gray-100 text-gray-400"
                    }`} title="Email"><Mail size={14} /></button>
                    <button className={`p-1.5 rounded-lg transition-colors ${
                      theme === "dark" ? "hover:bg-red-500/10 text-white/40 hover:text-red-400" : "hover:bg-red-50 text-gray-400 hover:text-red-500"
                    }`} title="Suspend"><Ban size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ label, value, change, positive, icon: Icon }: {
  label: string; value: string; change: string; positive: boolean; icon: React.ElementType;
}) {
  const { theme } = useTheme();
  return (
    <div className={`rounded-2xl border p-6 ${
      theme === "dark" ? "bg-white/[0.02] border-white/10" : "bg-white border-gray-200"
    }`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          theme === "dark" ? "bg-white/5" : "bg-gray-100"
        }`}>
          <Icon size={20} className="text-purple-400" />
        </div>
        <span className={`flex items-center gap-1 text-xs font-medium ${
          positive ? "text-emerald-400" : "text-red-400"
        }`}>
          {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {change}
        </span>
      </div>
      <p className={`text-3xl font-bold font-display ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{value}</p>
      <p className={`text-sm mt-1 ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{label}</p>
    </div>
  );
}

export function AnalyticsPage() {
  const { theme } = useTheme();

  const metrics = [
    { label: "Total Users", value: "2,847", change: "+12.5%", positive: true, icon: Users },
    { label: "Active Projects", value: "1,234", change: "+8.2%", positive: true, icon: FolderGit2 },
    { label: "Live Deployments", value: "892", change: "+15.3%", positive: true, icon: Globe },
    { label: "Monthly Revenue", value: "$48,250", change: "+22.1%", positive: true, icon: DollarSign },
  ];

  const recentActivity = [
    { user: "Alex Johnson", action: "deployed", target: "Portfolio Website", time: "2 min ago" },
    { user: "Sarah Chen", action: "created", target: "Analytics Dashboard", time: "15 min ago" },
    { user: "David Kim", action: "upgraded to", target: "Pro Plan", time: "1 hour ago" },
    { user: "Tom Wilson", action: "deployed", target: "E-Commerce Store", time: "2 hours ago" },
    { user: "Lisa Zhang", action: "signed up for", target: "Starter Plan", time: "3 hours ago" },
    { user: "Mike Rivera", action: "created", target: "Blog Platform", time: "5 hours ago" },
  ];

  const trafficData = [
    { label: "Mon", value: 65 },
    { label: "Tue", value: 78 },
    { label: "Wed", value: 82 },
    { label: "Thu", value: 71 },
    { label: "Fri", value: 90 },
    { label: "Sat", value: 45 },
    { label: "Sun", value: 38 },
  ];

  const maxTraffic = Math.max(...trafficData.map((d) => d.value));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">Analytics</h1>
          <p className={`mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Platform performance overview</p>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm ${
          theme === "dark" ? "bg-white/5 border border-white/10 text-white/60" : "bg-gray-100 border border-gray-200 text-gray-600"
        }`}>
          <Clock size={14} />
          Last 30 days
          <ChevronDown size={14} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
        {metrics.map((m) => <MetricCard key={m.label} {...m} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className={`col-span-2 rounded-2xl border p-6 ${
          theme === "dark" ? "bg-white/[0.02] border-white/10" : "bg-white border-gray-200"
        }`}>
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-brand-gradient">Weekly Traffic</h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Visitors</span>
              <TrendingUp size={14} className="text-emerald-400" />
            </div>
          </div>
          <div className="flex items-end gap-3 h-48">
            {trafficData.map((d) => (
              <div key={d.label} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full relative" style={{ height: "180px" }}>
                  <div
                    className="absolute bottom-0 w-full rounded-t-lg transition-all duration-500"
                    style={{
                      height: `${(d.value / maxTraffic) * 100}%`,
                      background: "linear-gradient(180deg, #a855f7 0%, #6366f1 50%, #00c9b7 100%)",
                      opacity: 0.8,
                    }}
                  />
                </div>
                <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`rounded-2xl border p-6 ${
          theme === "dark" ? "bg-white/[0.02] border-white/10" : "bg-white border-gray-200"
        }`}>
          <h3 className="font-semibold text-brand-gradient mb-5">Recent Activity</h3>
          <div className="space-y-4">
            {recentActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-semibold shrink-0 mt-0.5">
                  {a.user.split(" ").map((w) => w[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>
                    <span className="font-medium">{a.user}</span>{" "}
                    <span className={theme === "dark" ? "text-white/40" : "text-gray-500"}>{a.action}</span>{" "}
                    <span className="font-medium">{a.target}</span>
                  </p>
                  <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{a.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const DEMO_TRANSACTIONS = [
  { id: "TXN-001", user: "Sarah Chen", plan: "Enterprise", amount: "$199.00", date: "Feb 14, 2026", status: "completed" },
  { id: "TXN-002", user: "David Kim", plan: "Pro", amount: "$29.00", date: "Feb 14, 2026", status: "completed" },
  { id: "TXN-003", user: "Alex Johnson", plan: "Pro", amount: "$29.00", date: "Feb 13, 2026", status: "completed" },
  { id: "TXN-004", user: "Tom Wilson", plan: "Enterprise", amount: "$199.00", date: "Feb 13, 2026", status: "completed" },
  { id: "TXN-005", user: "Emily Park", plan: "Pro", amount: "$29.00", date: "Feb 12, 2026", status: "failed" },
  { id: "TXN-006", user: "Nina Patel", plan: "Pro", amount: "$29.00", date: "Feb 11, 2026", status: "refunded" },
];

export function BillingPage() {
  const { theme } = useTheme();

  const planDistribution = [
    { name: "Starter (Free)", count: 1842, percent: 65, color: "#6366f1" },
    { name: "Pro ($29/mo)", count: 847, percent: 30, color: "#a855f7" },
    { name: "Enterprise ($199/mo)", count: 158, percent: 5, color: "#ec4899" },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">Billing</h1>
          <p className={`mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Revenue and subscription management</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <MetricCard label="Monthly Revenue" value="$48,250" change="+22.1%" positive={true} icon={DollarSign} />
        <MetricCard label="Active Subscriptions" value="1,005" change="+5.8%" positive={true} icon={Activity} />
        <MetricCard label="Churn Rate" value="2.3%" change="-0.5%" positive={true} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-8">
        <div className={`col-span-2 rounded-2xl border p-6 ${
          theme === "dark" ? "bg-white/[0.02] border-white/10" : "bg-white border-gray-200"
        }`}>
          <h3 className="font-semibold text-brand-gradient mb-5">Recent Transactions</h3>
          <div className="space-y-3">
            {DEMO_TRANSACTIONS.map((txn) => (
              <div key={txn.id} className={`flex items-center justify-between py-3 border-b last:border-0 ${
                theme === "dark" ? "border-white/5" : "border-gray-100"
              }`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-semibold">
                    {txn.user.split(" ").map((w) => w[0]).join("")}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{txn.user}</p>
                    <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{txn.plan} · {txn.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{txn.amount}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    txn.status === "completed"
                      ? theme === "dark" ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : txn.status === "failed"
                      ? theme === "dark" ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
                      : theme === "dark" ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"
                  }`}>{txn.status}</span>
                  <span className={`text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{txn.date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={`rounded-2xl border p-6 ${
          theme === "dark" ? "bg-white/[0.02] border-white/10" : "bg-white border-gray-200"
        }`}>
          <h3 className="font-semibold text-brand-gradient mb-5">Plan Distribution</h3>
          <div className="space-y-5">
            {planDistribution.map((plan) => (
              <div key={plan.name}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-sm ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>{plan.name}</span>
                  <span className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{plan.count}</span>
                </div>
                <div className={`h-2 rounded-full overflow-hidden ${theme === "dark" ? "bg-white/10" : "bg-gray-100"}`}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${plan.percent}%`, background: plan.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-6 pt-5 border-t ${theme === "dark" ? "border-white/10" : "border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Total Users</span>
              <span className={`text-lg font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>2,847</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const DEMO_TICKETS = [
  { id: "TKT-2847", user: "Alex Johnson", subject: "Can't deploy my project", priority: "high", status: "open", created: "10 min ago", messages: 3 },
  { id: "TKT-2846", user: "Emily Park", subject: "Billing issue with Pro plan", priority: "medium", status: "open", created: "1 hour ago", messages: 5 },
  { id: "TKT-2845", user: "Mike Rivera", subject: "Custom domain not working", priority: "high", status: "in_progress", created: "3 hours ago", messages: 8 },
  { id: "TKT-2844", user: "Sarah Chen", subject: "Feature request: team collaboration", priority: "low", status: "open", created: "5 hours ago", messages: 2 },
  { id: "TKT-2843", user: "David Kim", subject: "Database connection timeout", priority: "high", status: "in_progress", created: "1 day ago", messages: 12 },
  { id: "TKT-2842", user: "Lisa Zhang", subject: "How to add custom CSS?", priority: "low", status: "resolved", created: "1 day ago", messages: 4 },
  { id: "TKT-2841", user: "Tom Wilson", subject: "API rate limiting questions", priority: "medium", status: "resolved", created: "2 days ago", messages: 6 },
];

export function SupportPage() {
  const { theme } = useTheme();
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = DEMO_TICKETS.filter((t) => filterStatus === "all" || t.status === filterStatus);

  const statusCounts = {
    open: DEMO_TICKETS.filter((t) => t.status === "open").length,
    in_progress: DEMO_TICKETS.filter((t) => t.status === "in_progress").length,
    resolved: DEMO_TICKETS.filter((t) => t.status === "resolved").length,
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">Support</h1>
          <p className={`mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>Manage user tickets and inquiries</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Open", count: statusCounts.open, icon: AlertCircle, color: "text-amber-400" },
          { label: "In Progress", count: statusCounts.in_progress, icon: RefreshCw, color: "text-cyan-400" },
          { label: "Resolved", count: statusCounts.resolved, icon: CheckCircle2, color: "text-emerald-400" },
        ].map((s) => (
          <div key={s.label} className={`rounded-2xl border p-5 flex items-center gap-4 ${
            theme === "dark" ? "bg-white/[0.02] border-white/10" : "bg-white border-gray-200"
          }`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              theme === "dark" ? "bg-white/5" : "bg-gray-100"
            }`}>
              <s.icon size={20} className={s.color} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{s.count}</p>
              <p className={`text-sm ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-6">
        {["all", "open", "in_progress", "resolved"].map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              filterStatus === status
                ? theme === "dark" ? "bg-white/10 text-brand-gradient" : "bg-cyan-50 text-brand-gradient"
                : theme === "dark" ? "text-white/50 hover:bg-white/5" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {status === "all" ? "All" : status === "in_progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((ticket) => (
          <div key={ticket.id} className={`rounded-2xl border p-5 cursor-pointer transition-all ${
            theme === "dark"
              ? "bg-white/[0.02] border-white/10 hover:bg-white/[0.05] hover:border-white/20"
              : "bg-white border-gray-200 hover:shadow-md"
          }`} data-testid={`ticket-${ticket.id}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-semibold shrink-0 mt-0.5">
                  {ticket.user.split(" ").map((w) => w[0]).join("")}
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h4 className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{ticket.subject}</h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      ticket.priority === "high"
                        ? theme === "dark" ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
                        : ticket.priority === "medium"
                        ? theme === "dark" ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"
                        : theme === "dark" ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-600"
                    }`}>{ticket.priority}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{ticket.user}</span>
                    <span className={`text-xs ${theme === "dark" ? "text-white/20" : "text-gray-300"}`}>·</span>
                    <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{ticket.id}</span>
                    <span className={`text-xs ${theme === "dark" ? "text-white/20" : "text-gray-300"}`}>·</span>
                    <span className={`text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>{ticket.created}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className={`flex items-center gap-1 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
                  <MessageSquare size={12} />
                  {ticket.messages}
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  ticket.status === "open"
                    ? theme === "dark" ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"
                    : ticket.status === "in_progress"
                    ? theme === "dark" ? "bg-cyan-500/15 text-cyan-400" : "bg-cyan-50 text-cyan-600"
                    : theme === "dark" ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                }`}>
                  {ticket.status === "in_progress" ? "In Progress" : ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const DEMO_DEPLOYMENTS = [
  { id: "dep-001", project: "Portfolio Website", user: "Alex Johnson", url: "portfolio.buildcustom.ai", status: "healthy", uptime: "99.9%", cpu: 12, memory: 45, requests: "2.3k/hr", region: "US-East" },
  { id: "dep-002", project: "E-Commerce Store", user: "Tom Wilson", url: "shop-wilson.buildcustom.ai", status: "healthy", uptime: "99.8%", cpu: 34, memory: 62, requests: "5.1k/hr", region: "US-West" },
  { id: "dep-003", project: "Space Invaders", user: "Alex Johnson", url: "spacegame.buildcustom.ai", status: "healthy", uptime: "100%", cpu: 8, memory: 28, requests: "890/hr", region: "EU-West" },
  { id: "dep-004", project: "Analytics Dashboard", user: "Sarah Chen", url: "dash.buildcustom.ai", status: "degraded", uptime: "98.2%", cpu: 78, memory: 85, requests: "12k/hr", region: "US-East" },
  { id: "dep-005", project: "Blog Platform", user: "David Kim", url: "blog-dk.buildcustom.ai", status: "healthy", uptime: "99.95%", cpu: 5, memory: 22, requests: "450/hr", region: "AP-South" },
  { id: "dep-006", project: "CRM System", user: "Tom Wilson", url: "crm.buildcustom.ai", status: "down", uptime: "94.1%", cpu: 0, memory: 0, requests: "0/hr", region: "US-East" },
];

export function DeploymentsPage() {
  const { theme } = useTheme();

  const healthyCt = DEMO_DEPLOYMENTS.filter((d) => d.status === "healthy").length;
  const degradedCt = DEMO_DEPLOYMENTS.filter((d) => d.status === "degraded").length;
  const downCt = DEMO_DEPLOYMENTS.filter((d) => d.status === "down").length;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">Deployments</h1>
          <p className={`mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
            Monitor all live deployments across Cloudflare
          </p>
        </div>
        <button className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
          theme === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
        }`} data-testid="button-refresh-deployments">
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Healthy", count: healthyCt, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Degraded", count: degradedCt, icon: AlertCircle, color: "text-amber-400" },
          { label: "Down", count: downCt, icon: XCircle, color: "text-red-400" },
        ].map((s) => (
          <div key={s.label} className={`rounded-2xl border p-5 flex items-center gap-4 ${
            theme === "dark" ? "bg-white/[0.02] border-white/10" : "bg-white border-gray-200"
          }`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              theme === "dark" ? "bg-white/5" : "bg-gray-100"
            }`}>
              <s.icon size={20} className={s.color} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{s.count}</p>
              <p className={`text-sm ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {DEMO_DEPLOYMENTS.map((dep) => (
          <div key={dep.id} className={`rounded-2xl border p-6 transition-all ${
            theme === "dark"
              ? "bg-white/[0.02] border-white/10 hover:bg-white/[0.04]"
              : "bg-white border-gray-200 hover:shadow-md"
          }`} data-testid={`deployment-${dep.id}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  theme === "dark" ? "bg-white/5" : "bg-gray-100"
                }`}>
                  <Server size={18} className="text-purple-400" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h4 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{dep.project}</h4>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 ${
                      dep.status === "healthy"
                        ? theme === "dark" ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                        : dep.status === "degraded"
                        ? theme === "dark" ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"
                        : theme === "dark" ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {dep.status.charAt(0).toUpperCase() + dep.status.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{dep.user}</span>
                    <span className={`text-xs ${theme === "dark" ? "text-white/20" : "text-gray-300"}`}>·</span>
                    <a className="flex items-center gap-1 text-xs text-cyan-400 hover:underline">
                      {dep.url}
                      <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
              </div>
              <span className={`text-xs px-3 py-1 rounded-lg ${
                theme === "dark" ? "bg-white/5 text-white/50" : "bg-gray-100 text-gray-600"
              }`}>{dep.region}</span>
            </div>

            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "Uptime", value: dep.uptime, icon: Wifi },
                { label: "CPU", value: `${dep.cpu}%`, icon: Cpu },
                { label: "Memory", value: `${dep.memory}%`, icon: HardDrive },
                { label: "Requests", value: dep.requests, icon: Zap },
              ].map((metric) => (
                <div key={metric.label} className={`flex items-center gap-3 px-4 py-3 rounded-xl ${
                  theme === "dark" ? "bg-white/[0.03]" : "bg-gray-50"
                }`}>
                  <metric.icon size={14} className={theme === "dark" ? "text-white/30" : "text-gray-400"} />
                  <div>
                    <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{metric.label}</p>
                    <p className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{metric.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
