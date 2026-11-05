import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "regexparam";
import { adminNavigationForRole, ownerAuthorizationVisible } from "../client/src/lib/admin-navigation";
import {
  ownerActivationButtonEnabled,
  ownerActivationRequestBody,
} from "../client/src/lib/owner-activation";

test("regular users never receive admin navigation links", () => {
  assert.deepEqual(adminNavigationForRole("user"), []);
  assert.deepEqual(adminNavigationForRole(null), []);
});

test("super admins receive the required admin navigation and no owner activation link", () => {
  const links = adminNavigationForRole("super_admin");
  assert.deepEqual(links.map(({ label }) => label), [
    "Users",
    "Projects",
    "Analytics",
    "Deployments",
    "System Health",
    "Billing",
    "Support",
  ]);
  assert.equal(ownerAuthorizationVisible("support@buildcustom.ai", "super_admin"), false);
});

test("every admin sidebar destination has a matching admin-only route", () => {
  const dashboard = readFileSync("client/src/pages/app-dashboard.tsx", "utf8");
  const appRouter = readFileSync("client/src/App.tsx", "utf8");

  const outerAppRoute = appRouter.match(/<Route path="(\/app\/\*)" component={AppDashboard} \/>/)?.[1];
  assert.ok(outerAppRoute, "deep app URLs must use Wouter's multi-segment wildcard");
  const outerAppRoutePattern = parse(outerAppRoute).pattern;

  for (const { path, label } of adminNavigationForRole("super_admin")) {
    assert.match(path, outerAppRoutePattern, `${label} destination ${path} must reach the dashboard router`);
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const route = new RegExp(
      `isAdminUser\\(user\\)\\s*&&\\s*<Route\\s+path="${escapedPath}"\\s+component=`,
    );
    assert.match(dashboard, route, `${label} sidebar destination ${path} must have an admin-only route`);
  }
});

test("only the designated pre-activation account sees owner authorization", () => {
  assert.equal(ownerAuthorizationVisible(" SUPPORT@BUILDCUSTOM.AI ", "user"), true);
  assert.equal(ownerAuthorizationVisible("customer@example.test", "user"), false);
  assert.equal(ownerAuthorizationVisible("support@buildcustom.ai", "super_admin"), false);
});

test("owner activation button requires server eligibility, exact email, and no pending request", () => {
  assert.equal(ownerActivationButtonEnabled(true, "support@buildcustom.ai", false), true);
  assert.equal(ownerActivationButtonEnabled(false, "support@buildcustom.ai", false), false);
  assert.equal(ownerActivationButtonEnabled(true, "other@example.test", false), false);
  assert.equal(ownerActivationButtonEnabled(true, "support@buildcustom.ai", true), false);
});

test("owner activation request body contains confirmation only and page has no secret field", () => {
  assert.deepEqual(ownerActivationRequestBody(" SUPPORT@BUILDCUSTOM.AI "), {
    confirmEmail: "support@buildcustom.ai",
  });
  const page = readFileSync("client/src/pages/owner-bootstrap-page.tsx", "utf8");
  assert.equal(page.includes("ownerSecret"), false);
  assert.equal(page.includes("owner-bootstrap-secret"), false);
});
