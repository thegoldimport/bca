const OWNER_EMAIL = "support@buildcustom.ai";

export function ownerActivationButtonEnabled(
  eligible: boolean,
  confirmation: string,
  pending: boolean,
): boolean {
  return eligible && confirmation.trim().toLowerCase() === OWNER_EMAIL && !pending;
}

export function ownerActivationRequestBody(confirmation: string): { confirmEmail: string } {
  return { confirmEmail: confirmation.trim().toLowerCase() };
}
