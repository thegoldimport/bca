import assert from "node:assert/strict";
import test from "node:test";
import { selectDnsInspectionForHostname } from "../client/src/lib/domain-dns-plan";

test("a DNS checklist is shown only for the hostname that was inspected", () => {
  const localPlan = { records: [{ name: "first-example.com", action: "replace" }] };
  const savedPlan = { records: [{ name: "saved-example.com", action: "replace" }] };
  const common = {
    inspectedHostname: "first-example.com",
    replacementPlan: localPlan,
    proposedRecords: [{ name: "first-example.com", type: "CNAME" }],
    savedInspectionHostname: "saved-example.com",
    savedReplacementPlan: savedPlan,
    savedProposedRecords: [{ name: "saved-example.com", type: "CNAME" }],
  };

  assert.equal(selectDnsInspectionForHostname({
    ...common,
    currentHostname: "first-example.com",
  }).replacementPlan, localPlan);
  assert.equal(selectDnsInspectionForHostname({
    ...common,
    currentHostname: "saved-example.com",
  }).replacementPlan, savedPlan);
  assert.deepEqual(selectDnsInspectionForHostname({
    ...common,
    currentHostname: "second-example.com",
  }), { replacementPlan: null, proposedRecords: [] });
});