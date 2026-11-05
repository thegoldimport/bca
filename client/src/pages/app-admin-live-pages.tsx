import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  CheckCircle2,
  Clock3,
  FolderGit2,
  Globe,
  RefreshCw,
  Search,
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
  return (
    <PageFrame title="Support" description="Support ticket data is not connected to the product control plane.">
      <Card>
        <p className={`text-sm ${theme === "dark" ? "text-white/60" : "text-gray-600"}`}>
          Not configured. No demo tickets or customer messages are shown.
        </p>
      </Card>
    </PageFrame>
  );
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
