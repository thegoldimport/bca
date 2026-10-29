# BuildCustom test-only VibeSDK source slice

This directory is an ignored VibeSDK 1.5.0 checkout. The full checkout is not
tracked because it contains large dependency trees, generated output, and local
configuration. Only the MIT-licensed source files below are tracked for the
GitHub test suite:

- `worker/agents/think/finish-task-tool.ts`
- `worker/agents/think/user-approved-continuation.ts`
- `worker/agents/think/context-selector.ts`
- `worker/agents/think/diagnostics.ts` (relative-import dependency)
- `worker/agents/think/ThinkAgent.ts`
- `worker/agents/core/behaviors/think.ts`
- `worker/agents/core/websocket.ts`

The runtime tests import the first four files and inspect the last three as
source text. Release scripts that require the complete VibeSDK checkout are not
part of clean-checkout CI. Do not add `node_modules`, build output, `.dev.vars`,
or other local configuration to Git.
