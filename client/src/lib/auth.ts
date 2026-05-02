export type AppUser = {
  id: string;
  username: string;
  email: string;
  plan: string;
};

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
  const user = getAppUser();
  return user ? { "x-user-id": user.id } : {};
}
