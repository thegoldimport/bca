import assert from "node:assert/strict";
import test from "node:test";
import { actionableDomainDnsRecords, dnsConflictsForRequiredRecords, domainConnectionGuidance, domainWizardProgress, domainWizardStepAllowsChanges, selectDnsInspectionForHostname } from "../client/src/lib/domain-dns-plan";

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

test("connection guidance tells customers whether to act or wait", () => {
  assert.equal(domainConnectionGuidance("pending_dns", 2).kind, "action");
  assert.equal(domainConnectionGuidance("verifying", 0).kind, "waiting");
  assert.equal(domainConnectionGuidance("verifying", 2).kind, "action");
  assert.equal(domainConnectionGuidance("verifying", 2).title, "Add the certificate verification records below");
  assert.equal(domainConnectionGuidance("ssl_provisioning", 0).waitForAutomaticCheck, true);
  assert.equal(domainConnectionGuidance("ssl_provisioning", 1).kind, "action");
  assert.equal(domainConnectionGuidance("connecting", 0).kind, "waiting");
  assert.equal(domainConnectionGuidance("live", 0).kind, "complete");
  assert.equal(domainConnectionGuidance("error", 0).kind, "error");
});

test("verification shows only outstanding certificate records after the CNAME is accepted", () => {
  const records = [
    { name: "example.com", type: "CNAME", value: "fallback.buildcustom.ai" },
    { name: "_acme-challenge.example.com", type: "TXT", value: "certificate-token" },
  ];

  assert.deepEqual(actionableDomainDnsRecords("pending_dns", records), records);
  assert.deepEqual(actionableDomainDnsRecords("verifying", records), [records[1]]);
  assert.deepEqual(actionableDomainDnsRecords("live", records), []);
});

test("final DNS guidance identifies only records that block a required CNAME", () => {
  const conflicts = dnsConflictsForRequiredRecords({
    records: [
      { name: "example.com", type: "A", value: "192.0.2.10", action: "replace" },
      { name: "example.com", type: "MX", value: "10 mail.example.com", action: "keep" },
      { name: "www.example.com", type: "CNAME", value: "old.example.net", action: "replace" },
      { name: "example.com", type: "TXT", value: "v=spf1 -all", action: "keep" },
    ],
  }, [
    { name: "example.com", type: "CNAME", value: "fallback.buildcustom.ai" },
    { name: "_cf-custom-hostname.example.com", type: "TXT", value: "verify-me" },
  ]);

  assert.deepEqual(conflicts, [
    { name: "example.com", type: "A", value: "192.0.2.10", action: "replace" },
  ]);
});

test("older migrations derive final CNAME conflicts directly from saved DNS inventory", () => {
  const conflicts = dnsConflictsForRequiredRecords([
    { name: "example.com", type: "A", value: "192.0.2.10" },
    { name: "example.com", type: "MX", value: "10 mail.example.com" },
    { name: "mail.example.com", type: "A", value: "192.0.2.20" },
  ], [
    { name: "example.com", type: "CNAME", value: "fallback.buildcustom.ai" },
  ]);

  assert.deepEqual(conflicts, [
    { name: "example.com", type: "A", value: "192.0.2.10" },
  ]);
});