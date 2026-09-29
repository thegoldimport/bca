import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const authPage = readFileSync("client/src/pages/app-auth.tsx", "utf8");
const resetPage = readFileSync("client/src/pages/reset-password.tsx", "utf8");
const routes = readFileSync("client/src/App.tsx", "utf8");

test("BuildCustom sign-in exposes forgot-password flow without opening registration", () => {
  assert.match(authPage, /Forgot password\?/);
  assert.match(authPage, /\/api\/auth\/forgot-password/);
  assert.match(authPage, /registrationEnabled &&/);
});

test("reset-password route submits confirmed password and returns to sign in on success", () => {
  assert.match(routes, /path="\/reset-password" component=\{ResetPassword\}/);
  assert.match(resetPage, /data-testid="input-new-password"/);
  assert.match(resetPage, /data-testid="input-confirm-password"/);
  assert.match(resetPage, /password !== confirmPassword/);
  assert.match(resetPage, /\/api\/auth\/reset-password/);
  assert.match(resetPage, /confirmPassword \}/);
  assert.match(resetPage, /link-sign-in-success/);
  assert.match(resetPage, /history\.replaceState/);
});