import { useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/auth";

export type SavedAgentTurn = {
  id: number;
  mode: "plan" | "build";
  prompt: string;
  response: string;
  changedFiles: Array<{ path: string; change: string; size: number }>;
  activity: Array<{ type: string; label: string; path?: string; status?: string; createdAt: string }>;
  commitHash: string | null;
  createdAt: string;
};

export function readSavedAgentTurns(data: unknown): SavedAgentTurn[] {
  const rows = Array.isArray(data) ? data : (data as { turns?: unknown })?.turns;
  if (!Array.isArray(rows)) throw new Error("Invalid conversation snapshot");
  const byId = new Map<number, SavedAgentTurn>();
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.id) || typeof row.prompt !== "string"
      || typeof row.response !== "string" || !["plan", "build"].includes(row.mode)
      || !Array.isArray(row.changedFiles) || !Array.isArray(row.activity)) {
      throw new Error("Invalid saved turn");
    }
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

/** Read-only transcript observation, deliberately independent of build acceptance. */
export function useSavedNativeConversation(options: {
  projectId: number;
  ownerId: string | undefined;
  enabled: boolean;
  connected: boolean;
  readVersion: () => number;
  onSnapshot: (turns: SavedAgentTurn[], isCurrent: () => boolean, readVersion: number) => Promise<void>;
}) {
  const applyRef = useRef(options.onSnapshot);
  applyRef.current = options.onSnapshot;
  const [error, setError] = useState("");
  const [reloadKey, reload] = useState(0);
  useEffect(() => {
    setError("");
    if (!options.enabled || !options.projectId || !options.ownerId) return;
    let active = true;
    let inFlight = false;
    let refreshQueued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const refresh = async () => {
      if (!active) return;
      if (inFlight) { refreshQueued = true; return; }
      clearTimeout(timer);
      inFlight = true;
      request = new AbortController();
      const applySnapshot = applyRef.current;
      const readVersion = options.readVersion();
      const deadline = setTimeout(() => request?.abort(), 20_000);
      try {
        const response = await fetch(`/api/projects/${options.projectId}/runtime/turns`, {
          method: "GET", credentials: "same-origin", cache: "no-store",
          headers: authHeaders(), signal: request.signal,
        });
        if (!response.ok) throw new Error("Conversation read failed");
        const snapshot = readSavedAgentTurns(await response.json());
        if (active) await applySnapshot(snapshot, () => active, readVersion);
        if (active) setError("");
      } catch {
        if (active) setError("Saved replies could not be refreshed. Previously loaded messages are preserved.");
      } finally {
        clearTimeout(deadline);
        inFlight = false;
        if (active) {
          timer = setTimeout(refresh, refreshQueued ? 0 : 5000);
          refreshQueued = false;
        }
      }
    };
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("online", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      active = false;
      clearTimeout(timer);
      request?.abort();
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("online", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [options.projectId, options.ownerId, options.enabled, options.connected, reloadKey]);
  return { error, retry: () => reload((key) => key + 1) };
}
