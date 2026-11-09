export const MAX_NATIVE_ACTIVITY_EVENTS = 500;

export type BuildActivityEvent = {
  id: string;
  label: string;
  observedAt: number;
  status: "active" | "complete" | "error" | "info";
  path?: string;
};

export type NativeActivitySnapshot = {
  events: BuildActivityEvent[];
  startedAt: number | null;
};

const SAFE_BUILD_ERROR_MESSAGES: Record<string, string> = {
  PROVIDER_AUTH_FAILED: "The AI provider rejected the configured credentials. Check your provider settings.",
  PROVIDER_BILLING_FAILED: "The AI provider rejected the request because of account or billing limits. Check your provider account.",
  PROVIDER_RATE_LIMITED: "The AI provider temporarily limited requests. Wait a moment, then retry.",
  PROVIDER_REQUEST_REJECTED: "The AI provider rejected the request. Check the selected model and provider settings.",
  PROVIDER_UNAVAILABLE: "The AI provider is temporarily unavailable. Try again later.",
  PROVIDER_NETWORK_ERROR: "The runtime could not reach the AI provider. Try again later.",
  PROVIDER_CONFIG_FAILED: "The saved AI provider settings could not be applied. No other provider was used.",
  AGENT_TOOL_FAILED: "The coding agent could not complete a workspace action.",
  PREVIEW_BUILD_FAILED: "Project validation or preview generation failed.",
  PREVIEW_UNAVAILABLE: "Your project may be saved, but its live preview could not be opened.",
  BUILD_RUNTIME_FAILED: "The coding agent stopped before completing the request. Review this attempt before retrying.",
};

export function safeBuildErrorMessage(code: unknown): string | null {
  return typeof code === "string" ? SAFE_BUILD_ERROR_MESSAGES[code] || null : null;
}

export function nativeActivityStorageKey(projectId: number): string {
  return `buildcustom:native-activity:${projectId}`;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    && Number.isFinite(new Date(value).getTime());
}

export function readNativeActivitySnapshot(projectId: number): NativeActivitySnapshot {
  try {
    if (typeof window === "undefined" || !Number.isInteger(projectId) || projectId < 1) {
      return { events: [], startedAt: null };
    }
    const raw = window.sessionStorage.getItem(nativeActivityStorageKey(projectId));
    if (!raw) return { events: [], startedAt: null };
    const parsed = JSON.parse(raw);
    const events = Array.isArray(parsed?.events)
      ? parsed.events.filter((event: any) => event
        && typeof event.id === "string"
        && typeof event.label === "string"
        && event.label.length <= 300
        && isValidTimestamp(event.observedAt)
        && ["active", "complete", "error", "info"].includes(event.status)
        && (event.path === undefined || (typeof event.path === "string" && event.path.length <= 500)))
        .slice(-MAX_NATIVE_ACTIVITY_EVENTS) as BuildActivityEvent[]
      : [];
    return {
      events,
      startedAt: isValidTimestamp(parsed?.startedAt) ? parsed.startedAt : null,
    };
  } catch {
    return { events: [], startedAt: null };
  }
}

export function writeNativeActivitySnapshot(projectId: number, snapshot: NativeActivitySnapshot): void {
  try {
    if (typeof window === "undefined" || !Number.isInteger(projectId) || projectId < 1) return;
    window.sessionStorage.setItem(nativeActivityStorageKey(projectId), JSON.stringify({
      events: snapshot.events.slice(-MAX_NATIVE_ACTIVITY_EVENTS),
      startedAt: snapshot.startedAt,
    }));
  } catch {
    // Activity is a convenience; the runtime remains authoritative.
  }
}
