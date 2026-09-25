// Lab-only public gateway for scripts published in the isolated VibeSDK
// Workers for Platforms dispatch namespace. Editor access stays on the lab
// VibeSDK Worker and is not exposed by this gateway.
const HOST_SUFFIX = ".lab-apps.buildcustom.ai";
const VALID_SCRIPT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export default {
  async fetch(request, env) {
    const hostname = new URL(request.url).hostname.toLowerCase();
    if (!hostname.endsWith(HOST_SUFFIX)) {
      return new Response("Not found", { status: 404 });
    }

    const scriptName = hostname.slice(0, -HOST_SUFFIX.length);
    if (!VALID_SCRIPT_NAME.test(scriptName)) {
      return new Response("Not found", { status: 404 });
    }

    return env.DISPATCHER.get(scriptName).fetch(request);
  },
};