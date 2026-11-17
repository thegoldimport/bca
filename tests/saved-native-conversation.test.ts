import assert from "node:assert/strict";
import test from "node:test";
import { mergeSavedAgentTurns, readSavedAgentTurns } from "../client/src/hooks/use-saved-native-conversation";

const turn = {
  id: 1, mode: "build", prompt: "Offline owner request",
  response: "**Exact saved response.**\nWhich columns?\nReply in chat.",
  changedFiles: [], activity: [], commitHash: null, createdAt: "2026-11-10T17:00:00Z",
};

test("saved conversation accepts both authorized API snapshot envelopes without rewriting native text", () => {
  assert.deepEqual(readSavedAgentTurns({ turns: [turn] }), [turn]);
  assert.equal(readSavedAgentTurns([turn])[0].response, turn.response);
});

test("replayed saved IDs render once, retaining the latest record for that ID", () => {
  const final = { ...turn, response: `${turn.response}\nFinal persisted question?` };
  assert.deepEqual(readSavedAgentTurns({ turns: [turn, final] }), [final]);
});

test("separate turns with identical text retain their separate stable identities", () => {
  assert.deepEqual(readSavedAgentTurns([turn, { ...turn, id: 2 }]), [turn, { ...turn, id: 2 }]);
});

test("saved native turn status accepts observed states but rejects fabricated status values", () => {
  assert.equal(readSavedAgentTurns([{ ...turn, status: "checkpoint_verified" }])[0].status, "checkpoint_verified");
  assert.equal(readSavedAgentTurns([{ ...turn, response: "", status: "needs_input" }])[0].status, "needs_input");
  assert.throws(() => readSavedAgentTurns([{ ...turn, status: "application_complete" }]));
});

test("a stale history snapshot cannot erase a saved reply or Development checkpoint", () => {
  const saved = {
    ...turn,
    response: "Saved assistant reply",
    changedFiles: [{ path: "src/app.tsx", change: "modified", size: 42 }],
    activity: [{ type: "tool", label: "Edited src/app.tsx", path: "src/app.tsx", status: "success", createdAt: turn.createdAt }],
    commitHash: "verified-commit",
    status: "checkpoint_verified" as const,
  };
  const stale = {
    ...turn,
    response: "",
    changedFiles: [],
    activity: [],
    commitHash: null,
    status: "running" as const,
  };

  assert.deepEqual(mergeSavedAgentTurns([saved], [stale]), [saved]);
  assert.deepEqual(mergeSavedAgentTurns([saved], []), [saved]);
});

test("a later saved reply fills an empty turn without dropping terminal status or activity", () => {
  const endedWithoutReply = {
    ...turn,
    response: "",
    activity: [{ type: "status", label: "Agent turn ended", createdAt: turn.createdAt }],
    status: "agent_turn_ended" as const,
  };
  const savedReply = {
    ...endedWithoutReply,
    response: "The saved reply",
    activity: [{ type: "status", label: "Reply saved", createdAt: turn.createdAt }],
    status: "reply_saved" as const,
  };
  const merged = mergeSavedAgentTurns([endedWithoutReply], [savedReply])[0];
  assert.equal(merged.response, "The saved reply");
  assert.equal(merged.status, "agent_turn_ended");
  assert.deepEqual(merged.activity.map((event) => event.label), ["Agent turn ended", "Reply saved"]);
});

test("invalid saved history fails explicitly rather than clearing a previously loaded conversation", () => {
  for (const invalid of [{}, { turns: {} }, { turns: null }, [{ ...turn, response: null }],
    [{ ...turn, id: "secret-looking-invalid-id" }], [{ ...turn, mode: "unknown" }]]) {
    assert.throws(() => readSavedAgentTurns(invalid));
  }
  assert.deepEqual(readSavedAgentTurns({ turns: [] }), []);
});
