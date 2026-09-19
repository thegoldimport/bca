export function selectDnsInspectionForHostname(options: {
  currentHostname: string;
  inspectedHostname: string;
  replacementPlan: unknown;
  proposedRecords: unknown[];
  savedInspectionHostname: string;
  savedReplacementPlan: unknown;
  savedProposedRecords: unknown[];
}) {
  if (options.inspectedHostname === options.currentHostname) {
    return {
      replacementPlan: options.replacementPlan,
      proposedRecords: options.proposedRecords,
    };
  }
  if (options.savedInspectionHostname === options.currentHostname) {
    return {
      replacementPlan: options.savedReplacementPlan,
      proposedRecords: options.savedProposedRecords,
    };
  }
  return { replacementPlan: null, proposedRecords: [] };
}

export type DomainWizardStep = {
  id: "scan" | "import" | "review" | "nameservers" | "connect";
  title: string;
  plainTitle: string;
  complete: boolean;
};

export function domainWizardProgress(migration: any, domainStatus?: string | null) {
  const nameserversSaved = Array.isArray(migration?.expectedNameservers) && migration.expectedNameservers.length === 2;
  const reviewComplete = Boolean(migration?.acknowledgedAt);
  const steps: DomainWizardStep[] = [
    { id: "scan", title: "Back up current DNS", plainTitle: "See what is working now", complete: Boolean(migration?.dnsScannedAt) },
    {
      id: "import",
      title: "Check Cloudflare import",
      plainTitle: "Make sure Cloudflare copied everything",
      complete: Boolean(migration?.cloudflareImportCheckedAt || reviewComplete || nameserversSaved),
    },
    { id: "review", title: "Review changes", plainTitle: "See what to keep and replace", complete: reviewComplete },
    { id: "nameservers", title: "Verify nameservers", plainTitle: "Confirm the domain points to Cloudflare", complete: migration?.nameserversActive === true },
    { id: "connect", title: "Connect website", plainTitle: "Finish connecting your website", complete: domainStatus === "live" },
  ];
  const firstIncomplete = steps.findIndex((step) => !step.complete);
  return {
    steps,
    currentIndex: firstIncomplete === -1 ? steps.length - 1 : firstIncomplete,
    completedCount: steps.filter((step) => step.complete).length,
  };
}

export function domainWizardStepAllowsChanges(
  mode: "resume" | "review",
  stepIndex: number,
  currentIndex: number,
  stepComplete: boolean,
) {
  return mode === "resume" && stepIndex === currentIndex && !stepComplete;
}

export function domainConnectionGuidance(status: string | null | undefined, dnsRecordCount: number) {
  if (status === "live") {
    return { kind: "complete" as const, title: "Your website is connected", waitForAutomaticCheck: false };
  }
  if (status === "error") {
    return { kind: "error" as const, title: "The connection needs attention", waitForAutomaticCheck: false };
  }
  if (dnsRecordCount > 0) {
    return {
      kind: "action" as const,
      title: status === "pending_dns"
        ? "Add the records below in Cloudflare"
        : "Add the certificate verification records below",
      waitForAutomaticCheck: false,
    };
  }
  return { kind: "waiting" as const, title: "Sit tight while we finish checking", waitForAutomaticCheck: true };
}

export function actionableDomainDnsRecords(status: string | null | undefined, records: any[]) {
  const available = Array.isArray(records) ? records : [];
  if (status === "live" || status === "error") return [];
  if (status === "pending_dns") return available;
  return available.filter((record) => String(record?.type || "").toUpperCase() === "TXT");
}

export function dnsConflictsForRequiredRecords(replacementPlan: any, requiredRecords: any[]) {
  const requiredCnames = new Map(
    (Array.isArray(requiredRecords) ? requiredRecords : [])
      .filter((record) => String(record?.type || "").toUpperCase() === "CNAME")
      .map((record) => [
        String(record?.name || "").toLowerCase().replace(/\.$/, ""),
        String(record?.value || "").toLowerCase().replace(/\.$/, ""),
      ]),
  );
  const replacementRecords = Array.isArray(replacementPlan)
    ? replacementPlan
    : Array.isArray(replacementPlan?.records)
      ? replacementPlan.records
      : [];

  return replacementRecords.filter((record: any) => {
    const name = String(record?.name || "").toLowerCase().replace(/\.$/, "");
    const type = String(record?.type || "").toUpperCase();
    const value = String(record?.value || "").toLowerCase().replace(/\.$/, "");
    const requiredTarget = requiredCnames.get(name);
    return (record?.action === undefined || record?.action === "replace")
      && requiredTarget !== undefined
      && ["A", "AAAA", "CNAME"].includes(type)
      && !(type === "CNAME" && value === requiredTarget);
  });
}