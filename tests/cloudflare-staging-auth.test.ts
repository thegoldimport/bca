import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_COOKIE, expiredSessionCookie, parseCookie, sessionCookie } from "../cloudflare/staging/auth";
test("uses host-only secure cookies", () => {
  const cookie = sessionCookie("opaque");
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=opaque;`));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  assert.equal(parseCookie(cookie), "opaque");
  assert.match(expiredSessionCookie(), /Max-Age=0/);
});