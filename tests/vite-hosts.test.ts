import assert from "node:assert/strict";
import test from "node:test";
import { getAllowedDevHosts } from "../server/vite-hosts";

test("allows localhost and the exact Replit domains configured for this workspace", () => {
  assert.deepEqual(
    getAllowedDevHosts({
      REPLIT_DEV_DOMAIN: "workspace.janeway.replit.dev",
      REPLIT_DOMAINS:
        "workspace.janeway.replit.dev,workspace.replit.app,other.example",
    }),
    [
      "localhost",
      "workspace.janeway.replit.dev",
      "workspace.replit.app",
    ],
  );
});

test("rejects arbitrary hosts, suffix lookalikes, and URL paths", () => {
  assert.deepEqual(
    getAllowedDevHosts({
      REPLIT_DEV_DOMAIN: "attacker.example",
      REPLIT_DOMAINS:
        "workspace.replit.dev.attacker.example,https://preview.replit.dev/path",
    }),
    ["localhost"],
  );
});

test("normalizes configured hostnames and removes duplicates", () => {
  assert.deepEqual(
    getAllowedDevHosts({
      REPLIT_DEV_DOMAIN: "HTTPS://Workspace.Replit.Dev",
      REPLIT_DOMAINS: "workspace.replit.dev, OTHER.REPLIT.APP",
    }),
    ["localhost", "workspace.replit.dev", "other.replit.app"],
  );
});
