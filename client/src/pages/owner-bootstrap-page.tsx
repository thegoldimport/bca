import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { csrfToken } from "@/lib/auth";

const OWNER_EMAIL = "support@buildcustom.ai";

type BootstrapState = {
  candidateEmail: string;
  identitySettingsUrl: string | null;
  accountStatus: string;
  alreadyAdmin: boolean;
  ownerAlreadyInitialized: boolean;
  emailOwnershipVerified: boolean;
  verificationServiceAvailable: boolean;
  eligible: boolean;
};

async function requestOwnerState(): Promise<BootstrapState> {
  const response = await fetch("/api/admin/owner-bootstrap", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "Could not check owner authorization.");
  return body as BootstrapState;
}

export default function OwnerBootstrapPage() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState("");
  const stateQuery = useQuery<BootstrapState, Error>({
    queryKey: ["owner-bootstrap-state"],
    queryFn: requestOwnerState,
    staleTime: 0,
  });
  const bootstrap = useMutation({
    mutationFn: async () => {
      const token = await csrfToken();
      const response = await fetch("/api/admin/owner-bootstrap", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ confirmEmail: confirmation.trim().toLowerCase() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Owner authorization failed.");
      return body;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner-bootstrap-state"] });
      window.location.assign("/app/users");
    },
  });

  const cardClass = theme === "dark"
    ? "border-white/10 bg-white/[0.02] text-white"
    : "border-gray-200 bg-white text-gray-900";
  const subText = theme === "dark" ? "text-white/55" : "text-gray-600";
  const state = stateQuery.data;

  return (
    <div className="mx-auto max-w-3xl p-6 md:p-8">
      <header className="mb-7">
        <h1 className="text-3xl font-display font-bold text-brand-gradient">Owner access</h1>
        <p className={`mt-1 ${subText}`}>One-time authorization for the existing BuildCustom owner account.</p>
      </header>
      <section className={`rounded-2xl border p-6 ${cardClass}`}>
        {stateQuery.isLoading ? (
          <p className={subText}>Checking the signed-in account and ownership proof…</p>
        ) : stateQuery.error ? (
          <p role="alert" className="text-sm text-red-400">{stateQuery.error.message}</p>
        ) : state ? (
          <>
            <div className="flex items-start gap-3">
              {state.emailOwnershipVerified
                ? <CheckCircle2 size={20} className="mt-0.5 text-emerald-400" />
                : <AlertTriangle size={20} className="mt-0.5 text-amber-400" />}
              <div>
                <h2 className="font-semibold">{OWNER_EMAIL}</h2>
                <p className={`mt-1 text-sm ${subText}`}>
                  Product account status: {state.accountStatus}. The email/password signup verification flag is not accepted as ownership proof.
                </p>
                <p className={`mt-3 text-sm ${state.emailOwnershipVerified ? "text-emerald-400" : "text-amber-400"}`}>
                  {state.emailOwnershipVerified
                    ? "A linked identity verified by its provider matches this email."
                    : "A provider-verified identity matching this email is not linked to the account."}
                </p>
                {!state.verificationServiceAvailable && (
                  <p className="mt-2 text-sm text-red-400">The runtime identity service could not be checked.</p>
                )}
              </div>
            </div>

            {state.alreadyAdmin && (
              <p className="mt-5 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-400">
                This account already has owner access.
              </p>
            )}
            {!state.alreadyAdmin && state.ownerAlreadyInitialized && (
              <p className="mt-5 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-400">
                The one-time owner bootstrap is closed because an owner has already been initialized.
              </p>
            )}
            {!state.emailOwnershipVerified && (
              <div className={`mt-5 rounded-xl border p-4 ${
                theme === "dark" ? "border-amber-400/20 bg-amber-400/5" : "border-amber-200 bg-amber-50"
              }`}>
                <p className={`text-sm ${subText}`}>
                  The production email/password signup flag is not proof of mailbox ownership. Use the existing VibeSDK account settings to sign in as this same account and link a Google or GitHub identity that reports this exact email as verified.
                </p>
                {state.identitySettingsUrl && (
                  <a
                    href={state.identitySettingsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex text-sm font-medium text-cyan-400 hover:underline"
                  >
                    Open existing account identity settings
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void stateQuery.refetch()}
                  className={`ml-4 mt-3 text-sm ${theme === "dark" ? "text-white/60 hover:text-white" : "text-gray-600 hover:text-gray-900"}`}
                >
                  Recheck ownership
                </button>
              </div>
            )}
            {state.eligible && (
              <div className="mt-6 border-t border-white/10 pt-5">
                <label htmlFor="owner-email-confirmation" className="mb-2 block text-sm font-medium">
                  Type {OWNER_EMAIL} to authorize the one-time owner bootstrap
                </label>
                <input
                  id="owner-email-confirmation"
                  type="email"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${
                    theme === "dark" ? "border-white/10 bg-black/20 text-white" : "border-gray-200 bg-white"
                  }`}
                />
                {bootstrap.error && <p role="alert" className="mt-3 text-sm text-red-400">{bootstrap.error.message}</p>}
                <button
                  type="button"
                  disabled={confirmation.trim().toLowerCase() !== OWNER_EMAIL || bootstrap.isPending}
                  onClick={() => bootstrap.mutate()}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ShieldCheck size={16} />
                  {bootstrap.isPending ? "Authorizing…" : "Authorize owner access"}
                </button>
                <p className={`mt-3 text-xs ${subText}`}>
                  This changes the existing account’s role. No other account is created or promoted.
                </p>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
