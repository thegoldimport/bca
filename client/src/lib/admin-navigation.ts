export type AdminNavigationIcon =
  | "users"
  | "projects"
  | "analytics"
  | "deployments"
  | "health"
  | "billing"
  | "support";

export type AdminNavigationLink = {
  path: string;
  label: string;
  icon: AdminNavigationIcon;
};

const ADMIN_NAVIGATION: readonly AdminNavigationLink[] = [
  { path: "/app/users", label: "Users", icon: "users" },
  { path: "/app/admin/projects", label: "Projects", icon: "projects" },
  { path: "/app/analytics", label: "Analytics", icon: "analytics" },
  { path: "/app/deployments", label: "Deployments", icon: "deployments" },
  { path: "/app/system-health", label: "System Health", icon: "health" },
  { path: "/app/billing", label: "Billing", icon: "billing" },
  { path: "/app/support", label: "Support", icon: "support" },
];

export function adminNavigationForRole(role: string | null | undefined): readonly AdminNavigationLink[] {
  return role === "super_admin" ? ADMIN_NAVIGATION : [];
}

export function ownerAuthorizationVisible(
  email: string | null | undefined,
  role: string | null | undefined,
): boolean {
  return role === "user" && email?.trim().toLowerCase() === "support@buildcustom.ai";
}
