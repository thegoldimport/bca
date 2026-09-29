import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import logo from "@/assets/logo.png";
import { csrfToken } from "@/lib/auth";

export default function ResetPassword() {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get("token") || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    // Keep the one-time credential out of the address bar and subsequent navigation.
    window.history.replaceState({}, "", "/reset-password");
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("This reset link is invalid or has expired. Request a new one.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const csrf = await csrfToken();
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ token, newPassword: password, confirmPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || "We could not reset your password. Request a new reset link.");
        return;
      }
      setToken("");
      setPassword("");
      setConfirmPassword("");
      setComplete(true);
    } catch {
      setError("Network error. Please try again.");
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
            {complete ? "Password updated" : "Choose a new password"}
          </h1>
          <p className="text-white/40 text-sm">
            {complete ? "Your password has been reset. You can now sign in." : "Enter and confirm your new password"}
          </p>
        </div>
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8">
          {complete ? (
            <a href="/login" data-testid="link-sign-in-success"
              className="block w-full py-3 rounded-xl text-center text-white font-semibold text-sm hover:opacity-90 transition-all"
              style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}>
              Sign in
            </a>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5" htmlFor="new-password">New password</label>
                <input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password" minLength={6} maxLength={256} required
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm outline-none focus:border-cyan-400/50 transition-colors"
                  data-testid="input-new-password" />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5" htmlFor="confirm-password">Confirm new password</label>
                <input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password" minLength={6} maxLength={256} required
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm outline-none focus:border-cyan-400/50 transition-colors"
                  data-testid="input-confirm-password" />
              </div>
              {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5" role="alert">{error}</p>}
              <button type="submit" disabled={loading || !token}
                className="w-full py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
                data-testid="button-reset-password">
                {loading ? "Please wait..." : "Reset password"}
              </button>
              {!token && <p className="text-red-300 text-sm" role="status">This reset link is invalid or has expired. Request a new one.</p>}
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}