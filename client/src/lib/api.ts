export function getApiBase(): string {
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "";
  }
  if (typeof window !== "undefined" && !window.location.hostname.includes("replit")) {
    return import.meta.env.VITE_API_URL || "";
  }
  return "";
}
