import { tool, type Tool } from 'ai';
import { emitThinkDiagnostic, observeThinkBoundarySync, type ThinkDiagnosticContext } from './diagnostics';
import { z } from 'zod';
import { THINK_INTERNAL_CONTINUATION_PREFIX } from './context-selector';

export type ThinkTaskStatus =
	| 'RUNNING'
	| 'COMPLETE'
	| 'BLOCKED'
	| 'USER_INPUT_REQUIRED'
	| 'INCOMPLETE_RESOURCE_LIMIT';

export interface ThinkTaskLifecycle {
	status: ThinkTaskStatus;
	summary: string;
	reason?: string;
	updatedAt: number;
autoContinue?: { taskId: string; enabled: boolean; version: number; changedAt: number };
}

export interface ThinkTaskEvidence {
	preflightSucceeded: boolean;
	deploySucceeded: boolean;
	deployedCommitHash: string | null;
	headCommitHash: string | null;
	headBranch: string | null;
	workingTreeClean: boolean;
	previewCommitHash: string | null;
	previewBranch: string | null;
	browserClean: boolean;
	browserCommitHash: string | null;
	browserBranch: string | null;
	browserPreviewUrl: string | null;
	configuredPreviewUrl: string | null;
	deployedPreviewUrl: string | null;
	deployedBranch: string | null;
}

export interface ThinkTaskOperation {
	taskId: string;
/** Stable customer intent across separately approved bounded operations. */
customerTaskId?: string;
parentOperationId?: string;
originalIntent?: string;
	conversationId: string;
	continuationCount: number;
	continuationBudget: number;
	limits: ThinkOperationLimits;
	lastOperationFingerprint: string;
	lastPassStartFingerprint: string;
	completedPassCount: number;
	pendingPromptKind: 'INITIAL' | 'CONTINUATION' | null;
	messageCountAtPassStart: number;
	discoveryFingerprints?: string[];
	startedAt: number;
	startingHead: string | null;
	modelCalls: number;
	toolCalls: number;
	creditsConsumed: number;
	availableMeteredCredits: number | null;
	meteredCreditsInitialized: boolean;
resourceLimitReason?: ThinkResourceLimitReason;
resourceLimitAt?: number;
/** Historical delivery receipt: acknowledge without running the current task. */
replayOnly?: boolean;
	lastWorkspaceFingerprint: string | null;
	lastValidationFingerprint: string | null;
}

export interface ThinkOperationLimits {
	maxContinuations: number;
	maxModelCalls: number;
	maxToolCalls: number;
	maxElapsedMs: number;
	maxCredits: number;
}

/**
 * Uncalibrated fallback guardrails for environments that do not pass explicit
 * operation limits. These values are not a selected production policy.
 */
export const THINK_UNCALIBRATED_OPERATION_LIMITS: Readonly<ThinkOperationLimits> = {
	maxContinuations: 25,
	maxModelCalls: 650,
	maxToolCalls: 1300,
	maxElapsedMs: 60 * 60 * 1000,
	maxCredits: 100,
};
export const THINK_CONTINUATION_BUDGET = THINK_UNCALIBRATED_OPERATION_LIMITS.maxContinuations;
const THINK_DISCOVERY_FINGERPRINT_HISTORY_LIMIT = 256;

const THINK_OPERATION_LIMIT_KEYS: Array<keyof ThinkOperationLimits> = [
	'maxContinuations',
	'maxModelCalls',
	'maxToolCalls',
	'maxElapsedMs',
	'maxCredits',
];

export function parseThinkOperationLimits(source: Record<string, unknown>): Partial<ThinkOperationLimits> {
	const parsed: Partial<ThinkOperationLimits> = {};
	for (const key of THINK_OPERATION_LIMIT_KEYS) {
		const value = source[key];
		if (value === undefined || value === null || value === '') continue;
		const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
		const mustBeInteger = key !== 'maxCredits';
		if (
			!Number.isFinite(numeric) ||
			numeric <= 0 ||
			(mustBeInteger && !Number.isSafeInteger(numeric))
		) {
			throw new Error(`Think operation limit ${key} must be a positive ${mustBeInteger ? 'integer' : 'number'}.`);
		}
		parsed[key] = numeric;
	}
	return parsed;
}

export function resolveThinkOperationLimits(
	overrides?: Partial<ThinkOperationLimits>,
): ThinkOperationLimits {
	return {
		...THINK_UNCALIBRATED_OPERATION_LIMITS,
		...parseThinkOperationLimits(overrides ?? {}),
	};
}

export function createThinkTaskOperation(
	taskId: string,
	conversationId: string,
	limitsOrContinuationBudget: number | Partial<ThinkOperationLimits> = {},
	additionalLimits?: Partial<ThinkOperationLimits>,
): ThinkTaskOperation {
	const limits = resolveThinkOperationLimits(
		typeof limitsOrContinuationBudget === 'number'
			? { ...additionalLimits, maxContinuations: limitsOrContinuationBudget }
			: limitsOrContinuationBudget,
	);
	return {
		taskId,
		conversationId,
		continuationCount: 0,
		continuationBudget: limits.maxContinuations,
		limits,
		lastOperationFingerprint: '',
		lastPassStartFingerprint: '',
		completedPassCount: 0,
		pendingPromptKind: 'INITIAL',
		messageCountAtPassStart: 0,
		discoveryFingerprints: [],
		startedAt: Date.now(),
		startingHead: null,
		modelCalls: 0,
		toolCalls: 0,
		creditsConsumed: 0,
		availableMeteredCredits: null,
		meteredCreditsInitialized: false,
		lastWorkspaceFingerprint: null,
		lastValidationFingerprint: null,
	};
}

export function createThinkTaskQueueIdentity(queueItemIds: string[]): string {
	if (queueItemIds.length === 0 || queueItemIds.some((id) => !id)) {
		throw new Error('Think task identity requires queued input IDs');
	}
	return `think-queue:${queueItemIds.join(':')}`;
}

export function resolveThinkCompletedTaskReplay(
taskId: string,
receipt: ThinkTaskOperation | undefined,
): ThinkTaskOperation | undefined {
return receipt?.taskId === taskId ? { ...receipt, replayOnly: true } : undefined;
}

export function resolveThinkTaskStart(
	taskId: string,
	status: ThinkTaskStatus,
	existing: ThinkTaskOperation | undefined,
	pendingStartIntent?: string,
): 'START_NEW' | 'RESUME' | 'ACK_TERMINAL' {
	if (existing?.taskId !== taskId) return 'START_NEW';
	if (pendingStartIntent === taskId) return 'RESUME';
	return status === 'RUNNING' ? 'RESUME' : 'ACK_TERMINAL';
}

export function isThinkPromptPersistedAfterBoundary(
	messages: Array<{
		role: string;
		content?: unknown;
		parts?: Array<{ type?: string; text?: string }>;
	}>,
	messageCountAtPassStart: number,
	prompt: string,
): boolean {
	return messages.slice(Math.max(0, messageCountAtPassStart)).some((message) => {
		if (message.role !== 'user') return false;
		const text = typeof message.content === 'string'
			? message.content
			: (message.parts ?? [])
					.filter((part) => part.type === 'text' && typeof part.text === 'string')
					.map((part) => part.text)
					.join('\n');
		return prompt.startsWith(THINK_INTERNAL_CONTINUATION_PREFIX)
			? text.startsWith(THINK_INTERNAL_CONTINUATION_PREFIX)
			: text === prompt;
	});
}

export type ThinkPendingChatRecovery = 'NOT_PERSISTED' | 'PERSISTED_INCOMPLETE' | 'PERSISTED_COMPLETE';

export function classifyThinkPendingChatRecovery(
	messages: Array<{
		role: string;
		content?: unknown;
		parts?: Array<{ type?: string; text?: string }>;
	}>,
	messageCountAtPassStart: number,
	prompt: string,
	hasDurableCompletionCheckpoint = false,
): ThinkPendingChatRecovery {
	if (!isThinkPromptPersistedAfterBoundary(messages, messageCountAtPassStart, prompt)) return 'NOT_PERSISTED';
	return hasDurableCompletionCheckpoint ? 'PERSISTED_COMPLETE' : 'PERSISTED_INCOMPLETE';
}

export type ThinkRevisionRpcName = 'gitStatus' | 'gitLog' | 'gitBranch' | 'getDeployment';

export interface ThinkCurrentRevisionEvidence {
	headCommitHash: string | null;
	headBranch: string | null;
	workingTreeClean: boolean;
	workspaceStatusFingerprint: string;
	previewCommitHash: string | null;
	previewBranch: string | null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object') return value as Record<string, unknown>;
	if (typeof value !== 'string') return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

export async function readThinkCurrentRevisionEvidence(
	read: (method: ThinkRevisionRpcName, argument?: unknown) => Promise<unknown>,
	branch: string,
): Promise<ThinkCurrentRevisionEvidence> {
	const [status, log, branchState, deploymentValue] = await Promise.all([
		read('gitStatus'),
		read('gitLog', 1),
		read('gitBranch', { list: true }),
		read('getDeployment', branch).catch(() => null),
	]);
	const deployment = recordFromUnknown(deploymentValue);
	const normalizedStatus = Array.isArray(status)
		? status.slice().sort((left, right) =>
			createThinkOperationFingerprint('git-status-entry', left)
				.localeCompare(createThinkOperationFingerprint('git-status-entry', right)),
		)
		: status;
	const latestCommit = Array.isArray(log) ? log[0] as { oid?: unknown } | undefined : undefined;
	const activeBranch = recordFromUnknown(branchState)?.current;
	const deploymentCommitHash = typeof deployment?.commit_hash === 'string'
		? deployment.commit_hash
		: typeof deployment?.commitHash === 'string'
			? deployment.commitHash
			: null;
	const deploymentBranch = typeof deployment?.branch === 'string' ? deployment.branch : null;
	return {
		headCommitHash: typeof latestCommit?.oid === 'string' ? latestCommit.oid : null,
		headBranch: typeof activeBranch === 'string'
			? activeBranch
			: latestCommit?.oid === deploymentCommitHash ? deploymentBranch : null,
		workingTreeClean: Array.isArray(status) && status.length === 0,
		workspaceStatusFingerprint: createThinkOperationFingerprint('git-status', normalizedStatus),
		previewCommitHash: deploymentCommitHash,
		previewBranch: deploymentBranch,
	};
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? String(value);
}

export function createThinkOperationFingerprint(kind: string, evidence: unknown): string {
	const serialized = `${kind}:${stableSerialize(evidence)}`;
	let hash = 2166136261;
	for (let index = 0; index < serialized.length; index++) {
		hash ^= serialized.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${kind}:${(hash >>> 0).toString(16)}`;
}

export function createThinkDiscoveryFingerprint(evidence: {
	toolName: string;
	query: unknown;
	result: unknown;
	workspaceRevision: string | null;
	workspaceStatusFingerprint: string;
}): string {
	return createThinkOperationFingerprint('workspace-discovery', {
		toolName: evidence.toolName,
		query: evidence.query,
		resultFingerprint: createThinkOperationFingerprint('discovery-result', evidence.result),
		workspaceRevision: evidence.workspaceRevision,
		workspaceStatusFingerprint: evidence.workspaceStatusFingerprint,
	});
}

export function sameSignedPreviewUrl(actual: string | undefined, configured: string | undefined): boolean {
	if (!actual || !configured) return false;
	try {
		const actualUrl = new URL(actual);
		const configuredUrl = new URL(configured);
		return (
			actualUrl.protocol === configuredUrl.protocol &&
			actualUrl.origin === configuredUrl.origin &&
			actualUrl.pathname === configuredUrl.pathname &&
			actualUrl.search === configuredUrl.search &&
			actualUrl.hash === configuredUrl.hash
		);
	} catch {
		return false;
	}
}

function previewUrlTargetsDeployment(configured: string | undefined, deployed: string | undefined): boolean {
	if (!configured || !deployed) return false;
	try {
		const configuredUrl = new URL(configured);
		const deployedUrl = new URL(deployed, configuredUrl);
		return configuredUrl.origin === deployedUrl.origin && configuredUrl.pathname === deployedUrl.pathname;
	} catch {
		return false;
	}
}

export function advanceThinkTaskOperation(operation: ThinkTaskOperation): ThinkTaskOperation {
	return operation.continuationCount >= operation.continuationBudget
		? operation
		: {
				...operation,
				continuationCount: operation.continuationCount + 1,
				pendingPromptKind: 'CONTINUATION',
			};
}

export function recordThinkOperation(
	operation: ThinkTaskOperation,
	fingerprint: string,
): ThinkTaskOperation {
	const kind = fingerprint.slice(0, fingerprint.indexOf(':'));
	return {
		...operation,
		lastOperationFingerprint: fingerprint,
		...(kind === 'workspace-operation' ? { lastWorkspaceFingerprint: fingerprint } : {}),
		...(kind.includes('validation') ? { lastValidationFingerprint: fingerprint } : {}),
	};
}

export function recordThinkDiscoveryOperation(
	operation: ThinkTaskOperation,
	discoveryFingerprint: string,
	operationFingerprint: string,
): ThinkTaskOperation {
	const seen = operation.discoveryFingerprints ?? [];
	if (seen.includes(discoveryFingerprint)) return operation;
	return {
		...operation,
		lastOperationFingerprint: operationFingerprint,
		lastWorkspaceFingerprint: operationFingerprint,
		discoveryFingerprints: [...seen, discoveryFingerprint].slice(-THINK_DISCOVERY_FINGERPRINT_HISTORY_LIMIT),
	};
}

export type ThinkResourceLimitReason =
	| 'model_call_limit'
	| 'tool_call_limit'
	| 'elapsed_time_limit'
	| 'credit_limit'
	| 'available_credits_limit';

export function reserveThinkTaskResource(
	operation: ThinkTaskOperation,
	resource: 'model' | 'tool' | 'checkpoint',
	now: number,
	creditCost = 0,
): { operation: ThinkTaskOperation; limitExceeded?: ThinkResourceLimitReason } {
	const limits = operation.limits ?? resolveThinkOperationLimits({
		maxContinuations: operation.continuationBudget,
	});
	const normalized: ThinkTaskOperation = {
		...operation,
		limits,
		continuationBudget: operation.continuationBudget ?? limits.maxContinuations,
		startedAt: operation.startedAt ?? now,
		startingHead: operation.startingHead ?? null,
		modelCalls: operation.modelCalls ?? 0,
		toolCalls: operation.toolCalls ?? 0,
		creditsConsumed: operation.creditsConsumed ?? 0,
		availableMeteredCredits: operation.availableMeteredCredits ?? null,
		meteredCreditsInitialized: operation.meteredCreditsInitialized ?? false,
		lastWorkspaceFingerprint: operation.lastWorkspaceFingerprint ?? null,
		lastValidationFingerprint: operation.lastValidationFingerprint ?? null,
	};
const stopped = (reason: ThinkResourceLimitReason) => ({
operation: {
...normalized,
resourceLimitReason: normalized.resourceLimitReason ?? reason,
resourceLimitAt: normalized.resourceLimitAt ?? now,
},
limitExceeded: normalized.resourceLimitReason ?? reason,
});
if (normalized.resourceLimitReason) return stopped(normalized.resourceLimitReason);
	if (now - normalized.startedAt >= limits.maxElapsedMs) {
return stopped('elapsed_time_limit');
	}
	if (resource === 'checkpoint') return { operation: normalized };
	if (resource === 'model') {
		if (normalized.modelCalls >= limits.maxModelCalls) {
return stopped('model_call_limit');
		}
		if (normalized.creditsConsumed + creditCost > limits.maxCredits) {
return stopped('credit_limit');
		}
		if (
			normalized.meteredCreditsInitialized &&
			normalized.availableMeteredCredits !== null &&
			normalized.availableMeteredCredits < creditCost
		) {
return stopped('available_credits_limit');
		}
		return {
			operation: {
				...normalized,
				modelCalls: normalized.modelCalls + 1,
				creditsConsumed: normalized.creditsConsumed + creditCost,
				availableMeteredCredits: normalized.availableMeteredCredits === null
					? null
					: Math.max(0, normalized.availableMeteredCredits - creditCost),
			},
		};
	}
	if (normalized.toolCalls >= limits.maxToolCalls) {
return stopped('tool_call_limit');
	}
	return { operation: { ...normalized, toolCalls: normalized.toolCalls + 1 } };
}

export function recoverThinkTaskOperation(
	operation: ThinkTaskOperation,
	fallbackLimits?: Partial<ThinkOperationLimits>,
	now = Date.now(),
): ThinkTaskOperation {
	const limits = operation.limits ?? resolveThinkOperationLimits({
		...fallbackLimits,
		maxContinuations: operation.continuationBudget,
	});
	return reserveThinkTaskResource({
		...operation,
		limits,
	}, 'checkpoint', operation.startedAt ?? now).operation;
}

export function markThinkTaskChatStarted(
	operation: ThinkTaskOperation,
	messageCountAtPassStart = operation.messageCountAtPassStart,
): ThinkTaskOperation {
	return {
		...operation,
		lastPassStartFingerprint: operation.lastOperationFingerprint,
		messageCountAtPassStart,
	};
}

export function markThinkTaskChatResolved(operation: ThinkTaskOperation): ThinkTaskOperation {
	if (operation.pendingPromptKind === null) return operation;
	return {
		...operation,
		completedPassCount: operation.completedPassCount + 1,
		pendingPromptKind: null,
	};
}

export function decideThinkTaskContinuation(
	status: ThinkTaskStatus,
	operation: ThinkTaskOperation | undefined,
	previousFingerprint?: string,
): 'STOP' | 'CONTINUE' | 'BLOCKED' | 'INCOMPLETE_RESOURCE_LIMIT' {
	if (status !== 'RUNNING') return 'STOP';
	if (
		!operation ||
		operation.lastOperationFingerprint === (previousFingerprint ?? operation.lastPassStartFingerprint)
	) return 'BLOCKED';
	if (operation.continuationCount >= operation.continuationBudget) return 'INCOMPLETE_RESOURCE_LIMIT';
	return 'CONTINUE';
}

export interface ThinkTaskDriverStub {
	getTaskLifecycle(): Promise<ThinkTaskLifecycle>;
	getTaskOperation(): Promise<ThinkTaskOperation | undefined>;
	recoverPendingTaskChat(prompt: string): Promise<ThinkPendingChatRecovery>;
	markTaskChatStarted(): Promise<ThinkTaskOperation>;
	markTaskChatResolved(): Promise<ThinkTaskOperation>;
	advanceTaskOperation(): Promise<ThinkTaskOperation>;
	stopTask(status: ThinkTaskStatus, summary: string, reason?: string): Promise<void>;
}

export async function driveThinkTaskOperation(options: {
	stub: ThinkTaskDriverStub;
	initialOperation: ThinkTaskOperation;
	initialPrompt: string;
	chat(prompt: string): Promise<void>;
	continuationPrompt(summary: string): string;
	onPassStart?(kind: 'INITIAL' | 'CONTINUATION'): void;
	onPassEnd?(decision: 'STOP' | 'CONTINUE' | 'BLOCKED' | 'INCOMPLETE_RESOURCE_LIMIT'): void;
diagnosticContext?: ThinkDiagnosticContext | (() => ThinkDiagnosticContext);
}): Promise<{ operation: ThinkTaskOperation; lifecycle: ThinkTaskLifecycle }> {
	const { stub } = options;
	let operation = options.initialOperation;
let diagnosticBoundary = 'driver.initial-lifecycle';
const diagnosticContext = (): ThinkDiagnosticContext => ({
...(typeof options.diagnosticContext === 'function' ? options.diagnosticContext() : options.diagnosticContext), operationId: operation.taskId,
conversationId: operation.conversationId, continuationCount: operation.continuationCount,
turn: operation.continuationCount + 1, completedPassCount: operation.completedPassCount,
pendingPromptKind: operation.pendingPromptKind, modelCalls: operation.modelCalls, toolCalls: operation.toolCalls,
});
try {
	let lifecycle = await stub.getTaskLifecycle();
	if (lifecycle.status !== 'RUNNING') return { operation, lifecycle };

	if (operation.pendingPromptKind) {
		const pendingPrompt = operation.pendingPromptKind === 'INITIAL'
			? options.initialPrompt
			: options.continuationPrompt('Resume the interrupted task from its durable operation state.');
diagnosticBoundary = 'driver.recover-pending-chat';
		const recovery = await stub.recoverPendingTaskChat(pendingPrompt);
		if (recovery !== 'NOT_PERSISTED') {
			const recovered = await stub.getTaskOperation();
			if (!recovered) {
				await stub.stopTask('BLOCKED', 'Think operation state is missing during recovery.', 'operation_state_missing');
				return { operation, lifecycle: await stub.getTaskLifecycle() };
			}
			if (
				recovery === 'PERSISTED_INCOMPLETE' &&
				recovered.continuationCount >= recovered.continuationBudget
			) {
				await stub.stopTask(
					'INCOMPLETE_RESOURCE_LIMIT',
					'The persisted continuation budget was exhausted while recovering an in-flight chat.',
					'continuation_budget_exhausted',
				);
				return { operation: recovered, lifecycle: await stub.getTaskLifecycle() };
			}
			operation = recovery === 'PERSISTED_INCOMPLETE'
				? await stub.advanceTaskOperation()
				: recovered;
		}
	}

	if (operation.pendingPromptKind === null && operation.completedPassCount > 0) {
diagnosticBoundary = 'driver.recovery-decision';
const decision = observeThinkBoundarySync(diagnosticBoundary, diagnosticContext,
() => decideThinkTaskContinuation(lifecycle.status, operation));
emitThinkDiagnostic(diagnosticBoundary, 'decision', () => ({ ...diagnosticContext(), decision, operationState: lifecycle.status }));
		if (decision !== 'CONTINUE') {
			if (decision === 'BLOCKED') {
				await stub.stopTask('BLOCKED', 'The task made no concrete progress before reconnect.', 'no_progress');
			} else if (decision === 'INCOMPLETE_RESOURCE_LIMIT') {
				await stub.stopTask(
					'INCOMPLETE_RESOURCE_LIMIT',
					'The persisted continuation budget is exhausted.',
					'continuation_budget_exhausted',
				);
			}
			return { operation, lifecycle: await stub.getTaskLifecycle() };
		}
		operation = await stub.advanceTaskOperation();
	}

	while (true) {
		const kind = operation.pendingPromptKind;
		if (!kind) {
			await stub.stopTask('BLOCKED', 'Think operation has no pending pass to execute.', 'operation_state_invalid');
			return { operation, lifecycle: await stub.getTaskLifecycle() };
		}
		const prompt = kind === 'INITIAL'
			? options.initialPrompt
			: options.continuationPrompt(lifecycle.summary);
		options.onPassStart?.(kind);
diagnosticBoundary = 'driver.mark-chat-started';
		await stub.markTaskChatStarted();
		try {
diagnosticBoundary = 'driver.chat';
			await options.chat(prompt);
		} catch (error) {
emitThinkDiagnostic(diagnosticBoundary, 'error', diagnosticContext, error);
diagnosticBoundary = 'driver.error-lifecycle';
			lifecycle = await stub.getTaskLifecycle();
if (lifecycle.status !== 'INCOMPLETE_RESOURCE_LIMIT') {
diagnosticBoundary = 'driver.chat';
throw error;
}
			options.onPassEnd?.('INCOMPLETE_RESOURCE_LIMIT');
			return {
				operation: (await stub.getTaskOperation()) ?? operation,
				lifecycle,
			};
		}
diagnosticBoundary = 'driver.mark-chat-resolved';
		await stub.markTaskChatResolved();
diagnosticBoundary = 'driver.post-chat-lifecycle';
		lifecycle = await stub.getTaskLifecycle();
diagnosticBoundary = 'driver.post-chat-operation';
		const afterPass = await stub.getTaskOperation();
diagnosticBoundary = 'driver.post-chat-decision';
const decision = observeThinkBoundarySync(diagnosticBoundary, diagnosticContext,
() => decideThinkTaskContinuation(lifecycle.status, afterPass));
emitThinkDiagnostic(diagnosticBoundary, 'decision', () => ({
...diagnosticContext(), decision, operationState: lifecycle.status,
modelCalls: afterPass?.modelCalls, toolCalls: afterPass?.toolCalls,
completedPassCount: afterPass?.completedPassCount, continuationCount: afterPass?.continuationCount,
}));
diagnosticBoundary = 'driver.onPassEnd';
		options.onPassEnd?.(decision);
		if (decision === 'STOP') return { operation: afterPass ?? operation, lifecycle };
		if (decision === 'BLOCKED') {
			await stub.stopTask(
				'BLOCKED',
				lifecycle.summary || 'The task is blocked because the latest pass made no concrete operation progress.',
				'no_progress',
			);
			return { operation: afterPass ?? operation, lifecycle: await stub.getTaskLifecycle() };
		}
		if (decision === 'INCOMPLETE_RESOURCE_LIMIT') {
			await stub.stopTask(
				'INCOMPLETE_RESOURCE_LIMIT',
				lifecycle.summary || 'The task needs more work than the persisted continuation budget allows.',
				'continuation_budget_exhausted',
			);
			return { operation: afterPass ?? operation, lifecycle: await stub.getTaskLifecycle() };
		}
		if (!afterPass) {
			await stub.stopTask('BLOCKED', 'Think operation state is missing.', 'operation_state_missing');
			return { operation, lifecycle: await stub.getTaskLifecycle() };
		}
		operation = await stub.advanceTaskOperation();
	}
} catch (error) {
emitThinkDiagnostic(diagnosticBoundary, 'error', diagnosticContext, error);
throw error;
}
}

export function hasCompleteThinkTaskEvidence(evidence: ThinkTaskEvidence): boolean {
	return (
		evidence.preflightSucceeded &&
		evidence.deploySucceeded &&
		Boolean(evidence.deployedCommitHash) &&
		evidence.deployedCommitHash === evidence.headCommitHash &&
		evidence.deployedBranch === evidence.headBranch &&
		evidence.deployedCommitHash === evidence.previewCommitHash &&
		evidence.deployedBranch === evidence.previewBranch &&
		evidence.workingTreeClean &&
		evidence.browserClean &&
		evidence.browserCommitHash === evidence.deployedCommitHash &&
		evidence.browserBranch === evidence.deployedBranch &&
		sameSignedPreviewUrl(evidence.browserPreviewUrl ?? undefined, evidence.configuredPreviewUrl ?? undefined) &&
		previewUrlTargetsDeployment(evidence.configuredPreviewUrl ?? undefined, evidence.deployedPreviewUrl ?? undefined) &&
		Boolean(evidence.deployedPreviewUrl) &&
		Boolean(evidence.deployedBranch)
	);
}

export function createFinishTaskTool(opts: {
	getEvidence: () => Promise<ThinkTaskEvidence>;
	saveStatus: (status: ThinkTaskLifecycle) => Promise<void>;
	getForcedStatus?: () => Promise<ThinkTaskStatus | undefined>;
	getForcedLifecycle?: () => Promise<ThinkTaskLifecycle>;
}): Tool {
	return tool({
		description: [
			'Report the structured lifecycle state for the current request.',
			'Use RUNNING when further implementation or verification is needed, BLOCKED when a concrete blocker prevents progress, USER_INPUT_REQUIRED when clarification is required, and INCOMPLETE_RESOURCE_LIMIT when unable to finish within available resources.',
			'Only report COMPLETE after deploy_space succeeded, preflight passed, the deployed commit matches the current clean branch HEAD, and get_browser_console_logs checked that exact preview revision without errors. The platform independently checks these operation records; the evidence text you provide is not proof.',
		].join('\n'),
		inputSchema: z.object({
			status: z.enum(['RUNNING', 'COMPLETE', 'BLOCKED', 'USER_INPUT_REQUIRED', 'INCOMPLETE_RESOURCE_LIMIT']),
			summary: z.string().min(1).max(2000),
			evidence: z.string().max(2000).optional(),
		}),
		execute: async ({ status, summary }) => {
			let acceptedStatus = status;
			let reason: string | undefined;
			if (status === 'COMPLETE') {
				const evidence = await opts.getEvidence();
				if (!hasCompleteThinkTaskEvidence(evidence)) {
					acceptedStatus = 'RUNNING';
					reason = 'missing_verification_evidence';
				}
			}
			const forcedStatus = await opts.getForcedStatus?.();
			if (forcedStatus === 'INCOMPLETE_RESOURCE_LIMIT') {
				const forcedLifecycle = await opts.getForcedLifecycle?.();
				if (forcedLifecycle?.status === forcedStatus) return JSON.stringify(forcedLifecycle);
				acceptedStatus = forcedStatus;
				reason = 'resource_limit_reached';
			} else if (forcedStatus === 'USER_INPUT_REQUIRED') {
				acceptedStatus = forcedStatus;
			} else if (status === 'INCOMPLETE_RESOURCE_LIMIT') {
				acceptedStatus = 'RUNNING';
				reason = 'resource_limit_not_reached';
			}
			const lifecycle: ThinkTaskLifecycle = {
				status: acceptedStatus,
				summary,
				reason,
				updatedAt: Date.now(),
			};
			await opts.saveStatus(lifecycle);
			return JSON.stringify(lifecycle);
		},
	});
}
