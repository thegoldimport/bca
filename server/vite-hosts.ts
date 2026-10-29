const REPLIT_HOST_SUFFIXES = [".replit.dev", ".replit.app"];

function getReplitHostname(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate) return undefined;

  try {
    const url = new URL(
      candidate.includes("://") ? candidate : `https://${candidate}`,
    );
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

    if (
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !REPLIT_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ) {
      return undefined;
    }

    return hostname;
  } catch {
    return undefined;
  }
}

export function getAllowedDevHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configuredDomains = [
    env.REPLIT_DEV_DOMAIN,
    ...(env.REPLIT_DOMAINS ?? "").split(","),
  ];
  const replitHosts = configuredDomains
    .map((domain) => (domain ? getReplitHostname(domain) : undefined))
    .filter((hostname): hostname is string => Boolean(hostname));

  return Array.from(new Set(["localhost", ...replitHosts]));
}
