import { useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/auth";

export type SavedAgentTurn = {
  id: number;
  mode: "plan" | "build";
  prompt: string;
  response: string;
  completionSummary?: string;
  changedFiles: Array<{ path: string; change: string; size: number }>;
  activity: Array<{ type: string; label: string; path?: string; status?: string; createdAt: string }>;
  commitHash: string | null;
  createdAt: string;
  status?: "running" | "reply_saved" | "needs_input" | "agent_turn_ended" | "interrupted" | "error" | "stopped" | "checkpoint_verified";
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
    if (row.completionSummary !== undefined
      && (typeof row.completionSummary !== "string" || row.completionSummary.length > 700)) {
      throw new Error("Invalid saved turn summary");
    }
    if (row.status !== undefined && !["running", "reply_saved", "needs_input", "agent_turn_ended", "interrupted", "error", "stopped", "checkpoint_verified"].includes(row.status)) {
      throw new Error("Invalid saved turn status");
    }
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

const savedTurnStatusRank: Record<string, number> = {
  running: 0,
  interrupted: 1,
  reply_saved: 2,
  needs_input: 3,
  agent_turn_ended: 3,
  error: 3,
  stopped: 3,
  checkpoint_verified: 4,
};

/** Merge append-only history snapshots without letting a stale read erase a saved reply or checkpoint. */
export function mergeSavedAgentTurns(
  current: SavedAgentTurn[],
  incoming: SavedAgentTurn[],
): SavedAgentTurn[] {
  const byId = new Map(current.map((turn) => [turn.id, turn]));
  for (const next of incoming) {
    const previous = byId.get(next.id);
    if (!previous) {
      byId.set(next.id, next);
      continue;
    }
    const nextRank = savedTurnStatusRank[next.status || ""] ?? -1;
    const previousRank = savedTurnStatusRank[previous.status || ""] ?? -1;
    const preferred = nextRank >= previousRank ? next : previous;
    const fallback = preferred === next ? previous : next;
    const activity = new Map<string, SavedAgentTurn["activity"][number]>();
    const activityKey = (event: SavedAgentTurn["activity"][number]) =>
      [event.type, event.label, event.path || "", event.status || "", event.createdAt].join("\u0000");
    for (const event of [...previous.activity, ...next.activity, ...preferred.activity]) {
      activity.set(activityKey(event), event);
    }
    const changedFiles = new Map<string, SavedAgentTurn["changedFiles"][number]>();
    for (const file of [...previous.changedFiles, ...next.changedFiles, ...preferred.changedFiles]) {
      const key = typeof file?.path === "string" ? file.path : JSON.stringify(file) || String(file);
      changedFiles.set(key, file);
    }
    byId.set(next.id, {
      ...preferred,
      response: preferred.response.trim() ? preferred.response : fallback.response,
      ...((preferred.completionSummary || fallback.completionSummary)
        ? { completionSummary: preferred.completionSummary || fallback.completionSummary }
        : {}),
      changedFiles: Array.from(changedFiles.values()),
      activity: Array.from(activity.values()),
      commitHash: preferred.commitHash || fallback.commitHash,
      createdAt: previous.createdAt || next.createdAt,
    });
  }
  return Array.from(byId.values()).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id - right.id;
  });
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
