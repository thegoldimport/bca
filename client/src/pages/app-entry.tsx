import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { AppUser } from "@/lib/auth";

export default function AppEntry() {
  const [, navigate] = useLocation();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to check session");
        return response.json() as Promise<AppUser | null>;
      })
      .then(user => {
        if (active) navigate(user ? "/app" : "/login", { replace: true });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => { active = false; };
  }, [navigate]);

  if (failed) {
    return <main role="alert">Unable to check your session. Please refresh the page.</main>;
  }
  return null;
}