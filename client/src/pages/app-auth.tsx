import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import logo from "@/assets/logo.png";
import { setAppUser } from "@/lib/auth";

export default function AppAuth() {
  const [location, navigate] = useLocation();
  const [mode, setMode] = useState<"login" | "signup">(location.includes("signup") ? "signup" : "login");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login"
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Something went wrong"); return; }
      setAppUser(data);
      if (mode === "signup") localStorage.setItem("bc_new_user", "1");
      navigate("/app");
    } catch {
      setError("Network error — please try again");
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
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-white/40 text-sm">
            {mode === "login" ? "Sign in to your BuildCustom.Ai dashboard" : "Start building with AI today"}
          </p>
        </div>

        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8">
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  placeholder="John Smith"
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

            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={e => set("password", e.target.value)}
                  placeholder={mode === "signup" ? "Min 6 characters" : "Your password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
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
            </div>

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
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-white/30 text-sm">
              {mode === "login" ? "Don't have an account?" : "Already have an account?"}
              {" "}
              <button
                onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
                className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
                data-testid="button-switch-mode"
              >
                {mode === "login" ? "Sign up free" : "Sign in"}
              </button>
            </p>
          </div>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          By signing up you agree to our Terms of Service and Privacy Policy
        </p>
      </motion.div>
    </div>
  );
}
