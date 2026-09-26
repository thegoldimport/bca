const PUBLIC_ORIGIN = "https://app.buildcustom.ai";
const CANARY_ORIGIN = "https://buildcustom-control-plane-launch.thegoldimport.workers.dev";

export type ControlOriginEnv = {
  CONTROL_PLANE_PROFILE?: string;
  CONTROL_PLANE_ALLOWED_ORIGIN?: string;
  CONTROL_PLANE_CANARY_ORIGIN?: string;
  STAGING_ALLOWED_ORIGIN?: string;
};

export function configuredControlOrigin(env: ControlOriginEnv): string {
  return env.CONTROL_PLANE_ALLOWED_ORIGIN || env.STAGING_ALLOWED_ORIGIN || "";
}

/** The canary exception applies only to requests actually addressed to that host. */
export function controlOriginForRequest(env: ControlOriginEnv, request: Request): string {
  const canonical = configuredControlOrigin(env);
  if (env.CONTROL_PLANE_PROFILE === "launch"
    && env.CONTROL_PLANE_CANARY_ORIGIN === CANARY_ORIGIN
    && new URL(request.url).origin === CANARY_ORIGIN) return CANARY_ORIGIN;
  return canonical;
}

export function assertLaunchOriginConfiguration(env: ControlOriginEnv): void {
  if (env.CONTROL_PLANE_ALLOWED_ORIGIN !== PUBLIC_ORIGIN
    || env.STAGING_ALLOWED_ORIGIN !== PUBLIC_ORIGIN
    || (env.CONTROL_PLANE_CANARY_ORIGIN !== undefined && env.CONTROL_PLANE_CANARY_ORIGIN !== CANARY_ORIGIN)) {
    throw new Error("LAUNCH_ORIGIN_CONFIGURATION_REQUIRED");
  }
}