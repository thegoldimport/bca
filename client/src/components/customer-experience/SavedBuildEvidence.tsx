import { useQuery } from "@tanstack/react-query";
import { authHeaders, getAppUser } from "@/lib/auth";

/** Persisted stage facts are not a terminal lifecycle or a verified preview. */
export function SavedBuildEvidence({ projectId, observing }: { projectId: number; observing: boolean }) {
  const ownerId = getAppUser()?.id;
  const query = useQuery({
    queryKey: ["saved-build-evidence", ownerId, projectId, observing],
    enabled: Boolean(ownerId && projectId),
    gcTime: 0,
    retry: false,
    refetchInterval: observing ? 5000 : false,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/build-activity`, {
        credentials: "same-origin", cache: "no-store", headers: authHeaders(),
      });
      if (!response.ok) throw new Error("Saved build stages unavailable");
      const data = await response.json();
      if (!Array.isArray(data?.attempts)) throw new Error("Invalid stage snapshot");
      return data.attempts;
    },
  });
  if (query.isError) return <p role="status" className="text-xs text-amber-500">Saved build stages could not be loaded. The conversation is tracked separately.</p>;
  const attempt = query.data?.reduce((latest: any, row: any) =>
    Number(row.startedAt) > Number(latest?.startedAt || 0) ? row : latest, null);
  if (!attempt || !Array.isArray(attempt.events)) return null;
  const completed = (type: string) => attempt.events.filter((event: any) =>
    event.eventType === type && event.status === "complete").length;
  const fileEvents = completed("file_changed");
  const validation = completed("validation_completed") > 0;
  const preview = completed("preview_generated") > 0;
  return <section data-testid="saved-build-evidence" className="rounded-xl border border-amber-400/25 p-3 text-xs">
    <p className="font-semibold">Latest saved attempt · {new Date(attempt.startedAt).toLocaleString()}</p>
    <ul className="mt-2 space-y-1">
      {fileEvents > 0 && <li>{fileEvents} file-change events recorded</li>}
      {validation && <li>Build validation completed</li>}
      {preview && <li>Preview generation recorded</li>}
      {attempt.status === "completed" && <li>Agent turn ended</li>}
    </ul>
    <p className="mt-2">These stages do not establish that application completion or a working preview was verified.</p>
  </section>;
}
