import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, LifeBuoy, MessageSquareText, Plus, RefreshCw, Send } from "lucide-react";
import { authHeaders, csrfToken } from "@/lib/auth";
import { useTheme } from "@/contexts/theme-context";

type TicketStatus = "open" | "waiting_for_support" | "waiting_for_customer" | "resolved";
type TicketCategory = "account" | "billing" | "builder" | "hosting" | "bug" | "general";
type Ticket = {
  id: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  project_id: number | null;
  project_name?: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};
type TicketMessage = { id: string; sender: string; senderType: "customer" | "support"; body: string; createdAt: string };
type Project = { id: number; name: string };

const categories: Array<{ value: TicketCategory; label: string }> = [
  { value: "account", label: "Account" },
  { value: "billing", label: "Billing" },
  { value: "builder", label: "AI Builder" },
  { value: "hosting", label: "Hosting and deployment" },
  { value: "bug", label: "Bug report" },
  { value: "general", label: "General question" },
];

const statusLabels: Record<TicketStatus, string> = {
  open: "Open",
  waiting_for_support: "Waiting for support",
  waiting_for_customer: "Support replied",
  resolved: "Resolved",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Recently";
}

export default function CustomerSupportTicketsPage() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [category, setCategory] = useState<TicketCategory>("general");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ticketResponse, projectResponse] = await Promise.all([
        fetch("/api/support/tickets", { credentials: "same-origin", headers: authHeaders(), cache: "no-store" }),
        fetch("/api/projects", { credentials: "same-origin", headers: authHeaders(), cache: "no-store" }),
      ]);
      const [ticketData, projectData] = await Promise.all([
        ticketResponse.json().catch(() => ({})),
        projectResponse.json().catch(() => []),
      ]);
      if (!ticketResponse.ok) throw new Error(ticketData.message || "Support tickets could not be loaded.");
      if (!projectResponse.ok) throw new Error(projectData.message || "Your projects could not be loaded.");
      const nextTickets = Array.isArray(ticketData.tickets) ? ticketData.tickets : [];
      setTickets(nextTickets);
      setProjects(Array.isArray(projectData)
        ? projectData.map((project: any) => ({ id: Number(project.id), name: String(project.name || "Project") }))
        : []);
      if (selectedTicket) {
        const latest = nextTickets.find((ticket: Ticket) => ticket.id === selectedTicket.id);
        if (latest) setSelectedTicket(latest);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Support tickets could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [selectedTicket]);

  useEffect(() => { void loadTickets(); }, []);

  const openTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setLoadingDetail(true);
    setError("");
    try {
      const response = await fetch(`/api/support/tickets/${encodeURIComponent(ticket.id)}`, {
        credentials: "same-origin",
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "This support ticket could not be opened.");
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "This support ticket could not be opened.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const submitNewTicket = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const token = await csrfToken();
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          body: body.trim(),
          ...(projectIdValue ? { projectId: Number(projectIdValue) } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Your message could not be sent.");
      setSubject("");
      setBody("");
      setCategory("general");
      setProjectIdValue("");
      setShowNewTicket(false);
      setSelectedTicket(data.ticket || null);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      await loadTickets();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Your message could not be sent.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTicket || !reply.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const token = await csrfToken();
      const response = await fetch(`/api/support/tickets/${encodeURIComponent(selectedTicket.id)}/replies`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, ...authHeaders() },
        body: JSON.stringify({ body: reply.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Your reply could not be sent.");
      setReply("");
      setSelectedTicket(data.ticket || selectedTicket);
      setMessages(Array.isArray(data.messages) ? data.messages : messages);
      await loadTickets();
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : "Your reply could not be sent.");
    } finally {
      setSubmitting(false);
    }
  };

  const [projectIdValue, setProjectIdValue] = useState("");
  const panel = dark ? "border-white/10 bg-[#11131b]" : "border-gray-200 bg-white";
  const muted = dark ? "text-white/50" : "text-gray-500";
  const control = `w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-cyan-500 ${
    dark ? "border-white/10 bg-white/[0.04] text-white" : "border-gray-200 bg-white text-gray-900"
  }`;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8" data-testid="customer-support-page">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-cyan-500">
            <LifeBuoy size={19} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.14em]">BuildCustom Support</span>
          </div>
          <h1 className={`mt-2 text-2xl font-bold tracking-tight ${dark ? "text-white" : "text-gray-900"}`}>How can we help?</h1>
          <p className={`mt-1 max-w-2xl text-sm ${muted}`}>
            Send a message to the support team and follow the conversation here.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void loadTickets()} disabled={loading}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium disabled:opacity-50 ${dark ? "border-white/10 text-white/75 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={() => { setShowNewTicket(true); setSelectedTicket(null); }}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-gray-950 hover:bg-cyan-300">
            <Plus size={15} /> New ticket
          </button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-200">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.45fr)]">
        <section className={`overflow-hidden rounded-2xl border ${panel}`}>
          <div className={`flex items-center justify-between border-b px-4 py-3 ${dark ? "border-white/10" : "border-gray-100"}`}>
            <div className="flex items-center gap-2">
              <MessageSquareText size={16} className="text-cyan-500" />
              <h2 className={`text-sm font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Your tickets</h2>
            </div>
            <span className={`text-xs ${muted}`}>{tickets.length}</span>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {loading ? (
              <p className={`px-4 py-6 text-sm ${muted}`}>Loading your tickets…</p>
            ) : tickets.length ? tickets.map((ticket) => (
              <button key={ticket.id} type="button" onClick={() => { setShowNewTicket(false); void openTicket(ticket); }}
                className={`block w-full border-b px-4 py-4 text-left transition-colors ${
                  selectedTicket?.id === ticket.id
                    ? dark ? "bg-cyan-400/10" : "bg-cyan-50"
                    : dark ? "border-white/[0.06] hover:bg-white/[0.035]" : "border-gray-100 hover:bg-gray-50"
                }`}>
                <span className="flex items-start justify-between gap-3">
                  <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${dark ? "text-white/90" : "text-gray-800"}`}>{ticket.subject}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    ticket.status === "resolved"
                      ? dark ? "bg-emerald-300/10 text-emerald-200" : "bg-emerald-50 text-emerald-700"
                      : dark ? "bg-white/5 text-white/55" : "bg-gray-100 text-gray-600"
                  }`}>{statusLabels[ticket.status]}</span>
                </span>
                <span className={`mt-1 block text-xs ${muted}`}>{categories.find((item) => item.value === ticket.category)?.label || "General"}</span>
                <span className={`mt-2 block text-[11px] ${muted}`}>{formatDate(ticket.last_message_at || ticket.updated_at)}</span>
              </button>
            )) : (
              <div className="px-4 py-7">
                <p className={`text-sm font-medium ${dark ? "text-white/80" : "text-gray-700"}`}>No support tickets yet</p>
                <p className={`mt-1 text-xs leading-5 ${muted}`}>Create a ticket whenever you need help. You do not need to select a project.</p>
              </div>
            )}
          </div>
        </section>

        <section className={`min-h-[440px] overflow-hidden rounded-2xl border ${panel}`}>
          {showNewTicket || (!selectedTicket && !loading) ? (
            <form onSubmit={submitNewTicket} className="space-y-4 p-5 sm:p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-600">New support request</p>
                <h2 className={`mt-1 text-lg font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Tell us what you need</h2>
              </div>
              <label className="block">
                <span className={`mb-1.5 block text-xs font-medium ${dark ? "text-white/70" : "text-gray-700"}`}>Category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value as TicketCategory)} className={control}>
                  {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={`mb-1.5 block text-xs font-medium ${dark ? "text-white/70" : "text-gray-700"}`}>Subject</span>
                <input required minLength={4} maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)}
                  placeholder="A short summary" className={control} />
              </label>
              <label className="block">
                <span className={`mb-1.5 block text-xs font-medium ${dark ? "text-white/70" : "text-gray-700"}`}>Project (optional)</span>
                <select value={projectIdValue} onChange={(event) => setProjectIdValue(event.target.value)} className={control}>
                  <option value="">No project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={`mb-1.5 block text-xs font-medium ${dark ? "text-white/70" : "text-gray-700"}`}>Message</span>
                <textarea required maxLength={8000} rows={7} value={body} onChange={(event) => setBody(event.target.value)}
                  placeholder="Describe what happened and what you need help with." className={`${control} resize-y`} />
              </label>
              <p className={`text-xs leading-5 ${muted}`}>
                A ticket does not grant access to your project files or diagnostics. Project-specific support access is managed separately in Settings.
              </p>
              <button type="submit" disabled={submitting}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-gray-950 disabled:opacity-50">
                <Send size={14} /> {submitting ? "Sending…" : "Send to support"}
              </button>
            </form>
          ) : selectedTicket ? (
            <>
              <div className={`flex items-center gap-3 border-b px-4 py-3.5 ${dark ? "border-white/10" : "border-gray-100"}`}>
                <button type="button" onClick={() => { setSelectedTicket(null); setMessages([]); }}
                  className={`rounded-lg p-2 lg:hidden ${dark ? "text-white/60 hover:bg-white/5" : "text-gray-600 hover:bg-gray-100"}`}
                  aria-label="Back to tickets"><ArrowLeft size={16} /></button>
                <div className="min-w-0 flex-1">
                  <h2 className={`truncate text-sm font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{selectedTicket.subject}</h2>
                  <p className={`mt-0.5 text-xs ${muted}`}>
                    {categories.find((item) => item.value === selectedTicket.category)?.label || "General"}
                    {selectedTicket.project_name ? ` · ${selectedTicket.project_name}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${dark ? "bg-white/5 text-white/65" : "bg-gray-100 text-gray-600"}`}>
                  {statusLabels[selectedTicket.status]}
                </span>
              </div>
              <div className="flex min-h-[330px] max-h-[520px] flex-col gap-4 overflow-y-auto p-4 sm:p-6">
                {loadingDetail ? <p className={`text-sm ${muted}`}>Loading conversation…</p> : messages.map((message) => (
                  <article key={message.id} className={`max-w-[92%] rounded-2xl border px-4 py-3 ${
                    message.senderType === "customer"
                      ? "ml-auto border-cyan-400/20 bg-cyan-400/10"
                      : dark ? "border-white/10 bg-white/[0.035]" : "border-gray-200 bg-gray-50"
                  }`}>
                    <header className="mb-1.5 flex items-center justify-between gap-4">
                      <span className={`text-xs font-semibold ${dark ? "text-white/80" : "text-gray-800"}`}>{message.sender}</span>
                      <time className={`text-[10px] ${muted}`} dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                    </header>
                    <p className={`whitespace-pre-wrap break-words text-sm leading-6 ${dark ? "text-white/75" : "text-gray-700"}`}>{message.body}</p>
                  </article>
                ))}
              </div>
              <form onSubmit={submitReply} className={`border-t p-4 sm:p-5 ${dark ? "border-white/10" : "border-gray-100"}`}>
                <label className="sr-only" htmlFor="support-ticket-reply">Reply to support</label>
                <textarea id="support-ticket-reply" required maxLength={8000} rows={3} value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Reply here in the chat…" className={`${control} resize-y`} />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className={`text-[11px] ${muted}`}>Replies stay in this conversation.</span>
                  <button type="submit" disabled={submitting || !reply.trim()}
                    className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-cyan-400 px-3.5 text-xs font-semibold text-gray-950 disabled:opacity-50">
                    <Send size={13} /> {submitting ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex h-full min-h-[440px] flex-col items-center justify-center px-6 text-center">
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${dark ? "bg-white/5 text-cyan-300" : "bg-cyan-50 text-cyan-700"}`}>
                <MessageSquareText size={20} />
              </div>
              <h2 className={`mt-4 text-sm font-semibold ${dark ? "text-white/80" : "text-gray-800"}`}>Select a ticket to read the conversation</h2>
              <p className={`mt-1 max-w-sm text-xs leading-5 ${muted}`}>Support replies and status updates will appear here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
