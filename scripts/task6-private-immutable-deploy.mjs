#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import WebSocket from 'ws';

const CHECKPOINT = '/tmp/buildcustom-task6-private-runtime-checkpoint.json';
const PRIVATE_ORIGIN = 'https://buildcustom-vibesdk-launch.thegoldimport.workers.dev';
const REVISION = '735705d3cbcbb0c066803a605e1582488ca8c1c2';
const TIMEOUT_MS = 180_000;

async function saveCheckpoint(value) {
  const temporary = `${CHECKPOINT}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, CHECKPOINT);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

const checkpoint = JSON.parse(await readFile(CHECKPOINT, 'utf8'));
if (checkpoint.base !== PRIVATE_ORIGIN || checkpoint.deployAttempted) {
  throw new Error('Refusing to deploy outside the private runtime or repeat an attempted deployment.');
}
if (!checkpoint.agentId || !checkpoint.userId || !Array.isArray(checkpoint.cookies)) {
  throw new Error('Acceptance checkpoint is incomplete.');
}
if (Date.parse(checkpoint.sessionExpiresAt) <= Date.now()) {
  throw new Error('Owner session has expired; no deployment sent.');
}
const expectedScript = `bc-r-${createHash('sha256')
  .update(`${checkpoint.agentId}:${REVISION}`)
  .digest('hex')
  .slice(0, 56)}`;
if (expectedScript !== 'bc-r-cffdb5ce7e2a8953cabfd35df97a90057931e6797364d1d47043ac43') {
  throw new Error('Immutable identity disagrees with the preflight result.');
}

const cookie = checkpoint.cookies.map(([name, value]) => `${name}=${value}`).join('; ');
const response = await fetch(`${PRIVATE_ORIGIN}/api/agent/${encodeURIComponent(checkpoint.agentId)}/connect`, {
  headers: { cookie },
  redirect: 'manual',
  signal: AbortSignal.timeout(20_000),
});
if (response.status !== 200) throw new Error(`Owner connect returned HTTP ${response.status}.`);
const { data } = await response.json();
if (data?.agentId !== checkpoint.agentId || !data.websocketUrl) {
  throw new Error('Owner connect returned the wrong agent.');
}
if (new URL(data.websocketUrl).host !== new URL(PRIVATE_ORIGIN).host) {
  throw new Error('Owner WebSocket points outside the isolated runtime.');
}

const socket = new WebSocket(data.websocketUrl, {
  headers: { Cookie: cookie, Origin: PRIVATE_ORIGIN },
});
let attempted = false;
let settled = false;
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    socket.terminate();
    reject(new Error('Private deployment outcome is unknown; do not resend.'));
  }, TIMEOUT_MS);

  function finish(error, value) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.close();
    if (error) reject(error);
    else resolve(value);
  }

  socket.on('message', async (message) => {
    let event;
    try {
      event = JSON.parse(message.toString());
    } catch {
      return;
    }
    if (event.type === 'agent_connected' && !attempted && !settled) {
      const state = event.state ?? {};
      if (
        state.behaviorType !== 'think'
        || state.currentBranch !== 'main'
        || state.shouldBeGenerating !== false
        || state.lastDeployedCommit !== REVISION
        || event.deploymentCapabilities?.platformImmutableRelease !== true
      ) {
        finish(new Error('Agent state does not match the settled pinned revision; no deployment sent.'));
        return;
      }
      try {
        await saveCheckpoint({
          ...checkpoint,
          deployAttempted: true,
          expectedRevision: REVISION,
          expectedScript,
          stage: 'private-deploy-outcome-unknown',
        });
        attempted = true;
        socket.send(JSON.stringify({
          type: 'deploy',
          target: 'platform',
          immutableRelease: true,
          expectedRevision: REVISION,
        }));
        console.log(JSON.stringify({ stage: 'private-deploy-sent-once', expectedScript, revision: REVISION }));
      } catch {
        finish(new Error('Could not safely record/send the deployment attempt; reconcile before any retry.'));
      }
      return;
    }
    if (event.type === 'cloudflare_deployment_error' && attempted) {
      finish(new Error('The isolated runtime reported that private deployment failed; inspect before retrying.'));
    }
    if (event.type === 'cloudflare_deployment_completed' && attempted) {
      if (event.deploymentId !== expectedScript || event.commitHash !== REVISION) {
        finish(new Error('Deployment reported a mismatched immutable identity; reconcile before proceeding.'));
      } else {
        finish(null, { deploymentId: event.deploymentId, commitHash: event.commitHash });
      }
    }
  });
  socket.once('error', () => finish(new Error('Deployment WebSocket failed; outcome unknown.')));
  socket.once('close', () => {
    if (!settled) finish(new Error('Deployment WebSocket closed before a terminal result; outcome unknown.'));
  });
});

await saveCheckpoint({
  ...checkpoint,
  deployAttempted: true,
  expectedRevision: REVISION,
  expectedScript,
  deploymentId: result.deploymentId,
  stage: 'private-deploy-reported-complete',
});
console.log(JSON.stringify({ stage: 'private-deploy-reported-complete', ...result, deploysSent: 1 }));