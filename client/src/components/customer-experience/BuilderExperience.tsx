import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Compass,
  FileCode2,
  MessageCircle,
  Pause,
  Radio,
  RotateCw,
  Sparkles,
  WandSparkles,
} from "lucide-react";

export type BuildActivityEvent = {
  id: string;
  label: string;
  observedAt: number;
  status: "active" | "complete" | "error" | "info";
  path?: string;
};

export type BuilderPhase =
  | "idle"
  | "clarifying"
  | "planning"
  | "starting"
  | "running"
  | "recovering"
  | "stopping"
  | "success"
  | "paused"
  | "needs_input"
  | "error";

export type ClarificationQuestion = {
  id: string;
  prompt: string;
  options: string[];
  multiple: boolean;
  helperText?: string;
};

const isDark = (theme: string) => theme === "dark";

const phaseLabel: Record<BuilderPhase, string> = {
  idle: "Waiting for your direction",
  clarifying: "A quick question",
  planning: "Thinking it through",
  starting: "Getting things ready",
  running: "Building with you",
  recovering: "Picking up the thread",
  stopping: "Wrapping up this change",
  success: "Ready to review",
  paused: "Paused",
  needs_input: "Your call",
  error: "Needs a hand",
};

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
  if (minutes > 0) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  return `${remainingSeconds}s`;
}

function formatTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function relativeTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "No activity yet";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return formatTime(timestamp);
}

export function ClarificationOptions(props: {
  theme: string;
  question: ClarificationQuestion;
  selectedOptions: string[];
  disabled: boolean;
  onToggle(option: string): void;
  onSubmit(): void;
  onSkip(): void;
  onYouDecide(): void;
  onSomethingElse(): void;
}) {
  const dark = isDark(props.theme);
  const selectedCount = props.selectedOptions.length;
  return (
    <section
      aria-labelledby={`clarification-${props.question.id}`}
      className={`overflow-hidden rounded-2xl border ${
        dark ? "border-teal-300/20 bg-[#101b20]" : "border-teal-900/10 bg-[#f5fbf9]"
      }`}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          dark ? "bg-teal-300/10 text-teal-200" : "bg-teal-700/10 text-teal-800"
        }`}>
          <MessageCircle size={17} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${
            dark ? "text-teal-200/75" : "text-teal-800/75"
          }`}>One detail before I continue</p>
          <h2 id={`clarification-${props.question.id}`} className={`mt-1 text-[15px] font-semibold leading-6 ${
            dark ? "text-[#eff7f4]" : "text-[#17302c]"
          }`}>{props.question.prompt}</h2>
          {props.question.helperText && (
            <p className={`mt-1.5 text-xs leading-5 ${dark ? "text-white/50" : "text-[#52716b]"}`}>
              {props.question.helperText}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 sm:px-5">
        {props.question.options.map((option, index) => {
          const selected = props.selectedOptions.includes(option);
          return (
            <button
              key={`${props.question.id}-${option}`}
              type="button"
              disabled={props.disabled}
              aria-pressed={selected}
              onClick={() => props.onToggle(option)}
              className={`group flex min-h-[48px] items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-[border-color,background-color,color,transform] duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none ${
                selected
                  ? dark
                    ? "border-teal-200/50 bg-teal-200/10 text-teal-50"
                    : "border-teal-700/40 bg-white text-[#153c35]"
                  : dark
                    ? "border-white/10 bg-white/[0.025] text-white/75 hover:border-teal-200/30 hover:bg-white/[0.055]"
                    : "border-[#d6e5e1] bg-white/70 text-[#36534d] hover:border-teal-700/30 hover:bg-white"
              }`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                selected
                  ? "border-teal-500 bg-teal-500 text-[#082c27]"
                  : dark ? "border-white/20 text-transparent" : "border-[#aac3bc] text-transparent"
              }`}>
                {selected ? <Check size={13} strokeWidth={2.7} /> : <span className="sr-only">Not selected</span>}
              </span>
              <span className="min-w-0 flex-1 leading-5">{option}</span>
              <span className={`font-mono text-[10px] ${dark ? "text-white/25" : "text-[#8ba39d]"}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
            </button>
          );
        })}
      </div>

      <div className={`flex flex-col gap-3 border-t px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${
        dark ? "border-white/[0.08] bg-black/10" : "border-[#dce9e5] bg-[#eef7f4]/70"
      }`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={`basis-full text-[10px] ${dark ? "text-white/35" : "text-[#829791]"}`}>
            {props.question.multiple ? "Choose any that fit" : "Choose one"}
          </span>
          <button type="button" disabled={props.disabled} onClick={props.onYouDecide}
            className={`text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70 disabled:opacity-45 ${
              dark ? "text-teal-200 hover:text-white" : "text-teal-800 hover:text-[#122c27]"
            }`}>
            You decide
          </button>
          <button type="button" disabled={props.disabled} onClick={props.onSomethingElse}
            className={`text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70 disabled:opacity-45 ${
              dark ? "text-white/55 hover:text-white" : "text-[#58716b] hover:text-[#183a33]"
            }`}>
            Something else
          </button>
          <button type="button" disabled={props.disabled} onClick={props.onSkip}
            className={`text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70 disabled:opacity-45 ${
              dark ? "text-white/40 hover:text-white/75" : "text-[#7a918b] hover:text-[#36534d]"
            }`}>
            Skip for now
          </button>
        </div>
        <button
          type="button"
          disabled={props.disabled || selectedCount === 0}
          onClick={props.onSubmit}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#74d6c1] px-4 text-xs font-bold text-[#082f29] shadow-sm transition-[transform,background-color] hover:-translate-y-px hover:bg-[#8ce4d1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 motion-reduce:transform-none"
        >
          Share my choice
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {props.question.multiple
          ? `${selectedCount} options selected. Select any that fit.`
          : `${selectedCount ? "An option is selected." : "No option selected."} Select any that fits.`}
      </span>
    </section>
  );
}

export function BuildActivityTimeline(props: {
  theme: string;
  phase: BuilderPhase;
  message: string;
  startedAt: number | null;
  events: BuildActivityEvent[];
  connectionState: string;
  currentFile: string | null;
  currentFileContent: string | null;
  fileLoading: boolean;
  onOpenFile(path: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const dark = isDark(props.theme);
  const hasStarted = props.startedAt !== null && props.startedAt > 0;
  const latestEvent = props.events.reduce<BuildActivityEvent | null>(
    (latest, event) => (!latest || event.observedAt > latest.observedAt ? event : latest),
    null,
  );
  const elapsed = hasStarted ? Math.max(0, now - (props.startedAt as number)) : null;
  const border = dark ? "border-white/10" : "border-[#d9e6e2]";
  const compactTitle = props.phase === "running" ? "Working" : phaseLabel[props.phase] || "Build activity";
  const compactMessage = props.phase === "running" && latestEvent
    ? latestEvent.label
    : props.message || phaseLabel[props.phase];

  return (
    <section className={`overflow-hidden rounded-2xl border ${border} ${dark ? "bg-[#121a1e]" : "bg-[#f8fbfa]"}`}>
      <button
        type="button"
        id="build-activity-timeline-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500/70 dark:hover:bg-white/[0.025] sm:px-5"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          props.phase === "error"
            ? dark ? "bg-rose-300/10 text-rose-200" : "bg-rose-100 text-rose-700"
            : dark ? "bg-teal-200/10 text-teal-200" : "bg-teal-700/10 text-teal-800"
        }`}>
          {props.phase === "error" ? <AlertCircle size={16} /> : <Radio size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${dark ? "text-white/90" : "text-[#213a35]"}`}>{compactTitle}</span>
          <span className={`mt-0.5 block truncate text-xs ${dark ? "text-white/45" : "text-[#718983]"}`}>
            {compactMessage}
          </span>
        </span>
        <span className={`hidden shrink-0 items-center gap-1.5 text-[11px] sm:flex ${dark ? "text-white/45" : "text-[#718983]"}`}>
          <Clock3 size={13} />
          {elapsed === null ? "Not started" : formatElapsed(elapsed)}
        </span>
        <ChevronDown size={16} className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
          expanded ? "rotate-180" : ""
        } ${dark ? "text-white/40" : "text-[#829791]"}`} aria-hidden="true" />
      </button>

      {expanded && (
        <div className={`border-t px-4 pb-4 pt-3 sm:px-5 ${border}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${dark ? "text-white/35" : "text-[#8a9d98]"}`}>Elapsed</p>
              <p className={`mt-1 text-xs font-medium tabular-nums ${dark ? "text-white/75" : "text-[#405b54]"}`}>
                {elapsed === null ? "Not started" : formatElapsed(elapsed)}
              </p>
            </div>
            <div>
              <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${dark ? "text-white/35" : "text-[#8a9d98]"}`}>Last activity</p>
              <p className={`mt-1 text-xs font-medium ${dark ? "text-white/75" : "text-[#405b54]"}`}>
                {latestEvent ? relativeTime(latestEvent.observedAt) : "No activity yet"}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${dark ? "text-white/35" : "text-[#8a9d98]"}`}>Connection</p>
              <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${dark ? "text-white/75" : "text-[#405b54]"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  /connected|open/i.test(props.connectionState) && !/disconnected|not connected/i.test(props.connectionState)
                    ? "bg-teal-400" : dark ? "bg-white/25" : "bg-[#a8b9b4]"
                }`} />
                {props.connectionState || "Unknown"}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className={`mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] ${dark ? "text-white/35" : "text-[#8a9d98]"}`}>
              Observed events <span className="ml-1 font-mono normal-case tracking-normal">{props.events.length}</span>
            </p>
            {props.events.length ? (
              <ol className="space-y-1.5" aria-label="Observed build events">
                {[...props.events].sort((a, b) => a.observedAt - b.observedAt).map((event) => (
                  <li key={event.id} className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 ${
                    dark ? "bg-white/[0.025]" : "bg-white/75"
                  }`}>
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${
                      event.status === "error" ? "text-rose-400"
                        : event.status === "complete" ? dark ? "text-teal-300" : "text-teal-700"
                          : event.status === "active" ? "text-amber-300" : dark ? "text-white/35" : "text-[#8a9d98]"
                    }`}>
                      {event.status === "error" ? <AlertCircle size={13} />
                        : event.status === "complete" ? <Check size={13} />
                          : event.status === "active" ? <RotateCw size={12} className="motion-safe:animate-spin motion-reduce:animate-none" />
                            : <Circle size={9} />}
                    </span>
                    <span className={`min-w-0 flex-1 text-xs leading-5 ${dark ? "text-white/70" : "text-[#425d56]"}`}>
                      {event.label}
                    </span>
                    {event.path && (
                      <button
                        type="button"
                        onClick={() => props.onOpenFile(event.path as string)}
                        aria-label={`Open source for ${event.path}`}
                        className={`max-w-[42%] shrink-0 truncate rounded-md px-2 py-1 font-mono text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70 ${
                          props.currentFile === event.path
                            ? dark ? "bg-teal-200/10 text-teal-100" : "bg-teal-100 text-teal-900"
                            : dark ? "text-teal-200/70 hover:bg-white/[0.06] hover:text-teal-100" : "text-teal-800 hover:bg-teal-50"
                        }`}
                      >
                        {event.path}
                      </button>
                    )}
                    <time className={`shrink-0 pt-0.5 font-mono text-[10px] ${dark ? "text-white/30" : "text-[#96a7a2]"}`} dateTime={Number.isFinite(event.observedAt) ? new Date(event.observedAt).toISOString() : undefined}>
                      {formatTime(event.observedAt)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <div className={`rounded-lg border border-dashed px-3 py-3 text-xs ${
                dark ? "border-white/10 text-white/40" : "border-[#d3e1dd] text-[#839791]"
              }`}>
                No activity has been reported yet.
              </div>
            )}
          </div>

          <section className="mt-4" aria-label="Source preview">
            <div className="mb-2 flex items-center gap-2">
              <FileCode2 size={13} className={dark ? "text-teal-200/65" : "text-teal-800/65"} aria-hidden="true" />
              <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${dark ? "text-white/40" : "text-[#829791]"}`}>
                Source preview
              </p>
            </div>
            <div className={`overflow-hidden rounded-xl border ${
              dark ? "border-white/[0.08] bg-[#0b1114]" : "border-[#dce8e4] bg-[#f1f6f4]"
            }`}>
              {props.currentFile && (
                <div className={`flex items-center gap-2 border-b px-3 py-2 ${
                  dark ? "border-white/[0.08] bg-white/[0.02]" : "border-[#dce8e4] bg-white/60"
                }`}>
                  <FileCode2 size={12} className={dark ? "text-teal-200/60" : "text-teal-800/60"} aria-hidden="true" />
                  <span className={`min-w-0 break-all font-mono text-[10px] leading-4 ${
                    dark ? "text-white/55" : "text-[#637b74]"
                  }`}>{props.currentFile}</span>
                </div>
              )}
              {props.fileLoading ? (
                <div className={`px-3 py-4 text-xs ${dark ? "text-white/40" : "text-[#829791]"}`} role="status">
                  Loading source…
                </div>
              ) : props.currentFile && props.currentFileContent !== null ? (
                <pre className={`max-h-72 overflow-auto p-3 font-mono text-[11px] leading-5 ${
                  dark ? "text-teal-50/75" : "text-[#334e47]"
                }`}><code>{props.currentFileContent}</code></pre>
              ) : (
                <p className={`px-3 py-4 text-xs ${dark ? "text-white/35" : "text-[#829791]"}`}>
                  {props.currentFile ? "Source content is not available." : "Choose a file path above to inspect its source."}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{props.message || phaseLabel[props.phase]}</span>
    </section>
  );
}

function phasePresentation(phase: BuilderPhase) {
  if (phase === "idle") return { icon: Compass, title: "A place for your idea", detail: "When you’re ready, tell your teammate what you’d like to make." };
  if (phase === "clarifying") return { icon: MessageCircle, title: "A little more context", detail: "Your teammate is asking a question before shaping the next step." };
  if (phase === "planning") return { icon: Sparkles, title: "Putting a plan together", detail: "The shape of the work is coming into focus." };
  if (phase === "starting") return { icon: WandSparkles, title: "Getting the workspace ready", detail: "The build is getting set up. This view will change as real activity arrives." };
  if (phase === "running") return { icon: WandSparkles, title: "Your app is taking shape", detail: "A live preview will appear here when one is available." };
  if (phase === "recovering") return { icon: RotateCw, title: "Finding the thread again", detail: "Your teammate is working through a recovery." };
  if (phase === "stopping") return { icon: Pause, title: "Bringing this step to a pause", detail: "Waiting for the runtime to report what happens next." };
  if (phase === "paused") return { icon: Pause, title: "Paused for now", detail: "Nothing is moving until you choose what comes next." };
  if (phase === "needs_input") return { icon: MessageCircle, title: "Your teammate needs your input", detail: "Share a little direction to keep things moving." };
  if (phase === "error") return { icon: AlertCircle, title: "That didn’t go as planned", detail: "The runtime reported an issue. Check the activity details for what happened." };
  return { icon: Check, title: "Live preview is taking over", detail: "The project preview is shown in its live view." };
}

const assemblyPieces = [
  { className: "bc-piece-a", label: "structure" },
  { className: "bc-piece-b", label: "layout" },
  { className: "bc-piece-c", label: "details" },
];

export function BuildPreviewPlaceholder(props: {
  theme: string;
  phase: BuilderPhase;
  message: string;
  startedAt: number | null;
  onOpenActivity(): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (props.startedAt === null || props.startedAt <= 0) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [props.startedAt]);
  const dark = isDark(props.theme);
  const presentation = phasePresentation(props.phase);
  const Icon = presentation.icon;
  const working = ["starting", "running", "recovering", "stopping"].includes(props.phase);
  const waiting = ["paused", "needs_input"].includes(props.phase);
  const elapsedMs = props.startedAt !== null && props.startedAt > 0
    ? Math.max(0, now - props.startedAt)
    : null;

  return (
    <section
      aria-label="Project preview status"
      className={`relative flex min-h-[320px] flex-col overflow-hidden rounded-[22px] border p-5 sm:min-h-[410px] sm:p-7 ${
        dark
          ? "border-white/[0.09] bg-[#10181d] text-white"
          : "border-[#d8e5e1] bg-[#f7fbf9] text-[#17332d]"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className={`absolute -right-16 -top-24 h-64 w-64 rounded-full blur-3xl ${
          dark ? "bg-teal-300/[0.055]" : "bg-teal-400/[0.10]"
        }`} />
        <div className={`absolute -bottom-28 left-1/4 h-56 w-56 rounded-full blur-3xl ${
          dark ? "bg-indigo-400/[0.045]" : "bg-indigo-400/[0.07]"
        }`} />
        <div className={`absolute inset-0 opacity-[0.14] ${
          dark
            ? "[background-image:linear-gradient(rgba(167,228,216,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(167,228,216,.12)_1px,transparent_1px)]"
            : "[background-image:linear-gradient(rgba(41,113,99,.1)_1px,transparent_1px),linear-gradient(90deg,rgba(41,113,99,.1)_1px,transparent_1px)]"
        } [background-size:34px_34px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]`} />
      </div>

      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            dark ? "bg-white/[0.06] text-teal-200" : "bg-white text-teal-800 shadow-sm"
          }`}><FileCode2 size={15} aria-hidden="true" /></span>
          <span className={`truncate text-[11px] font-semibold uppercase tracking-[0.15em] ${
            dark ? "text-white/50" : "text-[#748c85]"
          }`}>Live workspace</span>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
          working
            ? dark ? "border-teal-200/15 bg-teal-200/[0.07] text-teal-100/80" : "border-teal-800/10 bg-teal-100/70 text-teal-900"
            : props.phase === "error"
              ? dark ? "border-rose-200/15 bg-rose-300/[0.08] text-rose-100/80" : "border-rose-800/10 bg-rose-100 text-rose-800"
              : dark ? "border-white/10 bg-white/[0.035] text-white/50" : "border-[#dce8e4] bg-white/70 text-[#718983]"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            working ? "bg-teal-300 motion-safe:animate-pulse motion-reduce:animate-none"
              : props.phase === "error" ? "bg-rose-400"
                : waiting ? "bg-amber-400" : dark ? "bg-white/30" : "bg-[#9aada7]"
          }`} />
          {phaseLabel[props.phase]}
        </span>
      </div>

      {working ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center py-7">
          <div className="relative flex h-44 w-full max-w-[390px] items-center justify-center sm:h-52" aria-hidden="true">
            <div className={`absolute h-36 w-36 rounded-full border ${
              dark ? "border-teal-200/[0.10]" : "border-teal-800/[0.11]"
            }`} />
            <div className={`absolute h-28 w-28 rounded-full border border-dashed motion-safe:animate-[spin_28s_linear_infinite] motion-reduce:animate-none ${
              dark ? "border-indigo-200/20" : "border-indigo-800/20"
            }`} />
            <div className={`absolute h-20 w-20 rounded-[22px] border ${
              dark ? "border-white/[0.13] bg-[#172329]/90" : "border-[#c8dfd8] bg-[#f5fbf9]"
            } shadow-[0_18px_50px_rgba(16,74,67,.12)]`}>
              <div className={`absolute left-3 right-3 top-3 h-2 rounded-full ${dark ? "bg-teal-200/20" : "bg-teal-700/15"}`} />
              <div className={`absolute left-3 top-8 h-5 w-5 rounded-md ${dark ? "bg-indigo-200/15" : "bg-indigo-600/10"}`} />
              <div className={`absolute left-11 right-3 top-8 h-1.5 rounded-full ${dark ? "bg-white/15" : "bg-[#afc7c0]"}`} />
              <div className={`absolute left-11 right-5 top-12 h-1.5 rounded-full ${dark ? "bg-white/10" : "bg-[#d0dfda]"}`} />
            </div>
            {assemblyPieces.map((piece) => (
              <span key={piece.className} className={`bc-assembly-piece ${piece.className} absolute rounded-xl border ${
                dark ? "border-teal-100/20 bg-[#1c3437]/90" : "border-teal-800/15 bg-white/90"
              } shadow-lg`}>
                <span className={`block h-1.5 w-8 rounded-full ${dark ? "bg-teal-100/25" : "bg-teal-800/20"}`} />
                <span className={`mt-2 block h-1 w-5 rounded-full ${dark ? "bg-indigo-100/20" : "bg-indigo-700/15"}`} />
              </span>
            ))}
            <span className={`absolute left-[17%] top-[27%] h-1.5 w-1.5 rounded-full motion-safe:animate-pulse motion-reduce:animate-none ${
              dark ? "bg-teal-200/70" : "bg-teal-700/60"
            }`} />
            <span className={`absolute right-[18%] bottom-[25%] h-1 w-1 rounded-full motion-safe:animate-pulse motion-reduce:animate-none ${
              dark ? "bg-indigo-200/60" : "bg-indigo-700/50"
            }`} />
          </div>
          <div className="mt-1 max-w-md text-center">
            <div className="flex items-center justify-center gap-2">
              <Icon size={15} className={dark ? "text-teal-200" : "text-teal-800"} aria-hidden="true" />
              <h2 className={`text-base font-semibold tracking-[-0.02em] sm:text-lg ${dark ? "text-white/90" : "text-[#1a3932]"}`}>
                {presentation.title}
              </h2>
            </div>
            <p aria-live="polite" className={`mx-auto mt-2 max-w-sm text-xs leading-5 sm:text-sm ${
              dark ? "text-white/48" : "text-[#6d847e]"
            }`}>{props.message || presentation.detail}</p>
          </div>
          <div className={`mt-5 flex items-center gap-3 text-[11px] ${dark ? "text-white/35" : "text-[#879b95]"}`}>
            <span className="flex items-center gap-1.5">
              <Clock3 size={12} aria-hidden="true" />
              {elapsedMs === null ? "Timer starts with the build" : `${formatElapsed(elapsedMs)} elapsed`}
            </span>
            <span className={`h-1 w-1 rounded-full ${dark ? "bg-white/20" : "bg-[#afc1bb]"}`} />
            <span>Activity updates as they arrive</span>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center py-9 text-center">
          <div className={`flex h-14 w-14 items-center justify-center rounded-[18px] ${
            props.phase === "error"
              ? dark ? "bg-rose-300/10 text-rose-200" : "bg-rose-100 text-rose-700"
              : waiting
                ? dark ? "bg-amber-200/10 text-amber-100" : "bg-amber-100 text-amber-800"
                : dark ? "bg-teal-200/10 text-teal-200" : "bg-teal-700/10 text-teal-800"
          }`}>
            <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <h2 className={`mt-4 text-lg font-semibold tracking-[-0.025em] ${dark ? "text-white/90" : "text-[#1a3932]"}`}>
            {presentation.title}
          </h2>
          <p aria-live="polite" className={`mt-2 max-w-sm text-sm leading-6 ${dark ? "text-white/45" : "text-[#6d847e]"}`}>
            {props.message || presentation.detail}
          </p>
          {elapsedMs !== null && (
            <p className={`mt-3 font-mono text-[11px] ${dark ? "text-white/30" : "text-[#8da19a]"}`}>
              {formatElapsed(elapsedMs)} elapsed
            </p>
          )}
        </div>
      )}

      <div className={`relative z-10 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between ${
        dark ? "border-white/[0.08]" : "border-[#dce8e4]"
      }`}>
        <p className={`text-[11px] leading-4 ${dark ? "text-white/35" : "text-[#82968f]"}`}>
          No mock screen here. This space reflects live project status.
        </p>
        <button type="button" onClick={props.onOpenActivity}
          className={`inline-flex min-h-9 items-center gap-1.5 self-start text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70 sm:self-auto ${
            dark ? "text-teal-200 hover:text-white" : "text-teal-800 hover:text-[#14342e]"
          }`}>
          View activity <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </div>
      <style>{`
        .bc-assembly-piece { width: 58px; height: 46px; padding: 10px; opacity: .92; }
        .bc-piece-a { animation: bc-piece-a 5.2s ease-in-out infinite; }
        .bc-piece-b { animation: bc-piece-b 5.2s ease-in-out infinite; }
        .bc-piece-c { animation: bc-piece-c 5.2s ease-in-out infinite; }
        @keyframes bc-piece-a {
          0%, 100% { transform: translate(-79px, -42px) rotate(-9deg); }
          48%, 66% { transform: translate(-43px, -30px) rotate(-4deg); }
        }
        @keyframes bc-piece-b {
          0%, 100% { transform: translate(78px, -24px) rotate(8deg); }
          48%, 66% { transform: translate(42px, -14px) rotate(3deg); }
        }
        @keyframes bc-piece-c {
          0%, 100% { transform: translate(4px, 79px) rotate(4deg); }
          48%, 66% { transform: translate(3px, 46px) rotate(1deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bc-piece-a, .bc-piece-b, .bc-piece-c { animation: none !important; }
          .bc-piece-a { transform: translate(-55px, -34px) rotate(-5deg); }
          .bc-piece-b { transform: translate(55px, -21px) rotate(5deg); }
          .bc-piece-c { transform: translate(3px, 65px) rotate(2deg); }
        }
      `}</style>
    </section>
  );
}
