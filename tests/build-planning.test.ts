import assert from "node:assert/strict";
import test from "node:test";
import {
  answerPlanningQuestion,
  approveBuildPlan,
  buildPromptFromPlanningSession,
  buildFollowupPromptFromPlanningSession,
  isValidPlanningSession,
  startBuildPlanning,
} from "../shared/build-planning";

test("vague lead-generation requests clarify inline before sending a build request", () => {
  const start = startBuildPlanning("Let's make a SaaS for lead gen", false, 100);
  assert.equal(start.kind, "planning");
  if (start.kind !== "planning") return;
  assert.equal(start.session.currentQuestion?.id, "audience");
  assert.match(start.session.currentQuestion?.prompt || "", /who are we building this for/i);
  assert.ok(start.session.currentQuestion?.options.includes("B2B companies"));
  assert.equal(start.session.messages.at(-1)?.content, start.session.currentQuestion?.prompt);

  const outcomes = answerPlanningQuestion(start.session, "", ["B2B companies"], "answer", 200);
  assert.equal(outcomes.kind, "question");
  if (outcomes.kind !== "question") return;
  assert.equal(outcomes.session.currentQuestion?.id, "outcomes");

  const build = answerPlanningQuestion(outcomes.session, "", [
    "Find potential customers",
    "Manage leads in a CRM",
  ], "answer", 300);
  assert.equal(build.kind, "build");
  if (build.kind !== "build") return;
  assert.equal(build.session.audience, "B2B companies");
  assert.deepEqual(build.session.outcomes, ["Find potential customers", "Manage leads in a CRM"]);
  assert.match(build.buildPrompt, /Target users: B2B companies/);
  assert.match(build.buildPrompt, /Find potential customers, Manage leads in a CRM/);
  assert.equal(build.session.phase, "awaiting_approval");
});

test("You decide and skip use defaults without referring to an external question panel", () => {
  const start = startBuildPlanning("Build a lead generation app", false, 100);
  assert.equal(start.kind, "planning");
  if (start.kind !== "planning") return;
  const decided = answerPlanningQuestion(start.session, "You decide", [], "decide", 200);
  assert.equal(decided.kind, "build");
  if (decided.kind !== "build") return;
  assert.equal(decided.session.currentQuestion, null);
  assert.match(decided.acknowledgement, /sensible defaults/i);
  assert.equal(/question panel/i.test(decided.buildPrompt), false);

  const skippedAudience = answerPlanningQuestion(start.session, "Skip", [], "skip", 300);
  assert.equal(skippedAudience.kind, "question");
  if (skippedAudience.kind !== "question") return;
  assert.equal(skippedAudience.session.currentQuestion?.id, "outcomes");
});

test("plan-first requests wait for explicit approval", () => {
  const start = startBuildPlanning("Plan a team dashboard before building", true, 100);
  assert.equal(start.kind, "planning");
  if (start.kind !== "planning") return;
  assert.equal(start.session.mode, "plan");

  const decided = answerPlanningQuestion(start.session, "You decide", [], "decide", 200);
  assert.equal(decided.kind, "approval");
  if (decided.kind !== "approval") return;
  assert.equal(decided.session.phase, "awaiting_approval");
  const approved = approveBuildPlan(decided.session, 300);
  assert.equal(approved.phase, "awaiting_approval");
  assert.equal(approved.messages.at(-1)?.content, "Approve and build");
  assert.match(buildPromptFromPlanningSession(approved), /Planning conversation:/);
});

test("detailed and atomic requests can start without unnecessary clarification", () => {
  const detailed = startBuildPlanning(
    "Build a customer dashboard for sales teams to manage contacts, track a pipeline, schedule follow-ups, and measure performance.",
    false,
    100,
  );
  assert.equal(detailed.kind, "build");

  const atomic = startBuildPlanning("Build a countdown timer", false, 100);
  assert.equal(atomic.kind, "build");
  if (atomic.kind === "build") assert.equal(atomic.prompt, "Build a countdown timer");
});

test("planning state validation rejects malformed or oversized browser data", () => {
  const start = startBuildPlanning("Build a lead generation app", false, 100);
  assert.equal(start.kind, "planning");
  if (start.kind !== "planning") return;
  assert.equal(isValidPlanningSession(start.session), true);
  assert.equal(isValidPlanningSession({ ...start.session, messages: Array.from({ length: 17 }, () => start.session.messages[0]) }), false);
  assert.equal(isValidPlanningSession({ ...start.session, currentQuestion: { ...start.session.currentQuestion, options: Array.from({ length: 13 }, () => "choice") } }), false);
});

test("follow-up instructions retain the saved brief without replacing it or restarting the original request", () => {
  const started = startBuildPlanning("Build a lead generation app", false, 100);
  assert.equal(started.kind, "planning");
  if (started.kind !== "planning") return;
  const session = { ...started.session, phase: "submitted" as const, audience: "B2B companies", outcomes: ["Manage leads"] };
  const before = structuredClone(session);
  const prompt = buildFollowupPromptFromPlanningSession(session, "Use a Kanban pipeline instead.");
  assert.match(prompt, /Saved project brief \(reference context, not a request to restart/);
  assert.ok(prompt.includes(session.originalPrompt));
  assert.match(prompt, /B2B companies/);
  assert.match(prompt, /Manage leads/);
  assert.match(prompt, /Latest customer instruction \(takes precedence over earlier direction\):\nUse a Kanban pipeline instead\./);
  assert.deepEqual(session, before);
});
