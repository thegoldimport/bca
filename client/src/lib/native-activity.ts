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
