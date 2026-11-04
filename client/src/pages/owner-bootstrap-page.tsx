import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { csrfToken } from "@/lib/auth";

const OWNER_EMAIL = "support@buildcustom.ai";

type BootstrapState = {
  candidateEmail: string;
  accountStatus: string;
  alreadyAdmin: boolean;
  ownerAlreadyInitialized: boolean;
  emailOwnershipVerified: boolean;
  verificationServiceAvailable: boolean;
  ownerSecretConfigured: boolean;
  eligible: boolean;
  verifiedAt: number | null;
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

async function postProtected(path: string, body: Record<string, unknown>) {
  const token = await csrfToken();
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || "Owner authorization failed.");
  return result;
}

export default function OwnerBootstrapPage() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState("");
  const [ownerSecret, setOwnerSecret] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const stateQuery = useQuery<BootstrapState, Error>({
    queryKey: ["owner-bootstrap-state"],
    queryFn: requestOwnerState,
    staleTime: 0,
  });
  const sendVerification = useMutation({
    mutationFn: () => postProtected("/api/admin/owner-bootstrap/request-email", {}),
    onSuccess: (result) => setRequestMessage(result.message),
  });
  const bootstrap = useMutation({
    mutationFn: () => postProtected("/api/admin/owner-bootstrap", {
      confirmEmail: confirmation.trim().toLowerCase(),
      ownerSecret,
    }),
    onSuccess: async () => {
      setOwnerSecret("");
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
          <p className={subText}>Checking the signed-in account and email verification status…</p>
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
                  Account status: {state.accountStatus}. The signup verification flag is not accepted as proof.
                </p>
                <p className={`mt-3 text-sm ${state.emailOwnershipVerified ? "text-emerald-400" : "text-amber-400"}`}>
                  {state.emailOwnershipVerified
                    ? "A fresh email link verified this mailbox."
                    : "A fresh email verification is required."}
                </p>
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

            {!state.emailOwnershipVerified && !state.ownerAlreadyInitialized && (
              <div className={`mt-5 rounded-xl border p-4 ${
                theme === "dark" ? "border-cyan-400/20 bg-cyan-400/5" : "border-cyan-200 bg-cyan-50"
              }`}>
                <p className={`text-sm ${subText}`}>
                  Request a one-time link to {OWNER_EMAIL}. The link expires after 15 minutes, can be used once,
                  and is bound to this existing account.
                </p>
                {!state.verificationServiceAvailable ? (
                  <p className="mt-3 text-sm text-red-400">Cloudflare email delivery is not configured for this release.</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setRequestMessage(""); sendVerification.mutate(); }}
                    disabled={sendVerification.isPending || state.accountStatus !== "active"}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    <Mail size={16} />
                    {sendVerification.isPending ? "Requesting link…" : "Send verification link"}
                  </button>
                )}
                {requestMessage && <p role="status" className="mt-3 text-sm text-emerald-400">{requestMessage}</p>}
                {sendVerification.error && <p role="alert" className="mt-3 text-sm text-red-400">{sendVerification.error.message}</p>}
              </div>
            )}

            {state.emailOwnershipVerified && !state.ownerAlreadyInitialized && (
              <div className={`mt-6 border-t border-white/10 pt-5 ${!state.ownerSecretConfigured ? "opacity-80" : ""}`}>
                {!state.ownerSecretConfigured && (
                  <p className="mb-4 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-400">
                    The operator must first provision the one-time authorization secret as a Cloudflare Worker secret.
                    It is never displayed or stored in this page.
                  </p>
                )}
                <label htmlFor="owner-email-confirmation" className="mb-2 block text-sm font-medium">
                  Type {OWNER_EMAIL} to confirm the promotion
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
                <label htmlFor="owner-bootstrap-secret" className="mb-2 mt-4 block text-sm font-medium">
                  One-time owner authorization secret
                </label>
                <input
                  id="owner-bootstrap-secret"
                  type="password"
                  autoComplete="off"
                  value={ownerSecret}
                  onChange={(event) => setOwnerSecret(event.target.value)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${
                    theme === "dark" ? "border-white/10 bg-black/20 text-white" : "border-gray-200 bg-white"
                  }`}
                />
                {bootstrap.error && <p role="alert" className="mt-3 text-sm text-red-400">{bootstrap.error.message}</p>}
                <button
                  type="button"
                  disabled={!state.ownerSecretConfigured
                    || confirmation.trim().toLowerCase() !== OWNER_EMAIL
                    || ownerSecret.length < 32
                    || bootstrap.isPending}
                  onClick={() => bootstrap.mutate()}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ShieldCheck size={16} />
                  {bootstrap.isPending ? "Authorizing…" : "Authorize owner access"}
                </button>
                <p className={`mt-3 text-xs ${subText}`}>
                  This promotes only the existing account after fresh email proof, exact confirmation, and the operator secret.
                </p>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
