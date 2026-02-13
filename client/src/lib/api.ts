const REPLIT_API_URL = "https://ai-build-studio.replit.app";

export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname.includes("replit")) {
    return "";
  }
  return REPLIT_API_URL;
}
