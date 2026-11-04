import { useEffect, useState } from "react";
import { CheckCircle2, MailCheck } from "lucide-react";

export default function OwnerEmailVerificationPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const linkToken = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(linkToken);
    window.history.replaceState(null, "", "/owner-email-verification");
  }, []);

  const confirmEmail = async () => {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/owner-bootstrap/verify-email", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || "Email verification could not be completed.");
      setVerified(result?.verified === true);
      setMessage(result?.message || "Return to BuildCustom to continue.");
      setToken("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Email verification could not be completed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-12 text-white">
      <section className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300">
          {verified ? <CheckCircle2 size={24} /> : <MailCheck size={24} />}
        </div>
        <h1 className="text-2xl font-semibold">Verify BuildCustom owner email</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          Confirm that you can access the support@buildcustom.ai mailbox. This link is single-use and expires after 15 minutes.
          Opening this page alone does not consume the link.
        </p>
        {message && (
          <p role="status" className={`mt-5 rounded-xl p-4 text-sm ${
            verified ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-200"
          }`}>
            {message}
          </p>
        )}
        {!message && (
          <button
            type="button"
            disabled={!token || pending}
            onClick={() => void confirmEmail()}
            className="mt-6 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Confirming…" : "Confirm email ownership"}
          </button>
        )}
        {message && (
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/login" className="inline-flex rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white">
              Sign in
            </a>
            <a href="/app/owner-authorization" className="inline-flex rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white">
              Return to Owner access
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
