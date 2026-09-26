import { useEffect, useState } from "react";

export type PublicCapabilities = {
  registrationEnabled: boolean;
  publicGeneratedAppsEnabled: boolean;
};

const CLOSED_CAPABILITIES: PublicCapabilities = {
  registrationEnabled: false,
  publicGeneratedAppsEnabled: false,
};

export function usePublicCapabilities() {
  const [capabilities, setCapabilities] = useState<PublicCapabilities>(CLOSED_CAPABILITIES);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/capabilities", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json().catch(() => null);
        if (!data || typeof data.registrationEnabled !== "boolean"
          || typeof data.publicGeneratedAppsEnabled !== "boolean") return;
        if (!cancelled) {
          setCapabilities({
            registrationEnabled: data.registrationEnabled,
            publicGeneratedAppsEnabled: data.publicGeneratedAppsEnabled,
          });
        }
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, []);

  return capabilities;
}

export function publicGeneratedAppUrl(slug: unknown, enabled: boolean): string | null {
  if (!enabled || typeof slug !== "string") return null;
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) return null;
  return `https://${normalized}.apps.buildcustom.ai`;
}