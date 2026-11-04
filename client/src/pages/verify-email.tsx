import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import logo from "@/assets/logo.png";
import { csrfToken } from "@/lib/auth";

export default function VerifyEmail() {
  const [token, setToken] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return fragment.get("token") || "";
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    // Keep the one-time token out of the address bar and later navigation.
    window.history.replaceState({}, "", "/verify-email");
  }, []);

  async function confirmEmail() {
    if (!token || loading) return;
    setLoading(true);
    setError("");
    try {
      const csrf = await csrfToken();
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        setError(data.message || "This verification link is invalid or expired. Request a new one.");
        return;
      }
      setToken("");
      setVerified(true);
    } catch {
      setError("We could not verify your email. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060610] px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
      </div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }} className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <img src={logo} alt="BuildCustom.Ai" className="h-10 w-auto mx-auto mb-6" />
          <h1 className="text-2xl font-display font-bold text-white mb-2">
            {verified ? "Email verified" : "Confirm your email"}
          </h1>
          <p className="text-white/40 text-sm">
            {verified
              ? "Your email address is confirmed. Sign in to continue."
              : "Confirm this address to activate your BuildCustom account."}
          </p>
        </div>
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8 space-y-4">
          {verified ? (
            <a href="/login" data-testid="link-sign-in-verified"
              className="block w-full py-3 rounded-xl text-center text-white font-semibold text-sm hover:opacity-90 transition-all"
              style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}>
              Sign in
            </a>
          ) : (
            <>
              <p className="text-xs text-white/40">
                This link is single-use and expires after 15 minutes. It is only used after you select Confirm email.
              </p>
              {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5" role="alert">{error}</p>}
              <button type="button" onClick={confirmEmail} disabled={loading || !token}
                className="w-full py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
                data-testid="button-confirm-email">
                {loading ? "Please wait..." : "Confirm email"}
              </button>
              {!token && <p className="text-red-300 text-sm" role="status">This link is missing or expired. Request a new link from sign in.</p>}
              <a href="/login" className="block text-center text-sm text-cyan-400 hover:text-cyan-300 transition-colors">
                Back to sign in
              </a>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
