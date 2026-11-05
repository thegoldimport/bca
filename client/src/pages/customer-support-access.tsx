import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, FolderGit2, LockKeyhole, ShieldCheck, XCircle } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { csrfToken } from "@/lib/auth";

type SupportAccessData = {
  scope: string;
  disclosure: string;
  projects: Array<{
    id: number;
    name: string;
    type: string;
    status: string;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  grants: Array<{
    id: string;
    projectId: number;
    projectName: string;
    permission: string;
    grantedAt: number;
    expiresAt: number;
    revokedAt: number | null;
    status: "active" | "expired" | "revoked";
  }>;
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

function dateLabel(value: number | string | null): string {
  if (value == null || value === "") return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function statusClass(status: string): string {
  if (status === "active") return "bg-emerald-500/15 text-emerald-400";
  if (status === "revoked" || status === "closed") return "bg-red-500/15 text-red-400";
  return "bg-amber-500/15 text-amber-300";
}

export default function CustomerSupportAccessPage() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [acknowledged, setAcknowledged] = useState(false);
  const accessQuery = useQuery<SupportAccessData, Error>({
    queryKey: ["customer-support-access"],
    queryFn: () => requestJson("/api/support-access"),
    staleTime: 0,
  });

  const grantMutation = useMutation({
    mutationFn: async () => {
      const token = await csrfToken();
      return requestJson("/api/support-access/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ projectId: Number(projectId), durationMinutes }),
      });
    },
    onSuccess: () => {
      setAcknowledged(false);
      queryClient.invalidateQueries({ queryKey: ["customer-support-access"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (grantId: string) => {
      const token = await csrfToken();
      return requestJson(`/api/support-access/grants/${encodeURIComponent(grantId)}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customer-support-access"] }),
  });

  const data = accessQuery.data;
  const dark = theme === "dark";
  const border = dark ? "border-white/10" : "border-gray-200";
  const muted = dark ? "text-white/50" : "text-gray-500";
  if (accessQuery.isLoading) return <p className={`py-8 text-sm ${muted}`}>Loading support access…</p>;
  if (accessQuery.error || !data) {
    return <p role="alert" className="py-8 text-sm text-red-400">{accessQuery.error?.message || "Support access is unavailable."}</p>;
  }

  return (
    <div className="space-y-5">
      <section className={`rounded-2xl border p-5 ${border} ${dark ? "bg-white/[0.02]" : "bg-white"}`}>
        <div className="mb-4 flex items-start gap-3">
          <LockKeyhole className="mt-0.5 shrink-0 text-cyan-400" size={20} />
          <div>
            <h2 className={`font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Support Access</h2>
            <p className={`mt-1 text-sm ${muted}`}>Approve temporary, read-only diagnostics for one project. You can revoke approval at any time.</p>
          </div>
        </div>
        <div className={`rounded-xl border p-4 text-sm leading-6 ${
          dark ? "border-cyan-400/20 bg-cyan-400/5 text-white/75" : "border-cyan-200 bg-cyan-50 text-gray-700"
        }`}>
          {data.disclosure}
        </div>
        <ul className={`mt-3 space-y-1 text-xs ${muted}`}>
          <li>Included: project metadata, build and deployment status, and troubleshooting activity.</li>
          <li>Not included: source files, environment variables, passwords, API keys, private application data, or other projects.</li>
        </ul>
      </section>

      <section className={`rounded-2xl border p-5 ${border} ${dark ? "bg-white/[0.02]" : "bg-white"}`}>
        <h3 className={`mb-4 font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Approve access</h3>
        {data.projects.length === 0 ? (
          <p className={`text-sm ${muted}`}>Create a project before granting support access.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="support-project" className={`mb-2 block text-sm ${dark ? "text-white/70" : "text-gray-700"}`}>Project</label>
              <select
                id="support-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${
                  dark ? "border-white/10 bg-slate-900 text-white" : "border-gray-200 bg-white text-gray-900"
                }`}
              >
                <option value="">Select a project</option>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.type} · {project.status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="support-duration" className={`mb-2 block text-sm ${dark ? "text-white/70" : "text-gray-700"}`}>Access duration</label>
              <select
                id="support-duration"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${
                  dark ? "border-white/10 bg-slate-900 text-white" : "border-gray-200 bg-white text-gray-900"
                }`}
              >
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour (default)</option>
                <option value={240}>4 hours</option>
                <option value={1440}>24 hours</option>
              </select>
            </div>
            <label className={`flex cursor-pointer items-start gap-3 text-sm ${dark ? "text-white/65" : "text-gray-600"}`}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1 accent-cyan-400"
              />
              <span>I approve the limited, read-only access described above for the selected project and duration.</span>
            </label>
            {grantMutation.error && <p role="alert" className="text-sm text-red-400">{grantMutation.error.message}</p>}
            <button
              disabled={!projectId || !acknowledged || grantMutation.isPending}
              onClick={() => grantMutation.mutate()}
              className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {grantMutation.isPending ? "Saving approval…" : "Grant support access"}
            </button>
          </div>
        )}
      </section>

      {revokeMutation.error && <p role="alert" className="text-sm text-red-400">{revokeMutation.error.message}</p>}
      <section className={`rounded-2xl border p-5 ${border} ${dark ? "bg-white/[0.02]" : "bg-white"}`}>
        <h3 className={`mb-4 font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Access history</h3>
        {data.grants.length === 0 ? (
          <p className={`text-sm ${muted}`}>No support access has been approved.</p>
        ) : (
          <div className="space-y-3">
            {data.grants.map((grant) => (
              <article key={grant.id} className={`rounded-xl border p-4 ${border}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <FolderGit2 size={17} className="mt-0.5 text-cyan-400" />
                    <div>
                      <p className={`text-sm font-medium ${dark ? "text-white" : "text-gray-900"}`}>{grant.projectName}</p>
                      <p className={`mt-1 text-xs ${muted}`}>
                        Project {grant.projectId} · Read-only diagnostics · Granted {dateLabel(grant.grantedAt)} · Expires {dateLabel(grant.expiresAt)}
                      </p>
                      {grant.revokedAt != null && <p className={`mt-1 text-xs ${muted}`}>Revoked {dateLabel(grant.revokedAt)}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(grant.status)}`}>{grant.status}</span>
                    {grant.status === "active" && (
                      <button
                        disabled={revokeMutation.isPending}
                        onClick={() => revokeMutation.mutate(grant.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/25 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        <XCircle size={14} /> Revoke now
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-5 ${border} ${dark ? "bg-white/[0.02]" : "bg-white"}`}>
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={17} className="text-emerald-400" />
          <h3 className={`font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Support session history</h3>
        </div>
        {data.sessions.length === 0 ? (
          <p className={`text-sm ${muted}`}>No support sessions have been opened.</p>
        ) : (
          <div className="space-y-2">
            {data.sessions.map((session) => (
              <div key={session.id} className={`flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0 ${border}`}>
                <div>
                  <p className={`text-sm ${dark ? "text-white/75" : "text-gray-700"}`}>
                    {session.operatorName}{session.operatorEmail ? ` · ${session.operatorEmail}` : ""}
                  </p>
                  <p className={`mt-1 inline-flex items-center gap-1 text-xs ${muted}`}>
                    <Clock3 size={12} /> Project {session.projectId} · Opened {dateLabel(session.startedAt)}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(session.status)}`}>{session.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
