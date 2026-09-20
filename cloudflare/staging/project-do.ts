export type Lease = { operationId: string; expiresAt: number };
const LEASE_MS = 15 * 60 * 1000;

export class ProjectOperationDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    const current = await this.state.storage.get<Lease>("lease");
    if (current && current.expiresAt <= now) await this.state.storage.delete("lease");
    if (request.method === "POST" && url.pathname === "/acquire") {
      const operationId = (await request.json() as { operationId?: string }).operationId;
      if (!operationId) return Response.json({ error: "operationId required" }, { status: 400 });
      const active = await this.state.storage.get<Lease>("lease");
      if (active && active.operationId !== operationId) return Response.json({ error: "PROJECT_BUSY" }, { status: 409 });
      await this.state.storage.put("lease", { operationId, expiresAt: now + LEASE_MS });
      await this.state.storage.setAlarm(now + LEASE_MS);
      return Response.json({ acquired: true, operationId });
    }
    if (request.method === "POST" && url.pathname === "/release") {
      const operationId = (await request.json() as { operationId?: string }).operationId;
      if ((await this.state.storage.get<Lease>("lease"))?.operationId === operationId) await this.state.storage.delete("lease");
      return Response.json({ released: true });
    }
    if (request.method === "GET" && url.pathname === "/lease") return Response.json(current || null);
    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const lease = await this.state.storage.get<Lease>("lease");
    if (!lease || lease.expiresAt <= Date.now()) await this.state.storage.delete("lease");
    else await this.state.storage.setAlarm(lease.expiresAt);
  }
}