import { assertOrigin, hasValidCsrfToken, type SessionUser } from "./staging/auth";
import { resolveRuntimeProductUser } from "./staging/runtime-identity";

type SupportEnv = Parameters<typeof resolveRuntimeProductUser>[0] & {
  DB: D1Database;
  CONTROL_PLANE_ALLOWED_ORIGIN?: string;
};

const CATEGORIES = ["account", "billing", "builder", "hosting", "bug", "general"] as const;
const STATUSES = ["open", "waiting_for_support", "waiting_for_customer", "resolved"] as const;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function validTicketId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function secureMutation(request: Request, allowedOrigin?: string): Response | null {
  if (!hasValidCsrfToken(request)) return json({ message: "A secure request is required." }, 403);
  try {
    assertOrigin(request, allowedOrigin || "https://app.buildcustom.ai");
  } catch {
    return json({ message: "A secure request is required." }, 403);
  }
  return null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function customerTicket(env: SupportEnv, userId: string, ticketId: string) {
  return env.DB.prepare(
    `SELECT t.id,t.category,t.subject,t.status,t.project_id,p.name AS project_name,
            t.created_at,t.updated_at,t.last_message_at
       FROM support_tickets t
       LEFT JOIN projects p ON p.id=t.project_id AND p.user_id=t.customer_user_id
      WHERE t.id=? AND t.customer_user_id=?`,
  ).bind(ticketId, userId).first<any>();
}

async function customerMessages(env: SupportEnv, ticketId: string) {
  const result = await env.DB.prepare(
    `SELECT m.id,m.sender_type,m.body,m.created_at
       FROM support_ticket_messages m
      WHERE m.ticket_id=?
      ORDER BY m.created_at ASC,m.rowid ASC`,
  ).bind(ticketId).all<any>();
  return result.results.map((row) => ({
    id: row.id,
    sender: row.sender_type === "support" ? "BuildCustom Support" : "You",
    senderType: row.sender_type,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export async function handleCustomerSupportTicketRoute(args: {
  env: SupportEnv;
  request: Request;
  url: URL;
  input: Record<string, unknown>;
  allowedOrigin?: string;
}): Promise<Response | null> {
  const { env, request, url, input, allowedOrigin } = args;
  if (!url.pathname.startsWith("/api/support/tickets")) return null;
  const user = await resolveRuntimeProductUser(env, request);
  if (!user) return json({ message: "Unauthorized" }, 401);
  if (user.account_status === "suspended") return json({ message: "Account access is suspended." }, 403);
  if (user.role !== "user") return json({ message: "Customer support is not available for this account." }, 403);

  if (url.pathname === "/api/support/tickets" && request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT t.id,t.category,t.subject,t.status,t.project_id,p.name AS project_name,
              t.created_at,t.updated_at,t.last_message_at
         FROM support_tickets t
         LEFT JOIN projects p ON p.id=t.project_id AND p.user_id=t.customer_user_id
        WHERE t.customer_user_id=?
        ORDER BY t.updated_at DESC LIMIT 100`,
    ).bind(user.id).all<any>();
    return json({ tickets: result.results });
  }

  if (url.pathname === "/api/support/tickets" && request.method === "POST") {
    const rejected = secureMutation(request, allowedOrigin || env.CONTROL_PLANE_ALLOWED_ORIGIN);
    if (rejected) return rejected;
    const category = input.category;
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!CATEGORIES.includes(category as typeof CATEGORIES[number])) {
      return json({ message: "Choose a valid support category." }, 400);
    }
    if (subject.length < 4 || subject.length > 120) {
      return json({ message: "Subject must be between 4 and 120 characters." }, 400);
    }
    if (!body || body.length > 8000) return json({ message: "Message must be between 1 and 8,000 characters." }, 400);

    let projectId: number | null = null;
    if (input.projectId !== undefined && input.projectId !== null && input.projectId !== "") {
      const value = Number(input.projectId);
      if (!Number.isSafeInteger(value) || value < 1) return json({ message: "Choose a valid project." }, 400);
      const project = await env.DB.prepare("SELECT id FROM projects WHERE id=? AND user_id=?")
        .bind(value, user.id).first();
      if (!project) return json({ message: "Project not found." }, 404);
      projectId = value;
    }

    const ticketId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO support_tickets(id,customer_user_id,project_id,category,subject,status) VALUES(?,?,?,?,?,'open')",
      ).bind(ticketId, user.id, projectId, category, subject),
      env.DB.prepare(
        "INSERT INTO support_ticket_messages(id,ticket_id,sender_user_id,sender_type,body) VALUES(?,?,?,'customer',?)",
      ).bind(messageId, ticketId, user.id, body),
      env.DB.prepare(
        "INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json) VALUES(?,?,?,?)",
      ).bind(user.id, "support_ticket_created", projectId, JSON.stringify({ ticketId, category })),
    ]);
    const ticket = await customerTicket(env, user.id, ticketId);
    return ticket ? json({ ticket, messages: await customerMessages(env, ticketId) }, 201)
      : json({ message: "Could not load the new support ticket." }, 500);
  }

  const detailMatch = url.pathname.match(/^\/api\/support\/tickets\/([^/]+)$/);
  if (detailMatch && request.method === "GET") {
    const ticketId = decodeURIComponent(detailMatch[1]);
    if (!validTicketId(ticketId)) return json({ message: "Ticket not found." }, 404);
    const ticket = await customerTicket(env, user.id, ticketId);
    if (!ticket) return json({ message: "Ticket not found." }, 404);
    return json({ ticket, messages: await customerMessages(env, ticketId) });
  }

  const replyMatch = url.pathname.match(/^\/api\/support\/tickets\/([^/]+)\/replies$/);
  if (replyMatch && request.method === "POST") {
    const rejected = secureMutation(request, allowedOrigin || env.CONTROL_PLANE_ALLOWED_ORIGIN);
    if (rejected) return rejected;
    const ticketId = decodeURIComponent(replyMatch[1]);
    if (!validTicketId(ticketId)) return json({ message: "Ticket not found." }, 404);
    const ticket = await customerTicket(env, user.id, ticketId);
    if (!ticket) return json({ message: "Ticket not found." }, 404);
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body || body.length > 8000) return json({ message: "Message must be between 1 and 8,000 characters." }, 400);
    const messageId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE support_tickets
            SET status=CASE WHEN status='resolved' THEN 'open' ELSE status END,
                updated_at=CURRENT_TIMESTAMP,last_message_at=CURRENT_TIMESTAMP
          WHERE id=? AND customer_user_id=?`,
      ).bind(ticketId, user.id),
      env.DB.prepare(
        "INSERT INTO support_ticket_messages(id,ticket_id,sender_user_id,sender_type,body) VALUES(?,?,?,'customer',?)",
      ).bind(messageId, ticketId, user.id, body),
      env.DB.prepare(
        "INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json) VALUES(?,?,?,?)",
      ).bind(user.id, "support_ticket_replied", ticket.project_id, JSON.stringify({ ticketId, senderType: "customer" })),
    ]);
    return json({ ticket: await customerTicket(env, user.id, ticketId), messages: await customerMessages(env, ticketId) }, 201);
  }

  return json({ message: "Not found" }, 404);
}
async function adminTicket(env: SupportEnv, ticketId: string) {
  return env.DB.prepare(
    `SELECT t.id,t.customer_user_id,t.category,t.subject,t.status,t.project_id,
            COALESCE(u.profile_name,u.display_name,u.username) AS customer_name,
            u.email AS customer_email,p.name AS project_name,
            t.created_at,t.updated_at,t.last_message_at
       FROM support_tickets t
       JOIN users u ON u.id=t.customer_user_id
       LEFT JOIN projects p ON p.id=t.project_id
      WHERE t.id=?`,
  ).bind(ticketId).first<any>();
}

async function adminMessages(env: SupportEnv, ticketId: string) {
  const result = await env.DB.prepare(
    `SELECT m.id,m.sender_type,m.body,m.created_at,
            CASE WHEN m.sender_type='support' THEN 'BuildCustom Support'
                 ELSE COALESCE(u.profile_name,u.display_name,u.username,'Customer') END AS sender_name
       FROM support_ticket_messages m
       LEFT JOIN users u ON u.id=m.sender_user_id
      WHERE m.ticket_id=?
      ORDER BY m.created_at ASC,m.rowid ASC`,
  ).bind(ticketId).all<any>();
  return result.results.map((row) => ({
    id: row.id,
    sender: row.sender_name,
    senderType: row.sender_type,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export async function handleAdminSupportTicketRoute(args: {
  env: SupportEnv;
  request: Request;
  url: URL;
  input: Record<string, unknown>;
  admin: SessionUser;
  allowedOrigin?: string;
}): Promise<Response | null> {
  const { env, request, url, input, admin, allowedOrigin } = args;
  if (!url.pathname.startsWith("/api/admin/support/tickets")) return null;
  if (admin.role !== "super_admin" || admin.account_status === "suspended") {
    return json({ message: "Forbidden" }, 403);
  }

  if (url.pathname === "/api/admin/support/tickets" && request.method === "GET") {
    const status = url.searchParams.get("status") || "";
    if (status && !STATUSES.includes(status as typeof STATUSES[number])) {
      return json({ message: "Choose a valid ticket status." }, 400);
    }
    const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
    const like = `%${escapeLike(search)}%`;
    const result = await env.DB.prepare(
      `SELECT t.id,t.customer_user_id,t.category,t.subject,t.status,t.project_id,
              COALESCE(u.profile_name,u.display_name,u.username) AS customer_name,
              u.email AS customer_email,p.name AS project_name,
              t.created_at,t.updated_at,t.last_message_at
         FROM support_tickets t
         JOIN users u ON u.id=t.customer_user_id
         LEFT JOIN projects p ON p.id=t.project_id
        WHERE (?='' OR t.status=?)
          AND (?='' OR t.subject LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR u.email LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR COALESCE(u.profile_name,u.display_name,u.username) LIKE ? ESCAPE '\\' COLLATE NOCASE)
        ORDER BY t.updated_at DESC LIMIT 100`,
    ).bind(status, status, search, like, like, like).all<any>();
    return json({ tickets: result.results });
  }

  const detailMatch = url.pathname.match(/^\/api\/admin\/support\/tickets\/([^/]+)$/);
  if (detailMatch && request.method === "GET") {
    const ticketId = decodeURIComponent(detailMatch[1]);
    if (!validTicketId(ticketId)) return json({ message: "Ticket not found." }, 404);
    const ticket = await adminTicket(env, ticketId);
    if (!ticket) return json({ message: "Ticket not found." }, 404);
    let projectDiagnosticsAvailable = false;
    if (ticket.project_id) {
      const grant = await env.DB.prepare(
        `SELECT id FROM support_access_grants
          WHERE customer_user_id=? AND project_id=? AND revoked_at_ms IS NULL AND expires_at_ms>?
          ORDER BY granted_at_ms DESC LIMIT 1`,
      ).bind(ticket.customer_user_id, ticket.project_id, Date.now()).first();
      projectDiagnosticsAvailable = !!grant;
    }
    return json({ ticket: { ...ticket, projectDiagnosticsAvailable }, messages: await adminMessages(env, ticketId) });
  }

  const replyMatch = url.pathname.match(/^\/api\/admin\/support\/tickets\/([^/]+)\/replies$/);
  if (replyMatch && request.method === "POST") {
    const rejected = secureMutation(request, allowedOrigin || env.CONTROL_PLANE_ALLOWED_ORIGIN);
    if (rejected) return rejected;
    const ticketId = decodeURIComponent(replyMatch[1]);
    if (!validTicketId(ticketId)) return json({ message: "Ticket not found." }, 404);
    const ticket = await adminTicket(env, ticketId);
    if (!ticket) return json({ message: "Ticket not found." }, 404);
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body || body.length > 8000) return json({ message: "Message must be between 1 and 8,000 characters." }, 400);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE support_tickets
            SET status='waiting_for_customer',updated_at=CURRENT_TIMESTAMP,last_message_at=CURRENT_TIMESTAMP
          WHERE id=?`,
      ).bind(ticketId),
      env.DB.prepare(
        "INSERT INTO support_ticket_messages(id,ticket_id,sender_user_id,sender_type,body) VALUES(?,?,?,'support',?)",
      ).bind(crypto.randomUUID(), ticketId, admin.id, body),
      env.DB.prepare(
        "INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json) VALUES(?,?,?,?)",
      ).bind(admin.id, "admin_support_ticket_replied", ticket.project_id, JSON.stringify({ ticketId })),
    ]);
    const updated = await adminTicket(env, ticketId);
    return json({ ticket: updated, messages: await adminMessages(env, ticketId) }, 201);
  }

  const statusMatch = url.pathname.match(/^\/api\/admin\/support\/tickets\/([^/]+)\/status$/);
  if (statusMatch && request.method === "PATCH") {
    const rejected = secureMutation(request, allowedOrigin || env.CONTROL_PLANE_ALLOWED_ORIGIN);
    if (rejected) return rejected;
    const ticketId = decodeURIComponent(statusMatch[1]);
    if (!validTicketId(ticketId)) return json({ message: "Ticket not found." }, 404);
    const status = input.status;
    if (!STATUSES.includes(status as typeof STATUSES[number])) return json({ message: "Choose a valid ticket status." }, 400);
    const ticket = await adminTicket(env, ticketId);
    if (!ticket) return json({ message: "Ticket not found." }, 404);
    const result = await env.DB.batch([
      env.DB.prepare(
        "UPDATE support_tickets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(status, ticketId),
      env.DB.prepare(
        "INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json) VALUES(?,?,?,?)",
      ).bind(admin.id, "admin_support_ticket_status_changed", ticket.project_id, JSON.stringify({ ticketId, status })),
    ]);
    if (Number(result[0]?.meta?.changes || 0) !== 1) return json({ message: "Ticket status could not be updated." }, 409);
    return json({ ticket: await adminTicket(env, ticketId) });
  }

  return json({ message: "Not found" }, 404);
}
