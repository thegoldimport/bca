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