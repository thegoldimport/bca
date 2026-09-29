let attempted = false;

export default {
  async fetch(request, env) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/send-once") {
      return new Response("Not found", { status: 404 });
    }
    if (attempted || Date.now() > Date.parse("2026-09-29T15:37:00Z")) {
      return new Response("Test invocation is no longer available", { status: 410 });
    }
    attempted = true;

    try {
      const result = await env.EMAIL.send({
        from: { email: "security@buildcustom.ai", name: "BuildCustom" },
        to: "thegoldimport@gmail.com",
        subject: "BuildCustom Cloudflare Email Test",
        text: "This is a test of BuildCustom's Cloudflare Email Service configuration."
      });
      return Response.json({ invoked: true, emailSendSucceeded: true, messageId: result.messageId });
    } catch (error) {
      return Response.json({
        invoked: true,
        emailSendSucceeded: false,
        error: error instanceof Error ? error.message : String(error)
      }, { status: 502 });
    }
  }
};