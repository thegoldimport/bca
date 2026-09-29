export type AppUser = {
  id: string;
  username: string;
  email: string;
  plan: string;
  role: "super_admin" | "user";
};

export function isAdminUser(user: AppUser | null | undefined): boolean {
  return user?.role === "super_admin";
}

// This is UI state only. /api/auth/me verifies the runtime session after every
// page load; a saved browser value must never establish identity.
let currentUser: AppUser | null = null;
export function getAppUser(): AppUser | null { return currentUser; }

export function setAppUser(user: AppUser) {
  currentUser = user;
}

export function clearAppUser() {
  currentUser = null;
  localStorage.removeItem("bc_app_user");
}

export function authHeaders(): Record<string, string> {
  return {};
}

export async function csrfToken(): Promise<string> {
  const response = await fetch("/api/auth/csrf-token", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Could not start a secure request.");
  const result = await response.json();
  if (typeof result?.token !== "string" || !result.token) throw new Error("Could not start a secure request.");
  return result.token;
}

export async function signOut(): Promise<void> {
  const token = await csrfToken();
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": token },
  });
  if (!response.ok) throw new Error("Could not sign out. Please try again.");
  clearAppUser();
  window.location.href = "/login";
}
