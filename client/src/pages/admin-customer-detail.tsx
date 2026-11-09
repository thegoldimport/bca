import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Clock3,
  ExternalLink,
  FolderGit2,
  Globe,
  LockKeyhole,
  RefreshCw,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { csrfToken } from "@/lib/auth";

type Grant = {
  id: string;
  projectId: number;
  projectName: string;
  permission: string;
  grantedAt: number;
  expiresAt: number;
  revokedAt: number | null;
  status: "active" | "expired" | "revoked";
};

type CustomerDetail = {
  customer: {
    id: string;
    name: string;
    email: string;
    signupDate: string | null;
    accountStatus: string;
    role: string;
    productTier: string;
    emailVerification: string;
    lastLogin: string;
    authenticationProvider: string;
    credits: string;
  };
  projects: Array<{
    id: number;
    name: string;
    type: string;
    framework: string;
    projectStatus: string;
    buildStatus: string;
    deploymentStatus: string;
    deploymentUrl: string | null;
    gatewayDiagnosticUrl: string | null;
    hostingProvider: string;
    subdomainSlug: string | null;
    customDomains: Array<{
      hostname: string;
      role: string | null;
      status: string;
      sslStatus: string;
      isPrimary: boolean;
    }>;
    createdAt: string | null;
    updatedAt: string | null;
    deploymentUpdatedAt: string | null;
  }>;
  projectPagination: {
    offset: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
  deployments: Array<{
    projectId: number;
    deploymentUrl: string | null;
    gatewayDiagnosticUrl: string | null;
    createdAt: string | null;
    status: string;
  }>;
  deploymentHistoryHasMore: boolean;
  hosting: {
    subscriptionStatus: string;
    hostingPlan: string;
    hostingStatus: string;
    projectsWithDeploymentRecords: number;
    hostingStartDate: string;
    renewalDate: string;
    usage: string;
    customDomains: Array<{
      projectId: number;
      hostname: string;
      role: string | null;
      status: string;
      sslStatus: string;
      isPrimary: boolean;
    }>;
  };
  billing: {
    configured: boolean;
    subscription: string;
    paymentStatus: string;
    invoiceHistory: string;
  };
  supportTickets: {
    configured: boolean;
    label: string;
  };
  usage: {
    operationCount: number;
    operations: Array<{
      projectId: number;
      kind: string;
      status: string;
      createdAt: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      failureDetails: string | null;
    }>;
    builderTurnCount: number;
    lastBuildActivityAt: string | null;
    buildActivity: Array<{ projectId: number; mode: string; createdAt: string | null }>;
    credits: string;
  };
  supportAccess: {
    grants: Grant[];
    auditHistory: Array<{
      action: string;
      projectId: number;
      projectName: string;
      actorName: string;
      actorEmail: string | null;
      createdAt: string | null;
    }>;
    historyMayBeTruncated: boolean;
    sessions: Array<{
      id: string;
      grantId: string;
      projectId: number;
      operatorName: string;
      operatorEmail: string | null;
      startedAt: number;
      lastAccessAt: number;
      closedAt: number | null;
      status: string;
    }>;
  };
};

type SupportWorkspace = {
  session: {
    id: string;
    grantId: string;
    projectId: number;
    permission: string;
    startedAt: number;
    expiresAt: number;
  };
  customer: { name: string; email: string };
  project: {
    id: number;
    name: string;
    type: string;
    status: string;
    framework: string;
    createdAt: string | null;
    updatedAt: string | null;
    deploymentUrl: string | null;
    deploymentStatus: string;
    deploymentUpdatedAt: string | null;
  };
  diagnostics: {
    deployments: Array<{ deploymentUrl: string | null; createdAt: string | null; status: string }>;
    operations: Array<{
      kind: string;
      status: string;
      createdAt: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      failureDetails: string | null;
    }>;
    buildActivity: Array<{ mode: string; createdAt: string | null }>;
    buildActivityTotal: number;
    lastBuildActivityAt: string | null;
    buildAttempts: Array<{
      attemptId: string;
      startedAt: number;
      finishedAt: number | null;
      status: string;
      lastStage: string;
      lastSuccessfulStage: string | null;
      failureStage: string | null;
      errorCode: string | null;
      customerMessage: string | null;
      provider: string | null;
      modelId: string | null;
      correlationId: string | null;
    }>;
    buildEvents: Array<{
      attemptId: string;
      occurredAt: number;
      eventType: string;
      stage: string;
      status: string;
      errorCode: string | null;
      message: string | null;
      gatewayStatus: number | null;
      correlationId: string | null;
    }>;
  };
  restrictions: {
    readOnly: true;
    sourceFilesIncluded: false;
    environmentVariablesIncluded: false;
    credentialsIncluded: false;
    unrelatedProjectsIncluded: false;
  };
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: new Headers(init?.headers),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.message === "string" ? body.message : "The request could not be completed.");
  }
  return body as T;
}

function dateLabel(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Not tracked";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? "Not tracked" : date.toLocaleString();
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <section className={`rounded-2xl border p-5 ${
      theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"
    }`}>
      <h2 className={`mb-4 font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{title}</h2>
      {children}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <div className="min-w-0">
      <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{label}</p>
      <p className={`mt-1 break-words text-sm ${theme === "dark" ? "text-white/80" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "active" || status === "published" || status === "completed"
    ? "bg-emerald-500/15 text-emerald-400"
    : status === "suspended" || status === "failed" || status === "revoked"
      ? "bg-red-500/15 text-red-400"
      : "bg-amber-500/15 text-amber-400";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{status.replaceAll("_", " ")}</span>;
}

export function AdminCustomerDetailPage() {
  const [, params] = useRoute("/app/admin/customers/:customerId");
  const customerId = params?.customerId || "";
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [projectOffset, setProjectOffset] = useState(0);
  useEffect(() => setProjectOffset(0), [customerId]);
  const detailQuery = useQuery<CustomerDetail, Error>({
    queryKey: ["admin-customer-detail", customerId, projectOffset],
    queryFn: () => requestJson(
      `/api/admin/customers/${encodeURIComponent(customerId)}?projectOffset=${projectOffset}`,
    ),
    enabled: Boolean(customerId),
    staleTime: 10_000,
  });

  const statusMutation = useMutation({
    mutationFn: async (accountStatus: "active" | "suspended") => {
      const token = await csrfToken();
      return requestJson(`/api/admin/customers/${encodeURIComponent(customerId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ accountStatus }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-customer-detail", customerId] });
      queryClient.invalidateQueries({ queryKey: ["launch-admin"] });
    },
  });

  const openMutation = useMutation({
    mutationFn: async (grant: Grant) => {
      const token = await csrfToken();
      return requestJson<{ sessionId: string }>(
        `/api/admin/customers/${encodeURIComponent(customerId)}/support-grants/${encodeURIComponent(grant.id)}/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
          body: JSON.stringify({}),
        },
      );
    },
    onSuccess: (result) => {
      setLocation(`/app/admin/support-sessions/${encodeURIComponent(result.sessionId)}`);
    },
  });

  const panelClass = theme === "dark" ? "text-white/70" : "text-gray-700";
  const data = detailQuery.data;
  const customer = data?.customer;
  if (detailQuery.isLoading) return <div className="mx-auto max-w-7xl p-8 text-sm text-white/50">Loading customer details…</div>;
  if (detailQuery.error || !data || !customer) {
    return (
      <div className="mx-auto max-w-7xl p-8">
        <p role="alert" className="text-sm text-red-400">{detailQuery.error?.message || "Customer not found."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6 md:p-8">
      <button onClick={() => setLocation("/app/users")} className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:underline">
        <ArrowLeft size={16} /> Customers
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">{customer.name}</h1>
          <p className={`mt-1 text-sm ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>{customer.email}</p>
          <p className={`mt-2 font-mono text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>Account ID: {customer.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={customer.accountStatus} />
          <button
            className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              customer.accountStatus === "active"
                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            }`}
            disabled={statusMutation.isPending || customer.role !== "user" || customer.email.toLowerCase() === "support@buildcustom.ai"}
            onClick={() => {
              const nextStatus = customer.accountStatus === "active" ? "suspended" : "active";
              const effect = nextStatus === "suspended"
                ? "This blocks BuildCustom product access but does not delete projects or generated apps."
                : "This restores BuildCustom product access.";
              if (window.confirm(`${nextStatus === "suspended" ? "Suspend" : "Reactivate"} ${customer.name}? ${effect}`)) {
                statusMutation.mutate(nextStatus);
              }
            }}
          >
            {customer.email.toLowerCase() === "support@buildcustom.ai"
              ? "Owner protected"
              : customer.accountStatus === "active" ? "Suspend account" : "Reactivate account"}
          </button>
        </div>
      </header>
      {statusMutation.error && <p role="alert" className="text-sm text-red-400">{statusMutation.error.message}</p>}
      {openMutation.error && <p role="alert" className="text-sm text-red-400">{openMutation.error.message}</p>}

      <Panel title="Account overview">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Product tier (not billing)" value={customer.productTier} />
          <Info label="Signed up" value={dateLabel(customer.signupDate)} />
          <Info label="Email verification" value={customer.emailVerification} />
          <Info label="Last login" value={customer.lastLogin} />
          <Info label="Role" value={customer.role} />
          <Info label="Authentication provider" value={customer.authenticationProvider} />
          <Info label="Credits" value={customer.credits} />
          <Info label="Account status" value={customer.accountStatus} />
        </div>
      </Panel>

      <Panel title="Hosting and domains">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Hosting activation" value={data.hosting.hostingStatus} />
          <Info label="Hosting subscription" value={data.hosting.subscriptionStatus} />
          <Info label="Hosting plan" value={data.hosting.hostingPlan} />
          <Info label="Projects with deployment records" value={String(data.hosting.projectsWithDeploymentRecords)} />
          <Info label="Hosting start" value={data.hosting.hostingStartDate} />
          <Info label="Renewal" value={data.hosting.renewalDate} />
          <Info label="Hosting usage" value={data.hosting.usage} />
        </div>
        <div className="mt-5">
          <h3 className={`mb-2 text-sm font-medium ${theme === "dark" ? "text-white/80" : "text-gray-800"}`}>
            Custom domains
          </h3>
          {data.hosting.customDomains.length === 0 ? (
            <p className={`text-sm ${panelClass}`}>No custom domains are recorded.</p>
          ) : (
            <div className="space-y-2">
              {data.hosting.customDomains.map((domain, index) => (
                <div key={`${domain.projectId}-${domain.hostname}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 py-2">
                  <span className={`text-sm ${panelClass}`}>{domain.hostname} · project {domain.projectId}</span>
                  <span className={`text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
                    {domain.status} · SSL {domain.sslStatus}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Billing">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Payment integration" value={data.billing.configured ? "Configured" : "Not configured"} />
          <Info label="Subscription" value={data.billing.subscription} />
          <Info label="Payment status" value={data.billing.paymentStatus} />
          <Info label="Invoice history" value={data.billing.invoiceHistory} />
        </div>
      </Panel>

      <Panel title="Support tickets">
        <p className={`text-sm ${panelClass}`}>{data.supportTickets.label}</p>
      </Panel>

      <Panel title={`Projects (${data.projectPagination.total})`}>
        {data.projects.length === 0 ? (
          <p className={`text-sm ${panelClass}`}>No projects are stored for this customer.</p>
        ) : (
          <div className="space-y-3">
            {data.projects.map((project) => (
              <article key={project.id} className={`rounded-xl border p-4 ${
                theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-gray-50"
              }`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <FolderGit2 className="mt-0.5 text-cyan-400" size={18} />
                    <div>
                      <h3 className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{project.name}</h3>
                      <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
                        {project.type} · {project.framework} · ID {project.id}
                      </p>
                      <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
                        Project {project.projectStatus} · Generation {project.buildStatus} · Hosting provider {project.hostingProvider}
                      </p>
                    </div>
                  </div>
                  <StatusPill status={project.buildStatus} />
                </div>
                <div className={`mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4 ${panelClass}`}>
                  <span>Created {dateLabel(project.createdAt)}</span>
                  <span>Updated {dateLabel(project.updatedAt)}</span>
                  <span>Deployment: {project.deploymentStatus}</span>
                  <span>Published {dateLabel(project.deploymentUpdatedAt)}</span>
                </div>
                {project.customDomains.length > 0 && (
                  <div className={`mt-3 text-xs ${theme === "dark" ? "text-white/45" : "text-gray-500"}`}>
                    {project.customDomains.map((domain) =>
                      `${domain.hostname} (${domain.status}; SSL ${domain.sslStatus})`,
                    ).join(" · ")}
                  </div>
                )}
                {project.deploymentUrl && (
                  <a
                    href={project.deploymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                  >
                    <Globe size={13} /> Open published site <ExternalLink size={12} />
                  </a>
                )}
                <div className="mt-3 flex flex-wrap gap-4 text-xs">
                  <a
                    href={`/app/deployments?projectId=${encodeURIComponent(String(project.id))}`}
                    className="text-cyan-400 hover:underline"
                  >
                    Deployment diagnostics
                  </a>
                  {project.gatewayDiagnosticUrl && (
                    <a href={project.gatewayDiagnosticUrl} target="_blank" rel="noreferrer" className="text-white/40 hover:text-cyan-400 hover:underline">
                      Gateway diagnostics
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
            {data.projectPagination.total === 0
              ? "No projects"
              : `Showing ${projectOffset + 1}–${Math.min(projectOffset + data.projects.length, data.projectPagination.total)} of ${data.projectPagination.total}`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={projectOffset === 0}
              onClick={() => setProjectOffset(Math.max(0, projectOffset - data.projectPagination.pageSize))}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-cyan-400 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!data.projectPagination.hasMore}
              onClick={() => setProjectOffset(projectOffset + data.projectPagination.pageSize)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-cyan-400 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Deployments">
        {data.deployments.length === 0 ? (
          <p className={`text-sm ${panelClass}`}>No deployment records are available.</p>
        ) : (
          <div className="space-y-2">
            {data.deployments.map((deployment, index) => (
              <div key={`${deployment.projectId}-${deployment.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-3 last:border-0">
                <div>
                  <p className={`text-sm ${panelClass}`}>Project {deployment.projectId}</p>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>{dateLabel(deployment.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={deployment.status} />
                  {deployment.deploymentUrl && <a href={deployment.deploymentUrl} target="_blank" rel="noreferrer" aria-label="Open deployment"><ExternalLink size={15} className="text-cyan-400" /></a>}
                </div>
              </div>
            ))}
          </div>
        )}
        {data.deploymentHistoryHasMore && (
          <p className={`mt-3 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
            Showing the latest {data.deployments.length} deployment records.
          </p>
        )}
      </Panel>

      <Panel title="Usage">
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Info label="Operations" value={String(data.usage.operationCount)} />
          <Info label="Build turns" value={String(data.usage.builderTurnCount)} />
          <Info label="Latest build activity" value={dateLabel(data.usage.lastBuildActivityAt)} />
        </div>
        {data.usage.operations.length === 0 ? (
          <p className={`text-sm ${panelClass}`}>No operation history is available.</p>
        ) : (
          <div className="space-y-2">
            {data.usage.operations.slice(0, 20).map((operation, index) => (
              <div key={`${operation.projectId}-${operation.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 py-3">
                <div className="flex items-center gap-2">
                  <Activity size={15} className="text-cyan-400" />
                  <span className={`text-sm ${panelClass}`}>{operation.kind} · project {operation.projectId}</span>
                  <span className={`text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>{dateLabel(operation.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={operation.status} />
                  {operation.failureDetails && <span className="text-xs text-white/40">{operation.failureDetails}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {data.usage.operationCount > data.usage.operations.length && (
          <p className={`mt-2 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
            Showing the latest {data.usage.operations.length} of {data.usage.operationCount} operations.
          </p>
        )}
        <p className={`mt-3 text-xs ${theme === "dark" ? "text-white/35" : "text-gray-500"}`}>
          Prompts, generated responses, changed files, and raw failure text are excluded.
        </p>
      </Panel>

      <Panel title="Support access">
        <div className={`mb-4 flex gap-3 rounded-xl border p-4 text-sm ${
          theme === "dark" ? "border-cyan-400/20 bg-cyan-400/5 text-white/70" : "border-cyan-200 bg-cyan-50 text-gray-700"
        }`}>
          <LockKeyhole className="mt-0.5 shrink-0 text-cyan-400" size={18} />
          <p>Project-scoped, read-only diagnostics only. Access expires automatically and is rechecked on every request. The customer can revoke approval at any time.</p>
        </div>
        {data.supportAccess.grants.length === 0 ? (
          <p className={`text-sm ${panelClass}`}>No customer-approved support access exists.</p>
        ) : (
          <div className="space-y-4">
            {data.supportAccess.grants.map((grant) => (
              <div key={grant.id} className={`rounded-xl border p-4 ${
                theme === "dark" ? "border-white/10" : "border-gray-200"
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className={`text-sm font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{grant.projectName}</p>
                    <p className={`mt-1 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
                      Project {grant.projectId} · {grant.permission} · Granted {dateLabel(grant.grantedAt)} · Expires {dateLabel(grant.expiresAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status={grant.status} />
                    {grant.status === "active" && (
                      <button
                        disabled={openMutation.isPending}
                        onClick={() => openMutation.mutate(grant)}
                        className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
                      >
                        {openMutation.isPending ? "Opening…" : "Open Support Workspace"}
                      </button>
                    )}
                  </div>
                </div>
                {grant.revokedAt != null && <p className="mt-2 text-xs text-white/40">Revoked {dateLabel(grant.revokedAt)}</p>}
              </div>
            ))}
          </div>
        )}
        {data.supportAccess.sessions.length > 0 && (
          <div className="mt-5">
            <h3 className={`mb-2 text-sm font-medium ${theme === "dark" ? "text-white/75" : "text-gray-800"}`}>Session history</h3>
            <div className="space-y-2">
              {data.supportAccess.sessions.map((session) => (
                <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 py-2">
                  <span className={`text-xs ${panelClass}`}>
                    {session.operatorName}{session.operatorEmail ? ` · ${session.operatorEmail}` : ""} · Project {session.projectId} · {dateLabel(session.startedAt)}
                  </span>
                  <StatusPill status={session.status} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-5">
          <h3 className={`mb-2 text-sm font-medium ${theme === "dark" ? "text-white/75" : "text-gray-800"}`}>
            Support audit history
          </h3>
          {data.supportAccess.auditHistory.length === 0 ? (
            <p className={`text-sm ${panelClass}`}>No support audit events are recorded.</p>
          ) : (
            <div className="space-y-2">
              {data.supportAccess.auditHistory.map((event, index) => (
                <div key={`${event.action}-${event.projectId}-${event.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 py-2">
                  <span className={`text-xs ${panelClass}`}>
                    {event.action.replaceAll("_", " ")} · {event.projectName} · {event.actorName}
                    {event.actorEmail ? ` (${event.actorEmail})` : ""}
                  </span>
                  <span className={`text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
                    {dateLabel(event.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {data.supportAccess.historyMayBeTruncated && (
          <p className={`mt-3 text-xs ${theme === "dark" ? "text-white/40" : "text-gray-500"}`}>
            Only the latest 100 grants or sessions are shown.
          </p>
        )}
      </Panel>
    </div>
  );
}

export function AdminSupportWorkspacePage() {
  const [, params] = useRoute("/app/admin/support-sessions/:sessionId");
  const sessionId = params?.sessionId || "";
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const workspaceQuery = useQuery<SupportWorkspace, Error>({
    queryKey: ["admin-support-workspace", sessionId],
    queryFn: () => requestJson(`/api/admin/support-sessions/${encodeURIComponent(sessionId)}`),
    enabled: Boolean(sessionId),
    retry: false,
    staleTime: 0,
  });
  const closeMutation = useMutation({
    mutationFn: async () => {
      const token = await csrfToken();
      return requestJson(`/api/admin/support-sessions/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-support-workspace", sessionId] });
    },
  });
  const data = workspaceQuery.data;
  const panelClass = theme === "dark" ? "text-white/70" : "text-gray-700";
  if (workspaceQuery.isLoading) return <div className="mx-auto max-w-7xl p-8 text-sm text-white/50">Checking customer approval…</div>;
  if (workspaceQuery.error || !data) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-8">
        <p role="alert" className="text-sm text-amber-400">{workspaceQuery.error?.message || "This support session is unavailable."}</p>
        <button onClick={() => setLocation("/app/users")} className="text-sm text-cyan-400 hover:underline">Return to Customers</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6 md:p-8">
      <button onClick={() => setLocation("/app/users")} className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:underline">
        <ArrowLeft size={16} /> Customers
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
            <ShieldAlert size={14} /> Customer-approved support session · Read only
          </div>
          <h1 className="text-3xl font-display font-bold text-brand-gradient">{data.project.name}</h1>
          <p className={`mt-1 text-sm ${theme === "dark" ? "text-white/50" : "text-gray-500"}`}>
            {data.customer.name} · {data.customer.email} · Project {data.project.id}
          </p>
        </div>
        <button
          onClick={() => closeMutation.mutate()}
          disabled={closeMutation.isPending}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/75 hover:bg-white/5 disabled:opacity-50"
        >
          {closeMutation.isPending ? "Closing…" : "Close support session"}
        </button>
      </header>
      {closeMutation.error && <p role="alert" className="text-sm text-red-400">{closeMutation.error.message}</p>}
      <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
        theme === "dark" ? "border-amber-400/20 bg-amber-400/5 text-white/65" : "border-amber-200 bg-amber-50 text-gray-700"
      }`}>
        <Shield size={18} className="mt-0.5 shrink-0 text-amber-400" />
        <p>This page contains only project metadata and troubleshooting status. It does not expose source files, private app data, passwords, API keys, environment variables, editing, publishing, deletion, or other projects. Approval is checked again on every request; expiration or customer revocation blocks subsequent requests.</p>
      </div>

      <Panel title="Project diagnostics">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Type" value={data.project.type} />
          <Info label="Framework" value={data.project.framework} />
          <Info label="Build status" value={data.project.status} />
          <Info label="Deployment status" value={data.project.deploymentStatus} />
          <Info label="Created" value={dateLabel(data.project.createdAt)} />
          <Info label="Updated" value={dateLabel(data.project.updatedAt)} />
          <Info label="Deployment updated" value={dateLabel(data.project.deploymentUpdatedAt)} />
          <Info label="Approval expires" value={dateLabel(data.session.expiresAt)} />
        </div>
        {data.project.deploymentUrl && (
          <a href={data.project.deploymentUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-400 hover:underline">
            <Globe size={15} /> Open public deployment <ExternalLink size={13} />
          </a>
        )}
      </Panel>

      <Panel title="Deployment history">
        {data.diagnostics.deployments.length ? (
          <div className="space-y-2">
            {data.diagnostics.deployments.map((deployment, index) => (
              <div key={`${deployment.createdAt}-${index}`} className="flex items-center justify-between gap-3 border-b border-white/5 py-3 last:border-0">
                <span className={`text-sm ${panelClass}`}>{dateLabel(deployment.createdAt)}</span>
                <div className="flex items-center gap-3">
                  <StatusPill status={deployment.status} />
                  {deployment.deploymentUrl && <a href={deployment.deploymentUrl} target="_blank" rel="noreferrer" aria-label="Open public deployment"><ExternalLink size={14} className="text-cyan-400" /></a>}
                </div>
              </div>
            ))}
          </div>
        ) : <p className={`text-sm ${panelClass}`}>No deployment records are available.</p>}
      </Panel>

      <Panel title="Troubleshooting activity">
        {data.diagnostics.operations.length ? (
          <div className="space-y-2">
            {data.diagnostics.operations.map((operation, index) => (
              <div key={`${operation.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-3 last:border-0">
                <div className="flex items-center gap-2">
                  <Activity size={15} className="text-cyan-400" />
                  <span className={`text-sm ${panelClass}`}>{operation.kind}</span>
                  <span className={`text-xs ${theme === "dark" ? "text-white/35" : "text-gray-400"}`}>{dateLabel(operation.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={operation.status} />
                  {operation.failureDetails && <span className="text-xs text-white/40">{operation.failureDetails}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : <p className={`text-sm ${panelClass}`}>No troubleshooting operations are available.</p>}
        <div className={`mt-4 flex flex-wrap gap-5 border-t border-white/5 pt-4 text-xs ${panelClass}`}>
          <span className="inline-flex items-center gap-2"><RefreshCw size={13} /> {data.diagnostics.buildActivityTotal} build turns</span>
          <span className="inline-flex items-center gap-2"><Clock3 size={13} /> Latest {dateLabel(data.diagnostics.lastBuildActivityAt)}</span>
        </div>
        {data.diagnostics.buildActivity.length > 0 && (
          <div className="mt-3 space-y-2">
            {data.diagnostics.buildActivity.slice(0, 20).map((build, index) => (
              <div key={`${build.createdAt}-${index}`} className={`flex items-center gap-2 text-xs ${panelClass}`}>
                <CalendarDays size={13} /> {build.mode} · {dateLabel(build.createdAt)}
              </div>
            ))}
          </div>
        )}
        {data.diagnostics.buildAttempts.length > 0 && (
          <div className="mt-5 border-t border-white/5 pt-4">
            <h4 className={`mb-3 text-sm font-semibold ${panelClass}`}>Native runtime attempts</h4>
            <div className="space-y-2">
              {data.diagnostics.buildAttempts.map((attempt) => (
                <details key={attempt.attemptId} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs">
                    <StatusPill status={attempt.status} />
                    <span className={panelClass}>{dateLabel(new Date(attempt.startedAt).toISOString())}</span>
                    {attempt.errorCode && <code className="text-rose-300">{attempt.errorCode}</code>}
                  </summary>
                  <div className={`mt-3 grid gap-2 border-t border-white/5 pt-3 text-xs sm:grid-cols-2 ${panelClass}`}>
                    <span>Provider: {attempt.provider || "Not resolved"}</span>
                    <span>Model: {attempt.modelId || "Not resolved"}</span>
                    <span>Last stage: {attempt.lastStage || "Not recorded"}</span>
                    <span>Last successful stage: {attempt.lastSuccessfulStage || "Not recorded"}</span>
                    {attempt.failureStage && <span>Failure stage: {attempt.failureStage}</span>}
                    {attempt.correlationId && <span>Correlation ID: <code>{attempt.correlationId}</code></span>}
                  </div>
                  {attempt.customerMessage && <p className="mt-3 text-xs text-rose-300">{attempt.customerMessage}</p>}
                  <ol className="mt-3 space-y-2">
                    {data.diagnostics.buildEvents.filter((event) => event.attemptId === attempt.attemptId).map((event, index) => (
                      <li key={`${event.occurredAt}-${index}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 text-xs ${theme === "dark" ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                        <span className={panelClass}>{event.message || event.stage.replaceAll("_", " ")}</span>
                        <span className="flex items-center gap-2">
                          {event.errorCode && <code className="text-rose-300">{event.errorCode}</code>}
                          {event.gatewayStatus !== null && <code>Gateway HTTP {event.gatewayStatus}</code>}
                          <time className="text-xs text-slate-500">{dateLabel(new Date(event.occurredAt).toISOString())}</time>
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
