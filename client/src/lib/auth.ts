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

export function getAppUser(): AppUser | null {
  try {
    const raw = localStorage.getItem("bc_app_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAppUser(user: AppUser) {
  localStorage.setItem("bc_app_user", JSON.stringify(user));
}

export function clearAppUser() {
  localStorage.removeItem("bc_app_user");
}

export function authHeaders(): Record<string, string> {
  return {};
}
