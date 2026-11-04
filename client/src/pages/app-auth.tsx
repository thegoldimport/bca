import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import logo from "@/assets/logo.png";
import { csrfToken, setAppUser } from "@/lib/auth";
import { usePublicCapabilities } from "@/hooks/use-public-capabilities";

export default function AppAuth() {
  const [location, navigate] = useLocation();
  const { registrationEnabled } = usePublicCapabilities();
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "pending">(
    location.includes("forgot-password") ? "forgot" : location.includes("signup") && registrationEnabled ? "signup" : "login",
  );
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgotNotice, setForgotNotice] = useState("");
  const [verificationNotice, setVerificationNotice] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });

  useEffect(() => {
    if (location.includes("forgot-password")) setMode("forgot");
    else if (location.includes("signup") && registrationEnabled) setMode("signup");
    else setMode("login");
  }, [location, registrationEnabled]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "signup" && form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (mode === "signup" && (
      form.password.length < 8
      || !/[a-z]/.test(form.password)
      || !/[A-Z]/.test(form.password)
      || !/[0-9]/.test(form.password)
    )) {
      setError("Use at least 8 characters with upper- and lowercase letters and a number.");
      return;
    }
    if (mode === "signup" && !registrationEnabled) {
      setMode("login");
      setError("New account registration is currently closed. Sign in with an existing account.");
      return;
    }
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login"
        : mode === "forgot" ? "/api/auth/forgot-password"
          : mode === "pending" ? "/api/auth/request-verification" : "/api/auth/register";
      const body = mode === "login"
        ? { email: form.email, password: form.password }
        : mode === "forgot" ? { email: form.email }
          : mode === "pending" ? { email: form.email }
          : { name: form.name, email: form.email, password: form.password };
      const token = await csrfToken();
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const errorCode = data.code ?? data.error?.type;
      if (!res.ok) {
        if (mode === "login" && errorCode === "EMAIL_VERIFICATION_REQUIRED") {
          setVerificationNotice("This account needs email verification before sign-in. Request a fresh link below.");
          setMode("pending");
          return;
        }
        if (mode === "signup" && errorCode === "VERIFICATION_EMAIL_UNAVAILABLE") {
          setVerificationNotice(data.message || "Your account was created, but we could not send the verification link. Request a new link below.");
          setMode("pending");
          return;
        }
        setError(data.message || data.error?.message || "Something went wrong");
        return;
      }
      if (mode === "forgot") {
        setForgotNotice(data.message || "If an account exists for that email, password reset instructions will be sent.");
        return;
      }
      if (mode === "pending") {
        setVerificationNotice(data.message || "If an unverified account exists, verification instructions will be sent.");
        return;
      }
      if (mode === "signup") {
        if (data.verificationRequired !== true) {
          setError("Email verification could not be started. Please try again.");
          return;
        }
        setVerificationNotice(data.message || "Check your inbox for a link to verify your email before signing in.");
        setMode("pending");
        return;
      }
      setAppUser(data);
      navigate("/app");
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

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <img src={logo} alt="BuildCustom.Ai" className="h-10 w-auto mx-auto mb-6" />
          <h1 className="text-2xl font-display font-bold text-white mb-2">
            {mode === "login" ? "Welcome back"
              : mode === "forgot" ? "Reset your password"
                : mode === "pending" ? "Verify your email" : "Create your account"}
          </h1>
          <p className="text-white/40 text-sm">
            {mode === "login"
              ? "Sign in to your BuildCustom.Ai dashboard"
              : mode === "forgot" ? "Enter your email and we’ll send reset instructions"
                : mode === "pending" ? "Confirm your email address before signing in"
                : "Start building with AI today"}
          </p>
          {location.includes("signup") && !registrationEnabled && (
            <p className="mt-3 text-sm text-amber-300" role="status" data-testid="registration-closed-notice">
              New account registration is currently closed. Existing users can sign in below.
            </p>
          )}
        </div>

        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8">
          {forgotNotice ? (
            <div className="space-y-5">
              <p className="text-sm text-emerald-300" role="status" data-testid="forgot-password-success">{forgotNotice}</p>
              <button type="button" onClick={() => { setMode("login"); setForgotNotice(""); navigate("/login"); }}
                className="w-full py-3 rounded-xl text-white font-semibold text-sm bg-white/10 hover:bg-white/15 transition-colors"
                data-testid="button-back-to-signin">Back to sign in</button>
            </div>
          ) : mode === "pending" ? <form onSubmit={submit} className="space-y-4">
            {verificationNotice && (
              <p className="text-sm text-cyan-200 bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-4 py-3"
                role="status" data-testid="email-verification-notice">{verificationNotice}</p>
            )}
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5" htmlFor="verification-email">Email</label>
              <input id="verification-email" type="email" value={form.email} onChange={e => set("email", e.target.value)}
                placeholder="you@example.com" autoComplete="email" required
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm outline-none focus:border-cyan-400/50 transition-colors"
                data-testid="input-verification-email" />
            </div>
            {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5" role="alert">{error}</p>}
            <button type="submit" disabled={loading || !form.email}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm bg-white/10 hover:bg-white/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-resend-verification">
              {loading ? "Please wait..." : "Resend verification link"}
            </button>
            <button type="button" onClick={() => {
              setMode("login"); setError(""); setVerificationNotice(""); navigate("/login");
            }} className="w-full text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
              data-testid="button-back-to-signin">Back to sign in</button>
          </form> : <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  placeholder="John Smith"
                  minLength={2}
                  maxLength={100}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm outline-none focus:border-cyan-400/50 transition-colors"
                  data-testid="input-name"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set("email", e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm outline-none focus:border-cyan-400/50 transition-colors"
                data-testid="input-email"
              />
            </div>

            {mode !== "forgot" && <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={e => set("password", e.target.value)}
                  placeholder={mode === "signup" ? "Choose a strong password" : "Your password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 8 : undefined}
                  maxLength={mode === "signup" ? 128 : undefined}
                  required
                  className="w-full px-4 py-3 pr-11 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm outline-none focus:border-cyan-400/50 transition-colors"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  data-testid="button-toggle-password"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {mode === "signup" && <>
                <p className="mt-2 text-xs text-white/35">
                  Use at least 8 characters with uppercase and lowercase letters and a number. 12+ characters is stronger.
                </p>
                <label className="block text-xs font-medium text-white/50 mt-3 mb-1.5" htmlFor="confirm-password">Confirm password</label>
                <input id="confirm-password" type="password" value={form.confirmPassword}
                  onChange={e => set("confirmPassword", e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm outline-none focus:border-cyan-400/50 transition-colors"
                  data-testid="input-confirm-password" />
              </>}
            </div>}

            {error && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              style={{ background: "linear-gradient(90deg, #00c9b7 0%, #6366f1 50%, #ec4899 100%)" }}
              data-testid="button-submit"
            >
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : mode === "forgot" ? "Send reset instructions" : "Create Account"}
            </button>
            {mode === "login" && (
              <button type="button" onClick={() => { setMode("forgot"); setError(""); setForgotNotice(""); navigate("/forgot-password"); }}
                className="w-full text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                data-testid="link-forgot-password">Forgot password?</button>
            )}
          </form>}

          {(mode === "login" || mode === "signup") && registrationEnabled && <div className="mt-6 text-center">
            <p className="text-white/30 text-sm">
              {mode === "login" ? "Don't have an account?" : "Already have an account?"}
              {" "}
              <button
                onClick={() => {
                  const nextMode = mode === "login" ? "signup" : "login";
                  setMode(nextMode);
                  setError("");
                  navigate(nextMode === "signup" ? "/signup" : "/login");
                }}
                className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
                data-testid="button-switch-mode"
              >
                {mode === "login" ? "Sign up free" : "Sign in"}
              </button>
            </p>
          </div>}
        </div>

        {(mode === "login" || mode === "signup") && registrationEnabled && <p className="text-center text-white/20 text-xs mt-6">
          By signing up you agree to our Terms of Service and Privacy Policy
        </p>}
      </motion.div>
    </div>
  );
}
