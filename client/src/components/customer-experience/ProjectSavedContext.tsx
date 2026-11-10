import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authHeaders, getAppUser } from "@/lib/auth";
import { useTheme } from "@/contexts/theme-context";
import { isValidPlanningSession, type PlanningSession } from "@shared/build-planning";

type SavedTurn = { prompt: string; response: string };

async function ownerProjectRead(projectId: number, path: string) {
  const response = await fetch(`/api/projects/${projectId}/${path}`, {
    headers: authHeaders(), credentials: "same-origin", cache: "no-store",
  });
  if (!response.ok) throw new Error("Saved project context could not be loaded.");
  return response.json();
}

export function ProjectSavedContext({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme();
  const ownerId = getAppUser()?.id;
  const brief = useQuery<PlanningSession | null>({
    queryKey: ["project-saved-brief", ownerId, projectId],
    enabled: open && Boolean(ownerId),
    queryFn: async () => {
      const data = await ownerProjectRead(projectId, "planning");
      if (data.session === null) return null;
      if (!isValidPlanningSession(data.session)) throw new Error("Saved project brief is invalid.");
      return data.session;
    },
    staleTime: 0, retry: false, gcTime: 0,
  });
  const conversation = useQuery<SavedTurn[]>({
    queryKey: ["project-saved-conversation", ownerId, projectId],
    enabled: open && Boolean(ownerId),
    queryFn: async () => {
      const data = await ownerProjectRead(projectId, "runtime/turns");
      const turns = Array.isArray(data) ? data : data.turns;
      if (!Array.isArray(turns)) throw new Error("Saved conversation is unavailable.");
      return turns.filter((turn: any) => typeof turn?.prompt === "string" && typeof turn?.response === "string")
        .map((turn: SavedTurn) => ({ prompt: turn.prompt, response: turn.response }));
    },
    staleTime: 0, retry: false, gcTime: 0,
  });
  const dark = theme === "dark";
  const muted = dark ? "text-white/55" : "text-gray-600";
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={`rounded-xl border p-4 ${dark ? "border-white/10 bg-white/[0.025] text-white" : "border-gray-200 bg-white text-gray-900"}`}
      data-testid="project-saved-context"
    >
      <summary className="cursor-pointer text-sm font-semibold">Saved project brief and conversation</summary>
      {open && (
        <div className="mt-4 space-y-4 text-sm">
          <section data-testid="project-saved-brief">
            <h3 className="font-semibold">Project brief</h3>
            {brief.isPending ? <p className={muted}>Loading saved brief...</p>
              : brief.isError ? <p role="alert">The saved brief could not be loaded. <button type="button" onClick={() => void brief.refetch()} className="underline">Retry</button></p>
                : !brief.data ? <p className={muted}>No saved brief is available. This does not indicate whether the native conversation is saved.</p>
                  : <div className={`mt-2 space-y-2 whitespace-pre-wrap break-words ${muted}`}>
                    <p>{brief.data.originalPrompt}</p>
                    {brief.data.audience && <p>Target users: {brief.data.audience}</p>}
                    {brief.data.outcomes.length > 0 && <p>Outcomes: {brief.data.outcomes.join(", ")}</p>}
                    {brief.data.planSummary && <p>{brief.data.planSummary}</p>}
                  </div>}
          </section>
          <section data-testid="project-saved-conversation">
            <h3 className="font-semibold">Saved conversation</h3>
            {conversation.isPending ? <p className={muted}>Loading saved conversation...</p>
              : conversation.isError ? <p role="alert">The native conversation could not be loaded. <button type="button" onClick={() => void conversation.refetch()} className="underline">Retry</button></p>
                : !conversation.data?.length ? <p className={muted}>No saved conversation was returned by the runtime.</p>
                  : <div className="mt-2 max-h-[32rem] space-y-4 overflow-y-auto overscroll-contain">
                    {conversation.data.map((turn, index) => (
                      <article key={index} className="space-y-2 whitespace-pre-wrap break-words">
                        <p><strong>You:</strong> {turn.prompt}</p>
                        <p className={muted}><strong>Agent:</strong> {turn.response}</p>
                      </article>
                    ))}
                  </div>}
          </section>
        </div>
      )}
    </details>
  );
}
