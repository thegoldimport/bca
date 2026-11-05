import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FolderGit2,
  Globe,
  LifeBuoy,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  Server,
  Shield,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { csrfToken } from "@/lib/auth";

type Overview = {
  stats: {
    customers: number;
    activeCustomers: number;
    suspendedCustomers: number;
    projects: number;
    deployedProjects: number;
    operationsLast30Days: number;
    builderTurnsLast30Days: number;
  };
  health: { checkedAt: string; database: string; runtime: string };
  billing: { configured: boolean; label: string };
  credits: { tracked: boolean; label: string };
};

type Customer = {
  id: string;
  name: string;
  email: string;
  plan: string;
  role: string;
  accountStatus: "active" | "suspended";
  createdAt: string;
  projectCount: number;
  operationCount: number;
  builderTurnCount: number;
  creditsTracked: boolean;
};

type Project = {
  id: number;
  name: string;
  type: string;
  status: string;
  framework: string;
  created_at: string;
  updated_at: string;
};

type AdminProject = {
  id: number;
  name: string;
  type: string;
  status: string;
  framework: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  deploymentStatus: string;
  hostingProvider: string | null;
  publishedUrl: string | null;
  gatewayDiagnosticUrl: string | null;
  customDomains: Array<{ hostname: string; status: string; sslStatus: string }>;
};

type Deployment = {
  projectId: number;
  projectName: string;
  projectType: string;
  projectStatus: string;
  updatedAt: string;
  ownerName: string;
  ownerEmail: string;
  hostingProvider: string;
  deploymentUrl: string | null;
  gatewayDiagnosticUrl: string | null;
  subdomainSlug: string | null;
  customDomains: Array<{ hostname: string; status: string; sslStatus: string }>;
};

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.message === "string" ? body.message : "Could not load admin data.");
  }
  return body as T;
}

function useAdminQuery<T>(path: string, enabled = true) {
  return useQuery<T, Error>({
    queryKey: ["launch-admin", path],
    queryFn: () => adminFetch<T>(path),
    enabled,
    staleTime: 20_000,
  });
}

function PageFrame({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <header className="mb-7">
        <h1 className="text-3xl font-display font-bold text-brand-gradient">{title}</h1>
        <p className={`mt-1 ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{description}</p>
      </header>
      {children}
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { theme } = useTheme();
  return (
    <section className={`rounded-2xl border p-5 ${
      theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"
    } ${className}`}>
      {children}
    </section>
  );
}

function StateMessage({ loading, error, empty }: {
  loading?: boolean;
  error?: Error | null;
  empty?: string;
}) {
  const { theme } = useTheme();
  if (loading) return <p className="py-8 text-center text-sm text-white/50">Loading real platform data…</p>;
  if (error) return <p role="alert" className="py-8 text-center text-sm text-red-400">{error.message}</p>;
  if (empty) return (
    <p className={`py-8 text-center text-sm ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>{empty}</p>
  );
  return null;
}

function Metric({ label, value, icon: Icon, note }: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  note?: string;
}) {
  const { theme } = useTheme();
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-sm ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>{label}</p>
          <p className={`mt-2 text-3xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{value}</p>
          {note && <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>{note}</p>}
        </div>
        <Icon size={20} className="text-purple-400" />
      </div>
    </Card>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function UsersPage() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") || "");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("customerId"),
  );
  const endpoint = `/api/admin/customers?search=${encodeURIComponent(search)}`;
  const customersQuery = useAdminQuery<{ customers: Customer[] }>(endpoint);
  const selected = customersQuery.data?.customers.find((customer) => customer.id === selectedId);
  const projectsQuery = useAdminQuery<{ projects: Project[] }>(
    `/api/admin/customers/${encodeURIComponent(selectedId || "")}/projects`,
    Boolean(selectedId),
  );

  const statusMutation = useMutation({
    mutationFn: async ({ id, accountStatus }: { id: string; accountStatus: "active" | "suspended" }) => {
      const token = await csrfToken();
      return adminFetch<{ success: boolean }>(`/api/admin/customers/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ accountStatus }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["launch-admin"] }),
  });

  const customers = customersQuery.data?.customers || [];
  return (
    <PageFrame title="Customers" description="Live customer records, product access status, projects, and usage. Product tier is not subscription or revenue data.">
      <Card className="mb-5">
        <label className={`flex max-w-lg items-center gap-2 rounded-xl border px-3 py-2.5 ${
          theme === "dark" ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"
        }`}>
          <Search size={16} className={theme === "dark" ? "text-white/40" : "text-gray-400"} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email"
            className={`w-full bg-transparent text-sm outline-none ${
              theme === "dark" ? "text-white placeholder-white/35" : "text-gray-900 placeholder-gray-400"
            }`}
          />
        </label>
        <p className={`mt-3 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
          Suspending blocks BuildCustom product access. It does not delete project data or generated apps.
        </p>
        {statusMutation.error && <p role="alert" className="mt-3 text-sm text-red-400">{statusMutation.error.message}</p>}
      </Card>

      <Card className="overflow-x-auto p-0">
        {customersQuery.isLoading || customersQuery.error ? (
          <div className="px-5"><StateMessage loading={customersQuery.isLoading} error={customersQuery.error} /></div>
        ) : customers.length === 0 ? (
          <div className="px-5"><StateMessage empty="No customer records match this search." /></div>
        ) : (
          <table className="w-full min-w-[850px] text-left">
            <thead className={theme === "dark" ? "border-b border-white/10" : "border-b border-gray-200"}>
              <tr>
                {["Customer", "Product tier", "Projects", "Usage", "Product access", "Joined", "Manage"].map((label) => (
                  <th key={label} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide ${
                    theme === "dark" ? "text-white/40" : "text-gray-500"
                  }`}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className={theme === "dark" ? "border-b border-white/5" : "border-b border-gray-100"}>
                  <td className="px-4 py-4">
                    <Link
                      href={`/app/admin/customers/${encodeURIComponent(customer.id)}`}
                      className={`text-sm font-medium hover:text-cyan-400 hover:underline ${theme === "dark" ? "text-white" : "text-gray-900"}`}
                    >
                      {customer.name}
                    </Link>
                    <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{customer.email}</p>
                  </td>
                  <td className={`px-4 py-4 text-sm ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>{customer.plan || "free"}</td>
                  <td className="px-4 py-4">
                    <Link
                      href={`/app/admin/customers/${encodeURIComponent(customer.id)}`}
                      className="mr-3 text-xs font-medium text-cyan-400 hover:underline"
                    >
                      View details
                    </Link>
                    <button
                      className="text-sm text-cyan-400 hover:underline"
                      onClick={() => setSelectedId(selectedId === customer.id ? null : customer.id)}
                      aria-expanded={selectedId === customer.id}
                    >
                      {customer.projectCount} {customer.projectCount === 1 ? "project" : "projects"}
                    </button>
                  </td>
                  <td className={`px-4 py-4 text-xs ${theme === "dark" ? "text-white/60" : "text-gray-600"}`}>
                    {customer.operationCount} operations · {customer.builderTurnCount} build turns
                    <div className="mt-1 text-white/35">Credits not tracked</div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      customer.accountStatus === "active"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    }`}>
                      {customer.accountStatus === "active" ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td className={`px-4 py-4 text-sm ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
                    {formatDate(customer.createdAt)}
                  </td>
                  <td className="px-4 py-4">
                    <button
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                        customer.accountStatus === "active"
                          ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      }`}
                      disabled={statusMutation.isPending || customer.role !== "user" || customer.email.toLowerCase() === "support@buildcustom.ai"}
                      onClick={() => {
                        const nextStatus = customer.accountStatus === "active" ? "suspended" : "active";
                        const effect = nextStatus === "suspended"
                          ? "This blocks BuildCustom access but does not delete projects or generated apps."
                          : "This restores BuildCustom product access.";
                        if (window.confirm(`${nextStatus === "suspended" ? "Suspend" : "Reactivate"} ${customer.name}? ${effect}`)) {
                          statusMutation.mutate({ id: customer.id, accountStatus: nextStatus });
                        }
                      }}
                    >
                        {customer.email.toLowerCase() === "support@buildcustom.ai"
                          ? "Owner protected"
                          : customer.accountStatus === "active" ? "Suspend" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <Card className="mt-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Projects for {selected.name}</h2>
              <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>Project metadata only; source files and runtime credentials are never included.</p>
            </div>
            <button className="text-xs text-cyan-400 hover:underline" onClick={() => setSelectedId(null)}>Close</button>
          </div>
          {projectsQuery.isLoading || projectsQuery.error ? (
            <StateMessage loading={projectsQuery.isLoading} error={projectsQuery.error} />
          ) : (projectsQuery.data?.projects.length || 0) === 0 ? (
            <StateMessage empty="No projects are stored for this customer." />
          ) : (
            <div className="space-y-2">
              {projectsQuery.data?.projects.map((project) => (
                <div key={project.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                  theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-gray-100 bg-gray-50"
                }`}>
                  <div>
                    <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{project.name}</p>
                    <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
                      {project.type} · {project.framework} · Updated {formatDate(project.updated_at)}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${
                    theme === "dark" ? "bg-white/10 text-white/60" : "bg-white text-gray-600"
                  }`}>{project.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </PageFrame>
  );
}

export function AnalyticsPage() {
  const query = useAdminQuery<Overview>("/api/admin/overview");
  const overview = query.data;
  const stats = overview?.stats;
  return (
    <PageFrame title="Platform overview" description="Current totals and recent activity from BuildCustom product data.">
      {query.isLoading || query.error ? (
        <StateMessage loading={query.isLoading} error={query.error} />
      ) : overview && stats ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Customers" value={stats.customers} icon={Users} note={`${stats.activeCustomers} active · ${stats.suspendedCustomers} suspended`} />
            <Metric label="Projects" value={stats.projects} icon={FolderGit2} note={`${stats.deployedProjects} with a deployment record`} />
            <Metric label="Operations · 30 days" value={stats.operationsLast30Days} icon={Activity} />
            <Metric label="Build turns · 30 days" value={stats.builderTurnsLast30Days} icon={Clock3} />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <HealthCard health={overview.health} />
            <Card>
              <h2 className="font-semibold text-brand-gradient">Billing and credits</h2>
              <p className="mt-3 text-sm text-amber-400">Billing: {overview.billing.label}</p>
              <p className="mt-1 text-sm text-white/50">Credits: {overview.credits.label}</p>
            </Card>
          </div>
        </>
      ) : null}
    </PageFrame>
  );
}

export function ProjectsPage() {
  const { theme } = useTheme();
  const [search, setSearch] = useState("");
  const query = useAdminQuery<{ projects: AdminProject[] }>(
    `/api/admin/projects?search=${encodeURIComponent(search)}`,
  );
  const projects = query.data?.projects || [];

  return (
    <PageFrame title="Projects" description="Customer project metadata from the production product database.">
      <Card className="mb-5">
        <label className={`flex max-w-lg items-center gap-2 rounded-xl border px-3 py-2.5 ${
          theme === "dark" ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"
        }`}>
          <Search size={16} className={theme === "dark" ? "text-white/40" : "text-gray-400"} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects or customer"
            className={`w-full bg-transparent text-sm outline-none ${
              theme === "dark" ? "text-white placeholder-white/35" : "text-gray-900 placeholder-gray-400"
            }`}
          />
        </label>
        <p className={`mt-3 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
          Project metadata only. Customer source files and runtime credentials are not returned.
        </p>
      </Card>
      {query.isLoading || query.error ? (
        <Card><StateMessage loading={query.isLoading} error={query.error} /></Card>
      ) : projects.length === 0 ? (
        <Card><StateMessage empty="No customer projects match this search." /></Card>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <Card key={project.id} className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="rounded-xl bg-white/5 p-2.5">
                  <FolderGit2 size={18} className="text-cyan-400" />
                </div>
                <div className="min-w-0">
                  <h2 className={`truncate font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                    {project.name}
                  </h2>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
                    <Link
                      href={`/app/users?customerId=${encodeURIComponent(project.ownerId)}&search=${encodeURIComponent(project.ownerEmail)}`}
                      className="text-cyan-400 hover:underline"
                    >
                      {project.ownerName} · {project.ownerEmail}
                    </Link>
                  </p>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>
                    Created {formatDate(project.createdAt)} · Updated {formatDate(project.updatedAt)} · {project.type} · {project.framework}
                  </p>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
                    Deployment: {project.deploymentStatus}
                    {project.hostingProvider ? ` · ${project.hostingProvider}` : ""}
                  </p>
                  {project.customDomains.length > 0 && (
                    <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>
                      Custom domains: {project.customDomains.map((domain) =>
                        `${domain.hostname} (${domain.status}; SSL ${domain.sslStatus})`,
                      ).join(" · ")}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-2.5 py-1 text-xs ${
                  theme === "dark" ? "bg-white/10 text-white/60" : "bg-gray-100 text-gray-600"
                }`}>{project.status}</span>
                {project.publishedUrl && (
                  <a
                    href={project.publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-cyan-400 hover:underline"
                  >
                    Open deployment
                  </a>
                )}
                {project.gatewayDiagnosticUrl && (
                  <a
                    href={project.gatewayDiagnosticUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-white/40 hover:text-cyan-400 hover:underline"
                  >
                    Gateway diagnostics
                  </a>
                )}
                <Link
                  href={`/app/deployments?projectId=${encodeURIComponent(String(project.id))}`}
                  className="text-xs text-cyan-400 hover:underline"
                >
                  Project diagnostics
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </PageFrame>
  );
}

function HealthCard({ health }: { health: Overview["health"] }) {
  const { theme } = useTheme();
  const rows = [
    { label: "Product database", value: health.database },
    { label: "Runtime", value: health.runtime },
  ];
  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Shield size={18} className="text-purple-400" />
        <h2 className="font-semibold text-brand-gradient">Basic platform health</h2>
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const available = row.value === "available";
          return (
            <div key={row.label} className="flex items-center justify-between">
              <span className={`text-sm ${theme === "dark" ? "text-white/65" : "text-gray-700"}`}>{row.label}</span>
              <span className={`flex items-center gap-1.5 text-xs ${available ? "text-emerald-400" : "text-red-400"}`}>
                {available ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                {available ? "Available" : "Unavailable"}
              </span>
            </div>
          );
        })}
      </div>
      <p className={`mt-4 text-xs ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>
        Checked {formatDate(health.checkedAt)}. This is a connectivity check, not an uptime or performance guarantee.
      </p>
    </Card>
  );
}

export function SystemHealthPage() {
  const query = useAdminQuery<Overview["health"]>("/api/admin/health");
  return (
    <PageFrame title="System Health" description="Live connectivity checks for the product database and runtime.">
      {query.isLoading || query.error ? (
        <Card><StateMessage loading={query.isLoading} error={query.error} /></Card>
      ) : query.data ? (
        <HealthCard health={query.data} />
      ) : null}
    </PageFrame>
  );
}

export function BillingPage() {
  const { theme } = useTheme();
  return (
    <PageFrame title="Billing" description="No payment provider is connected to the live product data.">
      <Card className="max-w-2xl">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-500/10 p-3 text-amber-400"><Server size={20} /></div>
          <div>
            <h2 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Not configured</h2>
            <p className={`mt-1 text-sm ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
              Revenue, subscriptions, and churn are not available until a real billing integration is configured.
            </p>
          </div>
        </div>
      </Card>
    </PageFrame>
  );
}

export function SupportPage() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [reply, setReply] = useState("");
  const ticketsPath = `/api/admin/support/tickets?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`;
  const ticketsQuery = useAdminQuery<{ tickets: AdminSupportTicket[] }>(ticketsPath);
  const detailQuery = useAdminQuery<{ ticket: AdminSupportTicket; messages: AdminSupportMessage[] }>(
    selectedId ? `/api/admin/support/tickets/${encodeURIComponent(selectedId)}` : "/api/admin/support/tickets",
    Boolean(selectedId),
  );
  const detail = selectedId ? detailQuery.data : null;
  const tickets = ticketsQuery.data?.tickets || [];
  const statuses: Array<{ value: AdminSupportStatus; label: string }> = [
    { value: "open", label: "Open" },
    { value: "waiting_for_support", label: "Waiting for support" },
    { value: "waiting_for_customer", label: "Waiting for customer" },
    { value: "resolved", label: "Resolved" },
  ];
  const queryPrefix = ["launch-admin"] as const;

  const replyMutation = useMutation({
    mutationFn: async () => {
      const token = await csrfToken();
      const response = await fetch(`/api/admin/support/tickets/${encodeURIComponent(selectedId)}/replies`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ body: reply.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Reply could not be sent.");
      return data as { ticket: AdminSupportTicket; messages: AdminSupportMessage[] };
    },
    onSuccess: async (data) => {
      setReply("");
      queryClient.setQueryData(["launch-admin", `/api/admin/support/tickets/${encodeURIComponent(selectedId)}`], data);
      await queryClient.invalidateQueries({ queryKey: queryPrefix });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (nextStatus: AdminSupportStatus) => {
      const token = await csrfToken();
      const response = await fetch(`/api/admin/support/tickets/${encodeURIComponent(selectedId)}/status`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Ticket status could not be updated.");
      return data as { ticket: AdminSupportTicket };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryPrefix });
    },
  });

  const inputClass = `rounded-xl border px-3 py-2 text-sm outline-none focus:border-cyan-500 ${
    theme === "dark" ? "border-white/10 bg-white/[0.04] text-white" : "border-gray-200 bg-white text-gray-900"
  }`;

  return (
    <PageFrame title="Support" description="Customer support tickets and replies from the live product database.">
      {(ticketsQuery.error || detailQuery.error || replyMutation.error || statusMutation.error) && (
        <p role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-400">
          {(ticketsQuery.error || detailQuery.error || replyMutation.error || statusMutation.error)?.message}
        </p>
      )}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme === "dark" ? "text-white/35" : "text-gray-400"}`} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subject or customer"
            className={`${inputClass} w-full pl-9`} aria-label="Search support tickets" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass} aria-label="Filter ticket status">
          <option value="">All statuses</option>
          {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button type="button" onClick={() => { void ticketsQuery.refetch(); if (selectedId) void detailQuery.refetch(); }}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm ${
            theme === "dark" ? "border-white/10 text-white/70 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"
          }`}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.4fr)]">
        <Card className="!p-0">
          <div className={`flex items-center justify-between border-b px-4 py-3 ${theme === "dark" ? "border-white/10" : "border-gray-100"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <LifeBuoy size={16} className="text-cyan-400" /> Tickets
            </span>
            <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{tickets.length}</span>
          </div>
          {ticketsQuery.isLoading ? <StateMessage loading /> : tickets.length ? (
            <div className="max-h-[680px] overflow-y-auto">
              {tickets.map((ticket) => (
                <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)}
                  className={`block w-full border-b px-4 py-4 text-left ${
                    selectedId === ticket.id
                      ? theme === "dark" ? "bg-cyan-400/10" : "bg-cyan-50"
                      : theme === "dark" ? "border-white/[0.06] hover:bg-white/[0.035]" : "border-gray-100 hover:bg-gray-50"
                  }`}>
                  <span className="flex items-start justify-between gap-3">
                    <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${theme === "dark" ? "text-white/90" : "text-gray-800"}`}>{ticket.subject}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${supportStatusClass(theme, ticket.status)}`}>
                      {supportStatusLabel(ticket.status)}
                    </span>
                  </span>
                  <span className={`mt-1 block truncate text-xs ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
                    {ticket.customer_name} · {ticket.customer_email}
                  </span>
                  <span className={`mt-1 block text-[11px] ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>
                    {ticket.project_name ? `${ticket.project_name} · ` : ""}{formatDate(ticket.last_message_at || ticket.updated_at)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <StateMessage empty={ticketsQuery.error ? undefined : "No real support tickets match this filter."} />
          )}
        </Card>

        <Card className="min-h-[480px]">
          {!selectedId ? (
            <div className="flex min-h-[440px] flex-col items-center justify-center text-center">
              <MessageSquareText size={22} className="text-cyan-400" />
              <h2 className={`mt-3 text-sm font-semibold ${theme === "dark" ? "text-white/80" : "text-gray-800"}`}>Select a ticket</h2>
              <p className={`mt-1 max-w-sm text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>Customer messages and replies will appear here.</p>
            </div>
          ) : detailQuery.isLoading || !detail ? <StateMessage loading={detailQuery.isLoading} error={detailQuery.error} /> : (
            <div className="space-y-4">
              <header className={`flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between ${theme === "dark" ? "border-white/10" : "border-gray-100"}`}>
                <div className="min-w-0">
                  <h2 className={`text-lg font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{detail.ticket.subject}</h2>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
                    {detail.ticket.customer_name} · {detail.ticket.customer_email} · {detail.ticket.category}
                  </p>
                </div>
                <select value={detail.ticket.status} disabled={statusMutation.isPending}
                  onChange={(event) => statusMutation.mutate(event.target.value as AdminSupportStatus)}
                  className={inputClass} aria-label="Update ticket status">
                  {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </header>

              <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-3 py-2.5 text-xs ${
                theme === "dark" ? "bg-white/[0.035] text-white/55" : "bg-gray-50 text-gray-600"
              }`}>
                <Link href={`/app/admin/customers/${encodeURIComponent(detail.ticket.customer_user_id)}`} className="inline-flex items-center gap-1 text-cyan-500 hover:underline">
                  Customer profile <ArrowUpRight size={12} />
                </Link>
                {detail.ticket.project_id && detail.ticket.projectDiagnosticsAvailable && (
                  <Link href={`/app/deployments?projectId=${encodeURIComponent(String(detail.ticket.project_id))}`} className="inline-flex items-center gap-1 text-cyan-500 hover:underline">
                    Approved project diagnostics <ArrowUpRight size={12} />
                  </Link>
                )}
                {detail.ticket.project_id && !detail.ticket.projectDiagnosticsAvailable && (
                  <span>Private project diagnostics are unavailable without a current customer approval.</span>
                )}
                {!detail.ticket.project_id && <span>This ticket is not linked to a project.</span>}
              </div>

              <div className={`max-h-[420px] space-y-3 overflow-y-auto rounded-xl border p-3 ${
                theme === "dark" ? "border-white/10 bg-black/10" : "border-gray-100 bg-gray-50/60"
              }`}>
                {detail.messages.map((message) => (
                  <article key={message.id} className={`rounded-xl border p-3 ${
                    message.senderType === "support"
                      ? theme === "dark" ? "border-cyan-300/15 bg-cyan-300/[0.05]" : "border-cyan-100 bg-cyan-50/60"
                      : theme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-gray-200 bg-white"
                  }`}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className={`text-xs font-semibold ${theme === "dark" ? "text-white/80" : "text-gray-800"}`}>{message.sender}</span>
                      <time className={`text-[10px] ${theme === "dark" ? "text-white/35" : "text-gray-400"}`} dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                    </div>
                    <p className={`whitespace-pre-wrap break-words text-sm leading-6 ${theme === "dark" ? "text-white/70" : "text-gray-700"}`}>{message.body}</p>
                  </article>
                ))}
              </div>

              <form onSubmit={(event) => { event.preventDefault(); if (reply.trim()) replyMutation.mutate(); }} className="space-y-3">
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={8000} rows={3}
                  placeholder="Reply to this customer" aria-label="Support reply"
                  className={`${inputClass} w-full resize-y`} />
                <div className="flex justify-end">
                  <button type="submit" disabled={!reply.trim() || replyMutation.isPending}
                    className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-cyan-400 px-3.5 text-xs font-semibold text-gray-950 disabled:opacity-50">
                    <Send size={13} /> {replyMutation.isPending ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </Card>
      </div>
    </PageFrame>
  );
}

type AdminSupportStatus = "open" | "waiting_for_support" | "waiting_for_customer" | "resolved";
type AdminSupportTicket = {
  id: string;
  customer_user_id: string;
  customer_name: string;
  customer_email: string;
  category: string;
  subject: string;
  status: AdminSupportStatus;
  project_id: number | null;
  project_name: string | null;
  projectDiagnosticsAvailable?: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};
type AdminSupportMessage = { id: string; sender: string; senderType: "customer" | "support"; body: string; createdAt: string };

function supportStatusLabel(status: AdminSupportStatus) {
  return status === "waiting_for_support" ? "Waiting for support"
    : status === "waiting_for_customer" ? "Waiting for customer"
      : status === "resolved" ? "Resolved" : "Open";
}

function supportStatusClass(theme: string, status: AdminSupportStatus) {
  if (status === "resolved") return theme === "dark" ? "bg-emerald-300/10 text-emerald-200" : "bg-emerald-50 text-emerald-700";
  if (status === "waiting_for_customer") return theme === "dark" ? "bg-amber-300/10 text-amber-200" : "bg-amber-50 text-amber-700";
  return theme === "dark" ? "bg-white/5 text-white/60" : "bg-gray-100 text-gray-600";
}

export function DeploymentsPage() {
  const { theme } = useTheme();
  const projectId = new URLSearchParams(window.location.search).get("projectId");
  const endpoint = projectId
    ? `/api/admin/deployments?projectId=${encodeURIComponent(projectId)}`
    : "/api/admin/deployments";
  const query = useAdminQuery<{ deployments: Deployment[] }>(endpoint);
  const deployments = query.data?.deployments || [];
  return (
    <PageFrame
      title="Deployments"
      description={projectId
        ? `Deployment diagnostics for project ${projectId}.`
        : "Deployment records stored for customer projects."}
    >
      <div className="mb-4 flex justify-end">
        <button
          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
            theme === "dark" ? "bg-white/10 text-white/75 hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {query.isLoading || query.error ? (
        <Card><StateMessage loading={query.isLoading} error={query.error} /></Card>
      ) : deployments.length === 0 ? (
        <Card><StateMessage empty={projectId
          ? "No deployment record is available for this project."
          : "No deployment records are available."} /></Card>
      ) : (
        <div className="space-y-3">
          {deployments.map((deployment) => (
            <Card key={deployment.projectId} className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-white/5 p-2.5"><Globe size={18} className="text-cyan-400" /></div>
                <div>
                  <h2 className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{deployment.projectName}</h2>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
                    {deployment.ownerName} · {deployment.ownerEmail} · {deployment.projectType}
                  </p>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>
                    {deployment.hostingProvider} · Updated {formatDate(deployment.updatedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-1 text-xs ${
                  theme === "dark" ? "bg-white/10 text-white/60" : "bg-gray-100 text-gray-600"
                }`}>{deployment.projectStatus}</span>
                {deployment.deploymentUrl && (
                  <a
                    href={deployment.deploymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-cyan-400 hover:underline"
                  >
                    Open deployment
                  </a>
                )}
                {deployment.gatewayDiagnosticUrl && (
                  <a
                    href={deployment.gatewayDiagnosticUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-white/40 hover:text-cyan-400 hover:underline"
                  >
                    Gateway diagnostics
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </PageFrame>
  );
}
