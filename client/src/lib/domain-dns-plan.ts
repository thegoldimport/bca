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