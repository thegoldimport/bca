import { Think } from '@cloudflare/think';
import type { PrepareStepContext, StepConfig, Session, TurnContext, TurnConfig } from '@cloudflare/think';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, ToolSet } from 'ai';
import {
	createReadTool,
	createWriteTool,
	createEditTool,
	createListTool,
	createFindTool,
	createGrepTool,
	createDeleteTool,
} from '@cloudflare/think/tools/workspace';
import type { SkillSource } from 'agents/skills';
import { createSpaceWorkspaceOps, withDurableObjectResetRetry, type SpaceWorkspaceStub } from './space-workspace-ops';
import { selectSystemPrompt, PROMPT_MAX_STEPS } from './prompts';
import { createThinkSkillSource } from './skills';
import { createAskQuestionsTool } from './ask-questions-tool';
import { createBrowserConsoleLogsTool } from './browser-logs-tool';
import { isThinkBrowserCaptureClean } from './browser-evidence';
import { createDeploySpaceTool } from './deploy-tool';
import { createCommitTool } from './commit-tool';
import { createSetTitleTool } from './set-title-tool';
import { selectThinkContextMessages } from './context-selector';
import {
assertContinuationApproval, continuationTaskId, createApprovedThinkOperation,
type ThinkContinuationApproval,
} from './user-approved-continuation';
import {
	advanceThinkTaskOperation,
	createFinishTaskTool,
	createThinkTaskOperation,
	createThinkOperationFingerprint,
	createThinkDiscoveryFingerprint,
	recordThinkDiscoveryOperation,
	classifyThinkPendingChatRecovery,
	markThinkTaskChatResolved,
	markThinkTaskChatStarted,
	recordThinkOperation,
	resolveThinkTaskStart,
resolveThinkCompletedTaskReplay,
	reserveThinkTaskResource,
parseThinkOperationLimits,
	recoverThinkTaskOperation,
	readThinkCurrentRevisionEvidence,
	sameSignedPreviewUrl,
	type ThinkTaskEvidence,
	type ThinkTaskLifecycle,
	type ThinkTaskOperation,
	type ThinkTaskStatus,
	type ThinkPendingChatRecovery,
	type ThinkRevisionRpcName,
	type ThinkOperationLimits,
	type ThinkResourceLimitReason,
} from './finish-task-tool';
import { getUserConfigurableSettings } from '../../config';
import { RateLimitService } from '../../services/rate-limit/rateLimits';
import { hasCloudflareConfigured, isCloudflareGatewayLimitsEnabled } from '../../services/rate-limit/usageChecker';
import type { RateLimitSettings } from '../../services/rate-limit/config';
import { THINK_MODEL_CONFIG } from './model-config';
import type { ChatErrorContext, ChatResponseResult, StepContext, ToolCallContext, ToolCallResultContext } from '@cloudflare/think';
import { emitThinkDiagnostic, observeThinkBoundarySync, withThinkDiagnosticSafety, type ThinkDiagnosticContext } from './diagnostics';

/**
 * Per-instance configuration pushed into a {@link ThinkAgent} by the host
 * `ThinkCodingBehavior` (which runs in the main worker and therefore has access
 * to VibeSDK's model-config + AI Gateway plumbing). Plain JSON only — it crosses
 * the DO RPC boundary and is persisted via Think's `configure()`/`getConfig()`.
 */
export interface ThinkAgentConfig {
	/** Owner — used for usage attribution / logging. */
	userId: string;
	/**
	 * Fully-resolved model coordinates. The behavior computes these from the
	 * user's `ModelConfig` + AGENT_CONFIG via `getConfigurationForModel`, so
	 * `getModel()` here is a thin `@ai-sdk/openai` provider over the same
	 * AI Gateway `/compat` endpoint the rest of the platform uses.
	 */
	model: {
		baseURL: string;
		apiKey: string;
		modelName: string;
		contextSize?: number;
		headers?: Record<string, string>;
		/**
		 * When true, the AI Gateway holds the provider keys (BYOK / stored
		 * keys). In that mode the request must carry only `cf-aig-authorization`
		 * and must NOT send a provider `Authorization` header — otherwise the
		 * forwarded value overrides the gateway's stored key and the provider
		 * rejects it. `getModel()` strips `Authorization` when this is set.
		 */
		useStoredKeys?: boolean;
	};
	/** Builder system prompt (assembled host-side; falls back to a default). */
	systemPrompt?: string;
	/**
	 * Current preview URL (computed host-side via `getBrowserPreviewURL`), used
	 * as the default target for the `get_browser_console_logs` tool.
	 */
	previewUrl?: string;
	/** Per-task cumulative caps, snapshotted into the durable operation at start. */
	operationLimits?: Partial<ThinkOperationLimits>;
}

const DEFAULT_SYSTEM_PROMPT =
	'You are an expert Cloudflare full-stack engineer building deployable web apps. ' +
	'Use the workspace tools to read, write and edit files in the project. Keep changes ' +
	'minimal and runnable.';

/** Extracts the Gemini thought signature from a `tool_calls[]` entry, if any. */
function getThoughtSignature(call: unknown): string | undefined {
	const sig = (call as { extra_content?: { google?: { thought_signature?: unknown } } })
		?.extra_content?.google?.thought_signature;
	return typeof sig === 'string' ? sig : undefined;
}

/**
 * Google's OpenAI-compatible streaming omits the `index` field on each
 * `tool_calls` delta, but the OpenAI provider's chunk schema requires it
 * (`choices[].delta.tool_calls[].index` must be a number). Patch each parsed
 * SSE `data:` line so the AI SDK's zod validation passes, assigning the array
 * position when `index` is absent. Also harvest each tool call's Gemini
 * `thought_signature` (keyed by tool-call id) via `onSignature`, so it can be
 * replayed on later turns (Gemini 3 rejects function-call history that drops
 * it — `400 INVALID_ARGUMENT`).
 */
function patchToolCallChunk(
	json: Record<string, unknown>,
	onSignature: (id: string, signature: string) => void,
): Record<string, unknown> {
	const choices = json.choices;
	if (!Array.isArray(choices)) return json;
	for (const choice of choices) {
		const delta = (choice as { delta?: { tool_calls?: unknown } }).delta;
		const toolCalls = delta?.tool_calls;
		if (!Array.isArray(toolCalls)) continue;
		toolCalls.forEach((call, i) => {
			if (call && typeof call === 'object' && (call as { index?: unknown }).index == null) {
				(call as { index: number }).index = i;
			}
			const id = (call as { id?: unknown })?.id;
			const sig = getThoughtSignature(call);
			if (typeof id === 'string' && sig) onSignature(id, sig);
		});
	}
	return json;
}

/**
 * Rewrites an SSE response body, applying {@link patchToolCallChunk} to each
 * `data:` event. Buffers across network chunks so split JSON lines parse
 * correctly. Non-JSON lines (e.g. `data: [DONE]`) pass through untouched.
 */
function fixToolCallStream(
	body: ReadableStream<Uint8Array>,
	onSignature: (id: string, signature: string) => void,
): ReadableStream<Uint8Array> {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';
	const transformLine = (line: string): string => {
		const trimmed = line.trimStart();
		if (!trimmed.startsWith('data:')) return line;
		const payload = trimmed.slice(5).trim();
		if (!payload || payload === '[DONE]') return line;
		try {
			const json = JSON.parse(payload) as Record<string, unknown>;
			return `data: ${JSON.stringify(patchToolCallChunk(json, onSignature))}`;
		} catch {
			return line;
		}
	};
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				buffer += decoder.decode(chunk, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					controller.enqueue(encoder.encode(`${transformLine(line)}\n`));
				}
			},
			flush(controller) {
				if (buffer) controller.enqueue(encoder.encode(transformLine(buffer)));
			},
		}),
	);
}

/**
 * ThinkAgent — the `@cloudflare/think` harness. It owns the agentic loop
 * (model ↔ tools), message persistence and streaming; its file tools operate
 * on the companion SpaceDO (the preview source of truth) rather than Think's
 * default DO-SQLite workspace.
 */
export class ThinkAgent extends Think<Env> {
	/** Step budget per turn (Think's default is 10). */
	override maxSteps = 25;
	/** SpaceDO has no shell; expose only the explicit file tools. */
	override workspaceBash = false;

	/**
	 * Gemini thought signatures harvested from streamed tool calls, keyed by
	 * tool-call id. Re-injected into outgoing request history (the AI SDK drops
	 * the `extra_content` Google requires for multi-step function calling).
	 */
	private readonly thoughtSignatures = new Map<string, string>();
	private turnUsage: { config: RateLimitSettings; hasCloudflareConfigured: boolean } | null = null;
	private readonly taskLifecycleKey = 'think_task_lifecycle';
	private readonly taskEvidenceKey = 'think_task_evidence';
	private readonly taskOperationKey = 'think_task_operation';
	private readonly taskForcedStatusKey = 'think_task_forced_status';
	private readonly taskStartIntentKey = 'think_task_start_intent';
	private diagnosticOperation?: ThinkTaskOperation;
	private diagnosticState?: ThinkTaskLifecycle['status'];
	private diagnosticNativeRequestId?: string;
	private diagnosticUserId?: string;
	private diagnosticStep?: number;
	private diagnosticToolName?: string;
	private diagnosticToolCallId?: string;

	private diagnosticContext(): ThinkDiagnosticContext {
		const operation = this.diagnosticOperation;
		return {
			agentId: this.name, userId: this.diagnosticUserId,
			nativeRequestId: this.diagnosticNativeRequestId,
			conversationId: operation?.conversationId, operationId: operation?.taskId,
			continuationCount: operation?.continuationCount,
			turn: operation ? operation.continuationCount + 1 : undefined,
			completedPassCount: operation?.completedPassCount,
			pendingPromptKind: operation?.pendingPromptKind,
			modelCalls: operation?.modelCalls, toolCalls: operation?.toolCalls,
			operationState: this.diagnosticState, step: this.diagnosticStep,
			toolName: this.diagnosticToolName, toolCallId: this.diagnosticToolCallId,
		};
	}

	private putTaskDiagnostic(key: string, value: unknown): void {
		observeThinkBoundarySync('operation.persistence', () => ({
			...this.diagnosticContext(), storageKey: key,
		}), () => this.ctx.storage.kv.put(key, value));
		withThinkDiagnosticSafety(() => {
			if (key === this.taskOperationKey) this.diagnosticOperation = value as ThinkTaskOperation;
			if (key === this.taskLifecycleKey) this.diagnosticState = (value as ThinkTaskLifecycle).status;
		});
		emitThinkDiagnostic('operation.persistence', 'put-returned', () => ({
			...this.diagnosticContext(), storageKey: key,
		}));
	}

	override onChatError(error: unknown, context?: ChatErrorContext): unknown {
		withThinkDiagnosticSafety(() => { this.diagnosticNativeRequestId = context?.requestId; });
		emitThinkDiagnostic('think.stream-result', 'error', () => ({
			...this.diagnosticContext(), stage: context?.stage,
		}), error);
		return super.onChatError(error, context);
	}

	override onChatResponse(result: ChatResponseResult): void | Promise<void> {
		withThinkDiagnosticSafety(() => {
			this.diagnosticNativeRequestId = result.requestId;
			emitThinkDiagnostic('think.stream-result', 'response-hook', () => ({
				...this.diagnosticContext(), streamStatus: result.status,
			}), result.status === 'error' ? result.error : undefined);
		});
		return super.onChatResponse(result);
	}

	override beforeToolCall(context: ToolCallContext) {
		withThinkDiagnosticSafety(() => {
			this.diagnosticToolName = context.toolName;
			this.diagnosticToolCallId = context.toolCallId;
			this.diagnosticStep = context.stepNumber === undefined ? undefined : context.stepNumber + 1;
		});
		emitThinkDiagnostic('tool.execution', 'start', () => this.diagnosticContext());
		return super.beforeToolCall(context);
	}

	override afterToolCall(context: ToolCallResultContext): void | Promise<void> {
		withThinkDiagnosticSafety(() => {
			emitThinkDiagnostic('tool.execution', context.success ? 'success' : 'error', () => ({
				...this.diagnosticContext(), toolName: context.toolName, toolCallId: context.toolCallId,
			}), context.success ? undefined : context.error);
		});
		return super.afterToolCall(context);
	}

	override onStepFinish(context: StepContext): void | Promise<void> {
		return observeThinkBoundarySync('think.onStepFinish', () => ({
			...this.diagnosticContext(), finishReason: context.finishReason,
			inputTokens: context.usage.inputTokens, outputTokens: context.usage.outputTokens,
		}),
			() => super.onStepFinish(context));
	}

	private async getTaskEvidence(): Promise<ThinkTaskEvidence> {
		return this.ctx.storage.kv.get<ThinkTaskEvidence>(this.taskEvidenceKey) ?? {
			preflightSucceeded: false,
			deploySucceeded: false,
			deployedCommitHash: null,
			headCommitHash: null,
			headBranch: null,
			workingTreeClean: false,
			previewCommitHash: null,
			previewBranch: null,
			browserClean: false,
			browserCommitHash: null,
			browserBranch: null,
			browserPreviewUrl: null,
			configuredPreviewUrl: this.getConfig<ThinkAgentConfig>()?.previewUrl ?? null,
			deployedPreviewUrl: null,
			deployedBranch: null,
		};
	}

	private async saveTaskEvidence(patch: Partial<ThinkTaskEvidence>): Promise<void> {
		const evidence = { ...(await this.getTaskEvidence()), ...patch };
		this.putTaskDiagnostic(this.taskEvidenceKey, evidence);
	}

	private async saveTaskLifecycle(lifecycle: ThinkTaskLifecycle): Promise<void> {
const existing = this.ctx.storage.kv.get<ThinkTaskLifecycle>(this.taskLifecycleKey);
if (existing?.status === 'INCOMPLETE_RESOURCE_LIMIT') return;
		this.putTaskDiagnostic(this.taskLifecycleKey, lifecycle);
	}

	private resourceLimitSummary(reason: ThinkResourceLimitReason, operation: ThinkTaskOperation): string {
		switch (reason) {
			case 'model_call_limit':
				return `Think stopped before another model request because the configured cumulative limit of ${operation.limits.maxModelCalls} model calls was reached.`;
			case 'tool_call_limit':
				return `Think stopped before another tool execution because the configured cumulative limit of ${operation.limits.maxToolCalls} tool calls was reached.`;
			case 'elapsed_time_limit':
				return `Think stopped because the configured elapsed-time limit of ${operation.limits.maxElapsedMs} ms was reached.`;
			case 'credit_limit':
				return `Think stopped before another model request because the configured cumulative credit limit of ${operation.limits.maxCredits} credits would be exceeded.`;
			case 'available_credits_limit':
				return 'Think stopped before another model request because the available metered credits are insufficient for that request.';
		}
	}

	private stopForResourceLimit(reason: ThinkResourceLimitReason, operation: ThinkTaskOperation): void {
const existing = this.ctx.storage.kv.get<ThinkTaskLifecycle>(this.taskLifecycleKey);
if (existing?.status === 'INCOMPLETE_RESOURCE_LIMIT') return;
		const summary = this.resourceLimitSummary(reason, operation);
		const lifecycle: ThinkTaskLifecycle = {
			status: 'INCOMPLETE_RESOURCE_LIMIT',
			summary,
			reason,
			updatedAt: Date.now(),
		};
		this.putTaskDiagnostic(this.taskForcedStatusKey, 'INCOMPLETE_RESOURCE_LIMIT');
		this.putTaskDiagnostic(this.taskLifecycleKey, lifecycle);
	}

	private async refreshMeteredCredits(operation: ThinkTaskOperation): Promise<ThinkTaskOperation> {
		const usage = this.turnUsage;
		const config = this.getConfig<ThinkAgentConfig>();
		if (!usage || !config) return operation;
		const llmConfig = usage.config.llmCalls;
const metered = llmConfig.enabled && !(usage.hasCloudflareConfigured && llmConfig.excludeCloudflareConnected);
		if (!metered) {
			if (operation.meteredCreditsInitialized) return operation;
			return { ...operation, meteredCreditsInitialized: true, availableMeteredCredits: null };
		}
		try {
			const { remaining } = await RateLimitService.getRemainingCredits(this.env, usage.config, config.userId);
			const latest = this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey) ?? operation;
			const previousAvailable = latest.meteredCreditsInitialized
				? latest.availableMeteredCredits
				: null;
			return {
				...latest,
				meteredCreditsInitialized: true,
				availableMeteredCredits: previousAvailable === null
					? remaining
					: Math.min(previousAvailable, remaining),
			};
		} catch {
			return operation;
		}
	}

	private async reserveOperationResource(
		resource: 'model' | 'tool' | 'checkpoint',
	): Promise<void> {
		let operation = this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey);
		if (!operation) return;
		if (resource === 'model') operation = await this.refreshMeteredCredits(operation);
		const now = Date.now();
		const reservation = reserveThinkTaskResource(
			operation,
			resource,
			now,
			resource === 'model' ? THINK_MODEL_CONFIG.creditCost : 0,
		);
		if (reservation.limitExceeded) {
				this.putTaskDiagnostic(this.taskOperationKey, reservation.operation);
			this.stopForResourceLimit(reservation.limitExceeded, reservation.operation);
			throw new Error(`Think operation stopped: ${reservation.limitExceeded}`);
		}
		this.putTaskDiagnostic(this.taskOperationKey, reservation.operation);
	}

	private async recordOperationFingerprint(fingerprint: string): Promise<void> {
		const operation = this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey);
		if (!operation) return;
		this.putTaskDiagnostic(
			this.taskOperationKey,
			recordThinkOperation(operation, fingerprint),
		);
	}

	private async recordDiscoveryOperationFingerprint(
		discoveryFingerprint: string,
		operationFingerprint: string,
	): Promise<void> {
		const operation = this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey);
		if (!operation) return;
		this.putTaskDiagnostic(
			this.taskOperationKey,
			recordThinkDiscoveryOperation(operation, discoveryFingerprint, operationFingerprint),
		);
	}

	private trackTool<T>(
		target: T,
		onOutput?: (output: unknown, input: unknown) => Promise<void>,
	): T {
		const execute = (target as { execute?: (...args: never[]) => unknown }).execute;
		if (!execute) return target;
		return {
			...(target as object),
			execute: async (input: unknown, options: unknown) => {
			try {
				await this.reserveOperationResource('tool');
				const output = await Reflect.apply(execute, target, [input, options]);
				await onOutput?.(output, input);
				return output;
			} catch (error) {
				emitThinkDiagnostic('tool.execute-and-evidence', 'error', () => this.diagnosticContext(), error);
				throw error;
			}
			},
		} as T;
	}

	private parseToolOutput(output: unknown): Record<string, unknown> | undefined {
		if (output && typeof output === 'object') return output as Record<string, unknown>;
		if (typeof output !== 'string') return undefined;
		try {
			const parsed = JSON.parse(output) as unknown;
			return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
		} catch {
			return undefined;
		}
	}

	private getRevisionStub(): SpaceWorkspaceStub & {
		gitLog: (limit?: number) => Promise<Array<{ oid: string }>>;
		gitBranch: (opts?: { list?: boolean }) => Promise<unknown>;
		getDeployment: (branch: string) => Promise<unknown>;
	} {
		return this.getSpaceStub() as SpaceWorkspaceStub & {
			gitLog: (limit?: number) => Promise<Array<{ oid: string }>>;
			gitBranch: (opts?: { list?: boolean }) => Promise<unknown>;
			getDeployment: (branch: string) => Promise<unknown>;
		};
	}

	private async readCurrentRevisionEvidence(branch: string) {
		const getStub = () => this.getRevisionStub();
		const read = (method: ThinkRevisionRpcName, argument?: unknown): Promise<unknown> =>
			withDurableObjectResetRetry(getStub, (stub) => {
				switch (method) {
					case 'gitStatus':
						return stub.gitStatus();
					case 'gitLog':
						return stub.gitLog(argument as number);
					case 'gitBranch':
						return stub.gitBranch(argument as { list?: boolean });
					case 'getDeployment':
						return stub.getDeployment(argument as string);
				}
			});
		return readThinkCurrentRevisionEvidence(read, branch);
	}

	private async refreshTaskEvidence(): Promise<ThinkTaskEvidence> {
		const evidence = await this.getTaskEvidence();
		if (!evidence.deployedBranch || !evidence.deployedCommitHash) return evidence;
		try {
			const current = await this.readCurrentRevisionEvidence(evidence.deployedBranch);
			const { workspaceStatusFingerprint: _statusFingerprint, ...taskEvidence } = current;
			await this.saveTaskEvidence(taskEvidence);
		} catch {
			await this.saveTaskEvidence({
				headCommitHash: null,
				headBranch: null,
				workingTreeClean: false,
				previewCommitHash: null,
				previewBranch: null,
			});
		}
		return this.getTaskEvidence();
	}

	private async recordWorkspaceOperation(name: string, input: unknown, output: unknown): Promise<void> {
		const args = input && typeof input === 'object' ? input as Record<string, unknown> : {};
		const path = [args.path, args.filePath, args.file].find((value) => typeof value === 'string') as string | undefined;
		const outputRecord = this.parseToolOutput(output);
		if (outputRecord?.error) return;
		let fileState = 'not-applicable';
		let contentFingerprint: string | null = null;
		if (path && ['read', 'write', 'edit', 'delete'].includes(name)) {
			try {
				const stub = this.getSpaceStub();
				if (name === 'delete') {
					fileState = (await stub.stat(path)) === null ? 'absent' : 'present';
				} else {
					const contents = await stub.readFile(path);
					fileState = 'present';
					contentFingerprint = createThinkOperationFingerprint('file-content', contents);
				}
			} catch {
				fileState = 'unavailable';
			}
		}
		const branch = (await this.getTaskEvidence()).deployedBranch ?? 'main';
		let current: Awaited<ReturnType<ThinkAgent['readCurrentRevisionEvidence']>> | undefined;
		try {
			current = await this.readCurrentRevisionEvidence(branch);
		} catch {
			current = undefined;
		}
		const discoveryFingerprint = ['read', 'list', 'find', 'grep'].includes(name) && current
			? createThinkDiscoveryFingerprint({
					toolName: name,
					query: args,
					result: output,
					workspaceRevision: current.headCommitHash,
					workspaceStatusFingerprint: current.workspaceStatusFingerprint,
				})
			: null;
		const operationFingerprint = createThinkOperationFingerprint('workspace-operation', {
			path,
			fileState,
			contentFingerprint,
			headCommitHash: current?.headCommitHash ?? null,
			workingTreeClean: current?.workingTreeClean ?? false,
			workspaceStatusFingerprint: current?.workspaceStatusFingerprint ?? 'unknown',
			discoveryFingerprint,
		});
		if (discoveryFingerprint) {
			await this.recordDiscoveryOperationFingerprint(discoveryFingerprint, operationFingerprint);
		} else {
			await this.recordOperationFingerprint(operationFingerprint);
		}
	}

	private bindBrowserToPreview<T>(target: T, configuredPreviewUrl?: string): T {
		const execute = (target as { execute?: (...args: never[]) => unknown }).execute;
		if (!execute) return target;
		return {
			...(target as object),
			execute: async (input: unknown, options: unknown) => {
				if (!configuredPreviewUrl) {
					return JSON.stringify({ error: 'No configured signed preview URL is available for verification.' });
				}
				const args = input && typeof input === 'object' ? input as Record<string, unknown> : {};
				if (typeof args.url === 'string' && !sameSignedPreviewUrl(args.url, configuredPreviewUrl)) {
					return JSON.stringify({ error: 'Browser verification is restricted to the configured signed preview URL.' });
				}
				return Reflect.apply(execute, target, [{ ...args, url: configuredPreviewUrl }, options]);
			},
		} as T;
	}

	private async captureDeployEvidence(output: unknown): Promise<void> {
		const result = this.parseToolOutput(output);
		const branch = typeof result?.branch === 'string' ? result.branch : 'main';
		const deployedCommitHash =
			typeof result?.commit_hash === 'string'
				? result.commit_hash
				: typeof result?.commitHash === 'string'
					? result.commitHash
					: null;
		const previewUrl =
			typeof result?.preview_url === 'string'
				? result.preview_url
				: typeof result?.previewUrl === 'string'
					? result.previewUrl
					: null;
		if (!result || result.error || !deployedCommitHash || !previewUrl) {
			await this.saveTaskEvidence({
				preflightSucceeded: false,
				deploySucceeded: false,
				deployedCommitHash,
				headCommitHash: null,
				headBranch: null,
				workingTreeClean: false,
				previewCommitHash: null,
				previewBranch: null,
				browserClean: false,
				browserCommitHash: null,
				browserBranch: null,
				browserPreviewUrl: null,
				deployedPreviewUrl: previewUrl,
				deployedBranch: branch,
			});
			await this.recordOperationFingerprint(createThinkOperationFingerprint('deploy-validation', {
				branch,
				passed: false,
				reason: result?.error ?? 'missing_deployment_identity',
			}));
			return;
		}

		try {
			await withDurableObjectResetRetry(() => this.getSpaceStub(), (stub) => stub.preflightDeploy(branch));
			const current = await this.readCurrentRevisionEvidence(branch);
			const { workspaceStatusFingerprint: _statusFingerprint, ...taskEvidence } = current;
			const deploySucceeded =
				current.workingTreeClean &&
				current.headCommitHash === deployedCommitHash &&
				current.previewCommitHash === deployedCommitHash &&
				current.headBranch === branch &&
				current.previewBranch === branch;
			await this.saveTaskEvidence({
				preflightSucceeded: true,
				deploySucceeded,
				deployedCommitHash,
				...taskEvidence,
				browserClean: false,
				browserCommitHash: null,
				browserBranch: null,
				browserPreviewUrl: null,
				deployedPreviewUrl: previewUrl,
				deployedBranch: branch,
			});
			await this.recordOperationFingerprint(createThinkOperationFingerprint('deploy-validation', {
				branch,
				passed: deploySucceeded,
				deployedCommitHash,
				...current,
			}));
		} catch {
			await this.saveTaskEvidence({
				preflightSucceeded: false,
				deploySucceeded: false,
				deployedCommitHash,
				headCommitHash: null,
				headBranch: null,
				workingTreeClean: false,
				previewCommitHash: null,
				previewBranch: null,
				browserClean: false,
				browserCommitHash: null,
				browserBranch: null,
				browserPreviewUrl: null,
				deployedPreviewUrl: previewUrl,
				deployedBranch: branch,
			});
			await this.recordOperationFingerprint(createThinkOperationFingerprint('deploy-validation', {
				branch,
				passed: false,
			}));
		}
	}

	private async captureBrowserEvidence(output: unknown): Promise<void> {
		const result = this.parseToolOutput(output);
		let evidence = await this.getTaskEvidence();
		const configuredPreviewUrl = this.getConfig<ThinkAgentConfig>()?.previewUrl ?? undefined;
		const cleanLogs = isThinkBrowserCaptureClean(result, configuredPreviewUrl);
		let browserMatchesRevision = false;
		const browserUrl = typeof result?.url === 'string' ? result.url : null;
		if (
			cleanLogs &&
			sameSignedPreviewUrl(browserUrl ?? undefined, configuredPreviewUrl) &&
			evidence.deployedCommitHash &&
			evidence.deployedCommitHash === evidence.headCommitHash &&
			evidence.workingTreeClean &&
			evidence.preflightSucceeded &&
			evidence.deployedPreviewUrl
		) {
			try {
				const expectedPath = new URL(evidence.deployedPreviewUrl, 'https://preview.local').pathname;
				const actualPath = new URL(configuredPreviewUrl as string).pathname;
				const current = await this.readCurrentRevisionEvidence(evidence.deployedBranch ?? 'main');
				const { workspaceStatusFingerprint: _statusFingerprint, ...taskEvidence } = current;
				await this.saveTaskEvidence(taskEvidence);
				evidence = await this.getTaskEvidence();
				browserMatchesRevision =
					actualPath === expectedPath &&
					current.workingTreeClean &&
					current.headCommitHash === evidence.deployedCommitHash &&
					current.previewCommitHash === evidence.deployedCommitHash &&
					current.headBranch === evidence.deployedBranch &&
					current.previewBranch === evidence.deployedBranch;
			} catch {
				browserMatchesRevision = false;
			}
		}
		await this.saveTaskEvidence({
			browserClean: cleanLogs && browserMatchesRevision,
			browserCommitHash: browserMatchesRevision ? evidence.deployedCommitHash : null,
			browserBranch: browserMatchesRevision ? evidence.deployedBranch : null,
			browserPreviewUrl: browserMatchesRevision ? browserUrl : null,
			configuredPreviewUrl: configuredPreviewUrl ?? null,
		});
		const logs = Array.isArray(result?.logs)
			? result.logs as Array<{ level?: unknown; text?: unknown }>
			: [];
		const pageErrors = Array.isArray(result?.page_errors)
			? result.page_errors as Array<{ message?: unknown }>
			: [];
		const requestFailures = Array.isArray(result?.request_failures)
			? result.request_failures as Array<{ url?: unknown; failure?: unknown; status?: unknown }>
			: [];
		const validationErrors = [
			...logs.filter((entry) => entry.level === 'error').map((entry) => entry.text),
			...pageErrors.map((entry) => entry.message),
			...requestFailures.map((entry) => {
				let path: unknown = entry.url;
				if (typeof entry.url === 'string') {
					try {
						path = new URL(entry.url).pathname;
					} catch {
						path = 'invalid-url';
					}
				}
				return [entry.failure, entry.status, path];
			}),
			result?.error,
			result?.warning,
		]
			.filter((value) => value !== undefined && value !== null)
			.map((value) => createThinkOperationFingerprint('browser-diagnostic', value))
			.sort();
		await this.recordOperationFingerprint(createThinkOperationFingerprint('browser-validation', {
			branch: evidence.deployedBranch,
			commitHash: evidence.deployedCommitHash,
			passed: cleanLogs && browserMatchesRevision,
			finalUrl: result?.final_url ?? null,
			truncated: result?.truncated ?? null,
			totals: result?.totals ?? null,
			validationErrors,
		}));
	}

	/**
	 * Re-attach harvested Gemini `thought_signature`s to the `tool_calls` in an
	 * outgoing request body, keyed by tool-call id. No-op if we have none or the
	 * body isn't the expected chat-completions JSON.
	 */
	private injectThoughtSignatures(bodyText: string): string {
		if (this.thoughtSignatures.size === 0) return bodyText;
		let json: { messages?: unknown };
		try {
			json = JSON.parse(bodyText);
		} catch {
			return bodyText;
		}
		const messages = json.messages;
		if (!Array.isArray(messages)) return bodyText;
		let changed = false;
		for (const message of messages) {
			const toolCalls = (message as { tool_calls?: unknown })?.tool_calls;
			if (!Array.isArray(toolCalls)) continue;
			for (const call of toolCalls) {
				const id = (call as { id?: unknown })?.id;
				if (typeof id !== 'string') continue;
				if (getThoughtSignature(call)) continue;
				const sig = this.thoughtSignatures.get(id);
				if (!sig) continue;
				const c = call as { extra_content?: { google?: Record<string, unknown> } };
				c.extra_content = {
					...(c.extra_content ?? {}),
					google: { ...(c.extra_content?.google ?? {}), thought_signature: sig },
				};
				changed = true;
			}
		}
		return changed ? JSON.stringify(json) : bodyText;
	}

	private requireConfig(): ThinkAgentConfig {
		const cfg = this.getConfig<ThinkAgentConfig>();
		if (!cfg) {
			throw new Error('ThinkAgent has not been configured yet (call configureVibe first)');
		}
		return cfg;
	}

	private getSpaceStub(): SpaceWorkspaceStub {
		// One space per session: the SpaceDO is always keyed by this session's
		// (agent) id, so a session can never resolve to a different space.
		const ns = (this.env as unknown as { SPACE_DO: DurableObjectNamespace }).SPACE_DO;
		return ns.get(ns.idFromName(this.name)) as unknown as SpaceWorkspaceStub;
	}

	override getModel(): LanguageModel {
		const { model } = this.requireConfig();
		// Wrap fetch to (1) strip the provider `Authorization` header in BYOK /
		// stored-keys mode (the gateway injects the stored key; a forwarded
		// header would override it) while preserving `cf-aig-authorization`;
		// (2) patch the response SSE stream so Google's compat tool-call deltas
		// (which omit `index`) satisfy the OpenAI provider's chunk schema; and
		// (3) round-trip Gemini `thought_signature`s — harvest them from the
		// response and re-inject them into outgoing request history (the AI SDK
		// drops them, which Gemini 3 rejects with `400 INVALID_ARGUMENT`).
		const gatewayFetch: typeof fetch = async (input, init) => {
			const headers = new Headers(init?.headers);
			if (model.useStoredKeys) headers.delete('authorization');
			let body = init?.body;
			if (typeof body === 'string') body = this.injectThoughtSignatures(body);
			const res = await fetch(input as RequestInfo, { ...(init ?? {}), headers, body });
			if (!res.body) return res;
			const outHeaders = new Headers(res.headers);
			// Body length/encoding change after transforming the stream.
			outHeaders.delete('content-length');
			outHeaders.delete('content-encoding');
			return new Response(
				fixToolCallStream(res.body, (id, sig) => this.thoughtSignatures.set(id, sig)),
				{ status: res.status, statusText: res.statusText, headers: outHeaders },
			);
		};
		const provider = createOpenAI({
			baseURL: model.baseURL,
			apiKey: model.apiKey,
			headers: model.headers,
			fetch: gatewayFetch,
		});
		// Use the Chat Completions API (`/compat/chat/completions`), NOT the
		// default Responses API (`/compat/responses`). VibeSDK's AI Gateway is
		// exercised via chat-completions everywhere else; the responses path on
		// the gateway rejects auth (401 AiGatewayError) for these models.
		return provider.chat(model.modelName);
	}

	/**
	 * Register the base prompt as a context block.
	 *
	 * Think only falls back to `getSystemPrompt()` when the session has NO
	 * context blocks. Because `getSkills()` adds a skills block, that fallback
	 * never fires — so without this, the model would receive only the skill
	 * catalog and none of the file-based persona prompt or project context.
	 * Adding it as a (lazy, readonly) block makes Think render it ahead of the
	 * skills block in the assembled system prompt. The `get` closure is invoked
	 * at prompt-freeze time, so it picks up config pushed via `configureVibe`.
	 */
	override configureSession(session: Session): Session {
		return session.withContext('system', {
			description: 'Base system prompt and project context',
			provider: { get: async () => this.getSystemPrompt() },
		});
	}

	override getSystemPrompt(): string {
		const cfg = this.getConfig<ThinkAgentConfig>();
		// Base prompt is the file-based prompt selected by model
		// family; the host behavior's project/query context (`systemPrompt`) is
		// appended. Think additionally injects the skill catalog (see getSkills).
		const base = selectSystemPrompt(cfg?.model.modelName ?? '');
		const projectContext = cfg?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
		return `${base}\n\n${projectContext}`;
	}

	override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
		const messages = selectThinkContextMessages(ctx.messages);
		const config = this.getConfig<ThinkAgentConfig>();
		withThinkDiagnosticSafety(() => { this.diagnosticUserId = config?.userId; });
		this.turnUsage = null;
// The same policy gates customer admission. A self-deployed runtime without
// this feature must not silently enforce the stock account-wide daily bucket.
// Its persisted per-operation resource ceilings still apply.
if (config && isCloudflareGatewayLimitsEnabled(this.env)) {
			try {
				const userConfig = await getUserConfigurableSettings(this.env, config.userId);
				this.turnUsage = {
					config: userConfig.security.rateLimit,
					hasCloudflareConfigured: await hasCloudflareConfigured(this.env, config.userId),
				};
			} catch (error) {
				console.warn('Failed to resolve Think credit metering configuration', error);
			}
		}
		console.info('Think context selected', {
			model: config?.model.modelName,
			contextSize: config?.model.contextSize,
			originalMessageCount: ctx.messages.length,
			selectedMessageCount: messages.length,
		});
		return { messages };
	}

	override getSkills(): SkillSource[] {
		// SKILL.md catalog. Think registers the skill-loading tool
		// and injects the catalog into the system prompt automatically.
		return [createThinkSkillSource()];
	}

	override getTools(): ToolSet {
		const ops = createSpaceWorkspaceOps(() => this.getSpaceStub());
		const previewUrl = this.getConfig<ThinkAgentConfig>()?.previewUrl;
		const deployTool = this.trackTool(
			createDeploySpaceTool({ getStub: () => this.getSpaceStub() }),
			(output) => this.captureDeployEvidence(output),
		);
		const browserTool = this.trackTool(
			this.bindBrowserToPreview(
				createBrowserConsoleLogsTool({ env: this.env, defaultUrl: previewUrl }),
				previewUrl,
			),
			(output) => this.captureBrowserEvidence(output),
		);
		const finishTaskTool = this.trackTool(createFinishTaskTool({
			getEvidence: () => this.refreshTaskEvidence(),
			saveStatus: (status) => this.saveTaskLifecycle(status),
			getForcedStatus: async () =>
				this.ctx.storage.kv.get<ThinkTaskStatus>(this.taskForcedStatusKey),
			getForcedLifecycle: () => this.getTaskLifecycle(),
		}));
		const invalidateVerification = async (): Promise<void> => {
			await this.saveTaskEvidence({
				preflightSucceeded: false,
				deploySucceeded: false,
				deployedCommitHash: null,
				headCommitHash: null,
				headBranch: null,
				workingTreeClean: false,
				previewCommitHash: null,
				previewBranch: null,
				browserClean: false,
				browserCommitHash: null,
				browserBranch: null,
				browserPreviewUrl: null,
			});
		};
		const captureWorkspaceTool = (name: string) =>
			(output: unknown, input: unknown): Promise<void> =>
				this.recordWorkspaceOperation(name, input, output);
		const markUserInputRequired = async (_output: unknown, input: unknown): Promise<void> => {
			this.putTaskDiagnostic(this.taskForcedStatusKey, 'USER_INPUT_REQUIRED');
			await this.saveTaskLifecycle({
				status: 'USER_INPUT_REQUIRED',
				summary: 'Waiting for answers to clarifying questions.',
				updatedAt: Date.now(),
			});
			await this.recordOperationFingerprint(createThinkOperationFingerprint('clarification-request', input));
		};
		// Same names as Think's built-in workspace tools, so these SpaceDO-backed
		// versions win the tool-merge. Bash is disabled via `workspaceBash`.
		return {
			read: this.trackTool(createReadTool({ ops }), captureWorkspaceTool('read')),
			write: this.trackTool(createWriteTool({ ops }), async (output, input) => {
				await invalidateVerification();
				await this.recordWorkspaceOperation('write', input, output);
			}),
			edit: this.trackTool(createEditTool({ ops }), async (output, input) => {
				await invalidateVerification();
				await this.recordWorkspaceOperation('edit', input, output);
			}),
			list: this.trackTool(createListTool({ ops }), captureWorkspaceTool('list')),
			find: this.trackTool(createFindTool({ ops }), captureWorkspaceTool('find')),
			grep: this.trackTool(createGrepTool({ ops }), captureWorkspaceTool('grep')),
			delete: this.trackTool(createDeleteTool({ ops }), async (output, input) => {
				await invalidateVerification();
				await this.recordWorkspaceOperation('delete', input, output);
			}),
			// Save a restore point without deploying. The model decides when.
			commit: this.trackTool(createCommitTool({ getStub: () => this.getSpaceStub() }), async (output) => {
				await invalidateVerification();
				await this.recordWorkspaceOperation('commit', {}, output);
			}),
			// Commit + deploy the SpaceDO branch so the preview rebuilds.
			deploy_space: deployTool,
			// Set the project's short display title (host observes the output).
			set_title: this.trackTool(createSetTitleTool()),
			// Ask the user clarifying questions via a frontend popup.
			ask_questions: this.trackTool(createAskQuestionsTool(), markUserInputRequired),
			// Client-side debugging via a real headless browser.
			get_browser_console_logs: browserTool,
			finish_task: finishTaskTool,
		} as unknown as ToolSet;
	}

async setTaskAutoContinue(taskId: string, enabled: boolean) {
const operation = await this.getTaskOperation();
if (!operation || continuationTaskId(operation) !== taskId || typeof enabled !== 'boolean') {
throw new Error('This task is no longer available.');
}
const current = this.ctx.storage.kv.get<NonNullable<ThinkTaskLifecycle['autoContinue']>>('think_auto_continue');
if (current?.taskId === taskId && current.enabled === enabled) return current;
const preference = { taskId, enabled, version: (current?.version ?? 0) + 1, changedAt: Date.now() };
this.ctx.storage.kv.put('think_auto_continue', preference);
this.ctx.storage.kv.put(`think_auto_continue_audit:${taskId}:${preference.version}`, preference);
return preference;
}

private assertAutoAuthorization(approval: ThinkContinuationApproval): void {
if (approval.source !== 'auto') return;
const preference = this.ctx.storage.kv.get<NonNullable<ThinkTaskLifecycle['autoContinue']>>('think_auto_continue');
if (!preference?.enabled || preference.taskId !== approval.taskId
|| preference.version !== approval.preauthorizationVersion) {
throw new Error('Auto Continue is no longer enabled for this task.');
}
}

async approveTaskContinuation(approval: ThinkContinuationApproval): Promise<{
operationId: string; alreadyStarted: boolean;
}> {
// Ownership is inherited from the owner's host agent and its bound Think DO.
// Re-read after the digest await; reserve synchronously before another caller.
const key = `think_customer_approval:${approval.operationId}`;
const readCurrent = () => {
const operation = this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey);
if (!operation || approval.taskId !== continuationTaskId(operation)) {
throw new Error('This task is no longer available to continue.');
}
return operation;
};
let current = readCurrent();
this.assertAutoAuthorization(approval);
let receipt = this.ctx.storage.kv.get<{ operationId: string }>(key);
if (receipt) {
if (approval.source !== 'auto' && current.taskId === approval.operationId) {
this.ctx.storage.kv.put(key, { ...receipt, source: 'manual', approvedAt: Date.now() });
}
return { ...receipt, alreadyStarted: current.taskId !== approval.operationId };
}
assertContinuationApproval(current, await this.getTaskLifecycle(), approval);
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
JSON.stringify([approval.taskId, approval.operationId]),
));
const operationId = 'think-approved:' + Array.from(new Uint8Array(digest))
.map(byte => byte.toString(16).padStart(2, '0')).join('');
current = readCurrent();
this.assertAutoAuthorization(approval);
receipt = this.ctx.storage.kv.get<{ operationId: string; source?: string; started?: boolean }>(key);
if (receipt) {
if (approval.source !== 'auto' && receipt.source === 'auto' && !receipt.started) {
this.ctx.storage.kv.put(key, { ...receipt, source: 'manual', manualApprovedAt: Date.now() });
}
return { ...receipt, alreadyStarted: current.taskId !== approval.operationId };
}
const lifecycle = this.ctx.storage.kv.get<ThinkTaskLifecycle>(this.taskLifecycleKey);
if (!lifecycle) throw new Error('This task is not ready to continue.');
assertContinuationApproval(current, lifecycle, approval);
this.ctx.storage.kv.put(`think_approved_start:${operationId}`, current);
this.ctx.storage.kv.put(key, {
operationId, taskId: approval.taskId, parentOperationId: approval.operationId,
source: approval.source ?? 'manual', approvedAt: Date.now(),
...(approval.source === 'auto' ? { preauthorizationVersion: approval.preauthorizationVersion } : {}),
});
return { operationId, alreadyStarted: false };
}

async beginTask(taskId: string, candidateConversationId: string, originalIntent?: string): Promise<ThinkTaskOperation> {
const receipt = resolveThinkCompletedTaskReplay(
taskId, this.ctx.storage.kv.get<ThinkTaskOperation>(`think_completed_task:${taskId}`),
);
if (receipt) return receipt;
		const existingOperation = this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey);
		const existingLifecycle = await this.getTaskLifecycle();
		const pendingStartIntent = this.ctx.storage.kv.get<string>(this.taskStartIntentKey);
		const startDecision = resolveThinkTaskStart(
			taskId,
			existingLifecycle.status,
			existingOperation,
			pendingStartIntent,
		);
		if (startDecision !== 'START_NEW' && existingOperation) {
			const normalizedOperation = recoverThinkTaskOperation(
				existingOperation,
				this.getConfig<ThinkAgentConfig>()?.operationLimits,
			);
			if (pendingStartIntent === taskId) {
				this.putTaskDiagnostic(this.taskLifecycleKey, {
					status: 'RUNNING',
					summary: 'Task is in progress.',
					updatedAt: Date.now(),
				} satisfies ThinkTaskLifecycle);
				this.putTaskDiagnostic(this.taskForcedStatusKey, 'RUNNING');
				this.putTaskDiagnostic(this.taskStartIntentKey, '');
			}
			this.putTaskDiagnostic(this.taskOperationKey, normalizedOperation);
			return normalizedOperation;
		}
// Keep a durable receipt before replacing the current task. Replaying an older
// persisted customer turn after a newer one must not create another allowance.
if (existingOperation && existingLifecycle.status !== 'RUNNING') {
this.ctx.storage.kv.put(`think_completed_task:${existingOperation.taskId}`, existingOperation);
const evidence = this.ctx.storage.kv.get<ThinkTaskEvidence>(this.taskEvidenceKey);
if (evidence) this.ctx.storage.kv.put(`think_completed_evidence:${existingOperation.taskId}`, evidence);
}
const approvedParent = this.ctx.storage.kv.get<ThinkTaskOperation>(`think_approved_start:${taskId}`);
if (approvedParent) {
const approvalReceipt = this.ctx.storage.kv.get<ThinkContinuationApproval>(
`think_customer_approval:${approvedParent.taskId}`,
);
if (approvalReceipt?.source === 'auto') {
this.assertAutoAuthorization({
taskId: continuationTaskId(approvedParent), operationId: approvedParent.taskId,
source: 'auto', preauthorizationVersion: approvalReceipt.preauthorizationVersion,
});
}
if (!existingOperation || existingOperation.taskId !== approvedParent.taskId) {
throw new Error('A newer customer request replaced this continuation.');
}
assertContinuationApproval(existingOperation, existingLifecycle, {
taskId: continuationTaskId(approvedParent), operationId: approvedParent.taskId,
});
}
let operation = {
...(approvedParent ? createApprovedThinkOperation(
approvedParent, taskId, this.getConfig<ThinkAgentConfig>()?.operationLimits ?? approvedParent.limits,
) : {
...createThinkTaskOperation(
				taskId,
				candidateConversationId,
				this.getConfig<ThinkAgentConfig>()?.operationLimits,
			),
customerTaskId: taskId,
...(originalIntent ? { originalIntent } : {}),
}),
			messageCountAtPassStart: (await this.getMessages()).length,
		};
		try {
			const current = await this.readCurrentRevisionEvidence('main');
			operation.startingHead = current.headCommitHash;
			operation = recordThinkOperation(operation, createThinkOperationFingerprint('workspace-operation', {
				path: undefined,
				fileState: 'not-applicable',
				contentFingerprint: null,
				headCommitHash: current.headCommitHash,
				workingTreeClean: current.workingTreeClean,
				workspaceStatusFingerprint: current.workspaceStatusFingerprint,
				discoveryFingerprint: null,
			}));
		} catch {
			// A missing workspace during initialization must not prevent Think from
			// starting; later concrete tool outcomes establish the progress state.
		}
		// Persist an explicit start intent before changing the terminal lifecycle.
if (approvedParent) {
const approvalReceipt = this.ctx.storage.kv.get<ThinkContinuationApproval>(
`think_customer_approval:${approvedParent.taskId}`);
if (approvalReceipt?.source === 'auto') this.assertAutoAuthorization({
taskId: continuationTaskId(approvedParent), operationId: approvedParent.taskId,
source: 'auto', preauthorizationVersion: approvalReceipt.preauthorizationVersion,
});
}
		// On recovery, a matching intent prevents an old terminal status from
		// acknowledging this new queue item if the worker stopped mid-initialization.
		this.putTaskDiagnostic(this.taskStartIntentKey, taskId);
		this.putTaskDiagnostic(this.taskLifecycleKey, {
			status: 'RUNNING',
			summary: 'Task is in progress.',
			updatedAt: Date.now(),
		} satisfies ThinkTaskLifecycle);
		this.putTaskDiagnostic(this.taskForcedStatusKey, 'RUNNING');
		this.putTaskDiagnostic(this.taskEvidenceKey, {
			preflightSucceeded: false,
			deploySucceeded: false,
			deployedCommitHash: null,
			headCommitHash: null,
			headBranch: null,
			workingTreeClean: false,
			previewCommitHash: null,
			previewBranch: null,
			browserClean: false,
			browserCommitHash: null,
			browserBranch: null,
			browserPreviewUrl: null,
			configuredPreviewUrl: this.getConfig<ThinkAgentConfig>()?.previewUrl ?? null,
			deployedPreviewUrl: null,
			deployedBranch: null,
		} satisfies ThinkTaskEvidence);
		this.putTaskDiagnostic(this.taskOperationKey, operation);
		this.putTaskDiagnostic(this.taskStartIntentKey, '');
		return operation;
	}

	async getTaskLifecycle(): Promise<ThinkTaskLifecycle> {
const lifecycle = this.ctx.storage.kv.get<ThinkTaskLifecycle>(this.taskLifecycleKey) ?? {
			status: 'RUNNING',
			summary: 'Task is in progress.',
			updatedAt: Date.now(),
		};
const operation = this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey);
const preference = this.ctx.storage.kv.get<NonNullable<ThinkTaskLifecycle['autoContinue']>>('think_auto_continue');
return {
...lifecycle,
...(operation ? { autoContinue: preference?.taskId === continuationTaskId(operation) ? preference
: { taskId: continuationTaskId(operation), enabled: false, version: 0, changedAt: 0 } } : {}),
};
	}

	async getTaskOperation(): Promise<ThinkTaskOperation | undefined> {
		return this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey);
	}

async getTaskLifecycleSnapshot(): Promise<{
lifecycle: ThinkTaskLifecycle; operation?: ThinkTaskOperation;
}> {
return {
lifecycle: await this.getTaskLifecycle(),
operation: this.ctx.storage.kv.get<ThinkTaskOperation>(this.taskOperationKey),
};
}

	async advanceTaskOperation(): Promise<ThinkTaskOperation> {
		const operation = await this.getTaskOperation();
		if (!operation) throw new Error('Cannot continue a Think task before beginTask');
		const advanced = advanceThinkTaskOperation(operation);
		this.putTaskDiagnostic(this.taskOperationKey, advanced);
		return advanced;
	}

	async markTaskChatStarted(): Promise<ThinkTaskOperation> {
		const operation = await this.getTaskOperation();
		if (!operation) throw new Error('Cannot start a Think chat before beginTask');
		const messages = await this.getMessages();
		const started = markThinkTaskChatStarted(operation, messages.length);
		this.putTaskDiagnostic(this.taskOperationKey, started);
		return started;
	}

	async recoverPendingTaskChat(prompt: string): Promise<ThinkPendingChatRecovery> {
		const operation = await this.getTaskOperation();
		if (!operation) return 'NOT_PERSISTED';
		const messages = await this.getMessages();
		const recovery = classifyThinkPendingChatRecovery(
			messages as unknown as Array<{ role: string; content?: unknown; parts?: Array<{ type?: string; text?: string }> }>,
			operation.messageCountAtPassStart,
			prompt,
			operation.pendingPromptKind === null && operation.completedPassCount > 0,
		);
		return recovery;
	}

	async markTaskChatResolved(): Promise<ThinkTaskOperation> {
		const operation = await this.getTaskOperation();
		if (!operation) throw new Error('Cannot resolve a Think chat before beginTask');
		const checkpoint = reserveThinkTaskResource(operation, 'checkpoint', Date.now());
		if (checkpoint.limitExceeded) {
			this.stopForResourceLimit(checkpoint.limitExceeded, checkpoint.operation);
			this.putTaskDiagnostic(this.taskOperationKey, checkpoint.operation);
			return checkpoint.operation;
		}
		const resolved = markThinkTaskChatResolved(checkpoint.operation);
		this.putTaskDiagnostic(this.taskOperationKey, resolved);
		return resolved;
	}

	async stopTask(status: ThinkTaskStatus, summary: string, reason?: string): Promise<void> {
		await this.saveTaskLifecycle({ status, summary, reason, updatedAt: Date.now() });
	}

	/**
	 * On the final allowed step, disable tools and prime a text-only wrap-up so
	 * the turn ends with a summary instead of a truncated tool call (see
	 * `prompts/max-steps.txt`).
	 *
	 * The primer is injected as a `user` turn, not an `assistant` one: Gemini's
	 * OpenAI-compat endpoint rejects any request whose final message is a model
	 * turn (`400 INVALID_ARGUMENT: Requests ending with a model turn are not
	 * supported`), and the prompt is a control directive that reads naturally as
	 * user input.
	 */
	override async beforeStep(ctx: PrepareStepContext): Promise<StepConfig | void> {
		withThinkDiagnosticSafety(() => { this.diagnosticStep = ctx.stepNumber + 1; });
		emitThinkDiagnostic('think.beforeStep', 'start', () => this.diagnosticContext());
		try {
		const config = this.getConfig<ThinkAgentConfig>();
		if ((await this.getTaskLifecycle()).status === 'INCOMPLETE_RESOURCE_LIMIT') {
			throw new Error('Think operation stopped at its cumulative resource limit.');
		}
		await this.reserveOperationResource('model');
if (this.turnUsage?.config.llmCalls.enabled && config) {
			await RateLimitService.enforceLLMCallsRateLimit(
				this.env,
				this.turnUsage.config,
				config.userId,
				'Think',
				'',
				false,
				this.turnUsage.hasCloudflareConfigured,
				{ creditCost: THINK_MODEL_CONFIG.creditCost, throwOnExceeded: false },
			);
		}
		await this.reserveOperationResource('checkpoint');
		if (ctx.stepNumber >= this.maxSteps - 1) {
			return {
				activeTools: [],
				toolChoice: 'none',
				messages: [...ctx.messages, { role: 'user', content: PROMPT_MAX_STEPS }],
			};
		}
		} catch (error) {
			emitThinkDiagnostic('think.beforeStep', 'error', () => this.diagnosticContext(), error);
			throw error;
		}
	}

	/**
	 * RPC entrypoint used by `ThinkCodingBehavior` to push model/space/prompt
	 * configuration. Called once per app, when the host behavior initializes a
	 * fresh agent (each app maps to its own ThinkAgent DO — and therefore its
	 * own session — keyed by `agentId`). Persisted in Think's `think_config`
	 * table (survives hibernation), so subsequent turns resolve
	 * `getModel()`/`getTools()`.
	 *
	 * The system prompt is frozen + persisted on its first render and served
	 * from cache afterwards (see the Sessions lifecycle). Re-render it here so
	 * THIS session's prompt is (re)loaded from the freshly pushed model/project
	 * config — the `system` context block (`configureSession`) reads config
	 * lazily, so a refresh is what actually pulls it in for a new app instead of
	 * any stale cached value.
	 */
/** Update future-operation policy only; persisted in-flight limits are untouched. */
async configureOperationLimits(limits: NonNullable<ThinkAgentConfig['operationLimits']>): Promise<void> {
const config = this.getConfig<ThinkAgentConfig>();
if (!config) throw new Error('Think operation configuration is unavailable.');
this.configure<ThinkAgentConfig>({
...config,
operationLimits: { ...config.operationLimits, ...parseThinkOperationLimits(limits) },
});
}

async configureVibe(config: ThinkAgentConfig): Promise<void> {
		this.configure<ThinkAgentConfig>(config);
		try {
			await this.session?.refreshSystemPrompt();
		} catch {
			// Session may not be wired yet on the very first configure; in that
			// case the initial freezeSystemPrompt() during chat() renders with
			// this config anyway.
		}
	}
}
