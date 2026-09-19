import assert from "node:assert/strict";
import test from "node:test";
import { domainWizardProgress, domainWizardStepAllowsChanges, selectDnsInspectionForHostname } from "../client/src/lib/domain-dns-plan";

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

test("domain wizard resumes at the first unfinished step without repeating completed work", () => {
  const progress = domainWizardProgress({
    dnsScannedAt: "2026-09-19T12:00:00Z",
    cloudflareImportCheckedAt: "2026-09-19T12:05:00Z",
    acknowledgedAt: "2026-09-19T12:10:00Z",
    expectedNameservers: ["one.ns.cloudflare.com", "two.ns.cloudflare.com"],
    nameserversActive: true,
  }, "pending_dns");

  assert.equal(progress.currentIndex, 4);
  assert.equal(progress.completedCount, 4);
  assert.deepEqual(progress.steps.map((step) => step.complete), [true, true, true, true, false]);
});

test("older migrations skip optional import when the customer already completed DNS review", () => {
  const progress = domainWizardProgress({
    dnsScannedAt: "2026-09-19T12:00:00Z",
    acknowledgedAt: "2026-09-19T12:10:00Z",
    expectedNameservers: ["one.ns.cloudflare.com", "two.ns.cloudflare.com"],
  }, "pending_dns");

  assert.equal(progress.steps[1].complete, true);
  assert.equal(progress.currentIndex, 3);
});

test("reviewing from step one is read-only while resume changes only the unfinished step", () => {
  for (let index = 0; index < 5; index += 1) {
    assert.equal(domainWizardStepAllowsChanges("review", index, 3, index < 3), false);
  }
  assert.equal(domainWizardStepAllowsChanges("resume", 2, 3, true), false);
  assert.equal(domainWizardStepAllowsChanges("resume", 3, 3, false), true);
  assert.equal(domainWizardStepAllowsChanges("resume", 4, 3, false), false);
});