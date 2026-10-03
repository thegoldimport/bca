type NativeAutoContinueControlProps = {
  enabled: boolean;
  busy: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
};

export function NativeAutoContinueControl({
  enabled,
  busy,
  disabled = false,
  onChange,
}: NativeAutoContinueControlProps) {
  const unavailable = busy || disabled;

  return (
    <section
      className="rounded-xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-slate-900 dark:border-white/10 dark:bg-white/[0.035] dark:text-white"
      aria-labelledby="native-auto-continue-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3
            id="native-auto-continue-title"
            className="text-sm font-semibold leading-5"
          >
            Auto Continue
          </h3>
          <p
            id="native-auto-continue-description"
            className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-white/65"
          >
            Keep working automatically until the task is finished or I need
            something from you. Additional work may use more of your AI
            credits/usage.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby="native-auto-continue-title"
            aria-describedby="native-auto-continue-description"
            aria-busy={busy}
            disabled={unavailable}
            data-testid="toggle-auto-continue"
            onClick={() => onChange(!enabled)}
            className={`relative inline-flex h-7 w-[3.15rem] items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-cyan-300 dark:focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-55 ${
              enabled
                ? "border-cyan-500 bg-cyan-500 dark:border-cyan-300 dark:bg-cyan-300"
                : "border-slate-300 bg-slate-200 dark:border-white/20 dark:bg-white/10"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform dark:bg-slate-950 ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span
            className={`text-[11px] font-semibold tracking-wide ${
              enabled
                ? "text-cyan-700 dark:text-cyan-200"
                : "text-slate-500 dark:text-white/55"
            }`}
            aria-live="polite"
          >
            {busy ? "Saving…" : enabled ? "On" : "Off"}
          </span>
        </div>
      </div>
    </section>
  );
}