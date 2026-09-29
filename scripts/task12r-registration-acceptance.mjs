#!/usr/bin/env node

import { isExplicitExecute, sanitizeError } from "./lib/task12u-registration-operator.mjs";
import { runRegistrationAcceptance } from "./lib/task12v-registration-runner.mjs";
import { createTask12VProductionAdapter } from "./lib/task12v-production-adapter.mjs";

if (!isExplicitExecute(process.argv.slice(2))) {
  console.error("Refusing to run live registration acceptance without exactly one --execute argument.");
  process.exitCode = 2;
} else {
  try {
    const io = createTask12VProductionAdapter();
    const result = await runRegistrationAcceptance(io);
    console.log(JSON.stringify({
      status: result.status,
      phase: result.phase,
      caseCount: result.cases.length,
      completedAt: result.completedAt,
    }));
    if (result.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", error: sanitizeError(error) }));
    process.exitCode = 1;
  }
}