export type PlanId = "free" | "launch" | "pro" | "agency" | "admin";

export type PlanEntitlement = {
  id: PlanId;
  name: string;
  price: number;
  liveProjectLimit: number;
  managedCustomDomains: boolean;
};

export const PLAN_ENTITLEMENTS: Record<PlanId, PlanEntitlement> = {
  free: { id: "free", name: "Free", price: 0, liveProjectLimit: 1, managedCustomDomains: false },
  launch: { id: "launch", name: "Launch", price: 9, liveProjectLimit: 5, managedCustomDomains: true },
  pro: { id: "pro", name: "Pro", price: 19, liveProjectLimit: 25, managedCustomDomains: true },
  agency: { id: "agency", name: "Agency", price: 49, liveProjectLimit: 100, managedCustomDomains: true },
  admin: { id: "admin", name: "Admin", price: 0, liveProjectLimit: 10_000, managedCustomDomains: true },
};

export function normalizePlanId(value: string | null | undefined): PlanId {
  const plan = value?.trim().toLowerCase();
  if (plan === "launch") return "launch";
  if (plan === "pro") return "pro";
  if (plan === "agency" || plan === "team" || plan === "enterprise") return "agency";
  if (plan === "admin") return "admin";
  return "free";
}

export function getPlanEntitlement(value: string | null | undefined): PlanEntitlement {
  return PLAN_ENTITLEMENTS[normalizePlanId(value)];
}