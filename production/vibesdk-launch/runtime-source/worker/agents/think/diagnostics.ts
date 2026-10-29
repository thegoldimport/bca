/**
 * Best-effort, metadata-only diagnostics. Arbitrary error messages, stack
 * headers, WebSocket reasons, and runtime objects are never written to logs.
 */
export interface ThinkDiagnosticContext {
	agentId?: string;
	userId?: string;
	projectId?: string;
	sessionId?: string;
	nativeRequestId?: string;
	conversationId?: string;
	operationId?: string;
	turn?: number;
	step?: number;
	toolName?: string;
	toolCallId?: string;
	continuationCount?: number;
	completedPassCount?: number;
	pendingPromptKind?: 'INITIAL' | 'CONTINUATION' | null;
	operationState?: 'RUNNING' | 'COMPLETE' | 'BLOCKED' | 'USER_INPUT_REQUIRED' | 'INCOMPLETE_RESOURCE_LIMIT';
	modelCalls?: number;
	toolCalls?: number;
	checkpointCount?: number;
	readyState?: number;
	closeCode?: number;
	wasClean?: boolean;
	decision?: 'STOP' | 'CONTINUE' | 'BLOCKED' | 'INCOMPLETE_RESOURCE_LIMIT';
	streamStatus?: 'completed' | 'aborted' | 'error';
	stage?: 'parse' | 'persist' | 'turn' | 'stream' | 'recovery' | 'transcript';
	chunkType?: string;
	aborted?: boolean;
	httpStatus?: number;
	finishReason?: string;
	inputTokens?: number;
	outputTokens?: number;
	storageKey?: string;
}

export type ThinkDiagnosticContextSource =
	| ThinkDiagnosticContext
	| (() => ThinkDiagnosticContext);

interface SafeThinkDiagnosticFrame {
	file: string;
	line: number;
	column: number;
}

interface SafeThinkDiagnosticError {
	name: string;
	code?: string;
	frames?: SafeThinkDiagnosticFrame[];
	cause?: SafeThinkDiagnosticError | { circular: true } | { truncated: true };
}

const boundaryNames = new Set([
	'operation.persistence',
	'think.stream-result',
	'tool.execution',
	'think.onStepFinish',
	'tool.execute-and-evidence',
	'think.beforeStep',
	'rpc.callback',
	'stream.forwarding',
	'rpc.callback.onDone',
	'rpc.callback.onError',
	'rpc.callback.onError.delivery',
	'driver.initial-lifecycle',
	'driver.recover-pending-chat',
	'driver.recovery-decision',
	'driver.mark-chat-started',
	'driver.chat',
	'driver.error-lifecycle',
	'driver.mark-chat-resolved',
	'driver.post-chat-lifecycle',
	'driver.post-chat-operation',
	'driver.post-chat-decision',
	'driver.onPassEnd',
	'host.websocket',
	'host.stub.chat',
	'host.pass',
]);

const eventNames = new Set([
	'start',
	'resolved',
	'error',
	'close',
	'decision',
	'forwarded',
	'interrupted',
	'response-hook',
	'put-returned',
	'success',
]);

const errorNames = new Set([
	'Error',
	'TypeError',
	'RangeError',
	'ReferenceError',
	'SyntaxError',
	'URIError',
	'EvalError',
	'AggregateError',
	'DOMException',
	'AbortError',
	'DataCloneError',
	'NetworkError',
	'TimeoutError',
	'NotFoundError',
	'InvalidStateError',
	'OperationError',
	'SecurityError',
	'AI_APICallError',
	'AI_RetryError',
	'AI_TypeValidationError',
	'AI_InvalidResponseDataError',
	'AI_NoOutputGeneratedError',
	'AI_JSONParseError',
	'AI_InvalidToolInputError',
]);

const errorCodes = new Set([
	'ERR_RPC_CANCELED',
	'RPC_CANCELED',
	'ABORT_ERR',
	'ECONNRESET',
	'ETIMEDOUT',
	'EPIPE',
]);

const toolNames = new Set([
	'read',
	'write',
	'edit',
	'list',
	'find',
	'grep',
	'delete',
	'ask_questions',
	'browser_console_logs',
	'deploy_space',
	'commit',
	'set_title',
	'finish_task',
]);

const operationStates = new Set([
	'RUNNING',
	'COMPLETE',
	'BLOCKED',
	'USER_INPUT_REQUIRED',
	'INCOMPLETE_RESOURCE_LIMIT',
]);
const decisions = new Set(['STOP', 'CONTINUE', 'BLOCKED', 'INCOMPLETE_RESOURCE_LIMIT']);
const chunkTypes = new Set(['start-step', 'finish-step', 'tool-output-available']);
const finishReasons = new Set(['stop', 'length', 'tool-calls', 'content-filter', 'unknown']);
const sdkStages = new Set(['parse', 'persist', 'turn', 'stream', 'recovery', 'transcript']);
const storageKeys = new Set([
	'think_task_lifecycle',
	'think_task_evidence',
	'think_task_operation',
	'think_task_forced_status',
	'think_task_start_intent',
]);
const internalSourceFiles = new Set([
	'ThinkAgent.ts',
	'stream-forwarder.ts',
	'finish-task-tool.ts',
	'diagnostics.ts',
	'context-selector.ts',
	'browser-evidence.ts',
	'browser-logs-tool.ts',
	'deploy-tool.ts',
	'commit-tool.ts',
	'ask-questions-tool.ts',
	'set-title-tool.ts',
	'space-workspace-ops.ts',
]);
const internalWorkerFiles = new Set(['index.js']);
const internalThinkPackageFile = 'node_modules/@cloudflare/think/dist/think.js';

const contextKeys = [
	'agentId',
	'userId',
	'projectId',
	'sessionId',
	'nativeRequestId',
	'conversationId',
	'operationId',
	'turn',
	'step',
	'toolName',
	'toolCallId',
	'continuationCount',
	'completedPassCount',
	'pendingPromptKind',
	'operationState',
	'modelCalls',
	'toolCalls',
	'checkpointCount',
	'readyState',
	'closeCode',
	'wasClean',
	'decision',
	'streamStatus',
	'stage',
	'chunkType',
	'aborted',
	'httpStatus',
	'finishReason',
	'inputTokens',
	'outputTokens',
	'storageKey',
] as const;

const identifierKeys = new Set([
	'agentId',
	'userId',
	'projectId',
	'sessionId',
	'nativeRequestId',
	'conversationId',
	'operationId',
	'toolCallId',
]);

const numericKeys = new Set([
	'turn',
	'step',
	'continuationCount',
	'completedPassCount',
	'modelCalls',
	'toolCalls',
	'checkpointCount',
	'readyState',
	'closeCode',
	'httpStatus',
	'inputTokens',
	'outputTokens',
]);

function isBoundedInteger(value: unknown, min = 0, max = 1_000_000): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function safeContextValue(key: string, value: unknown): string | number | boolean | undefined {
	if (identifierKeys.has(key)) {
		return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
			? value
			: undefined;
	}
	if (numericKeys.has(key)) {
		if (key === 'readyState') return isBoundedInteger(value, 0, 3) ? value : undefined;
		if (key === 'closeCode') return isBoundedInteger(value, 0, 4999) ? value : undefined;
		if (key === 'httpStatus') return isBoundedInteger(value, 100, 599) ? value : undefined;
		return isBoundedInteger(value) ? value : undefined;
	}
	if (key === 'wasClean' || key === 'aborted') {
		return typeof value === 'boolean' ? value : undefined;
	}
	if (key === 'toolName') {
		return typeof value === 'string' && toolNames.has(value) ? value : undefined;
	}
	if (key === 'operationState') {
		return typeof value === 'string' && operationStates.has(value) ? value : undefined;
	}
	if (key === 'decision') {
		return typeof value === 'string' && decisions.has(value) ? value : undefined;
	}
	if (key === 'pendingPromptKind') {
		return value === 'INITIAL' || value === 'CONTINUATION' ? value : undefined;
	}
	if (key === 'streamStatus') {
		return value === 'completed' || value === 'aborted' || value === 'error' ? value : undefined;
	}
	if (key === 'chunkType') {
		return typeof value === 'string' && chunkTypes.has(value) ? value : undefined;
	}
	if (key === 'finishReason') {
		return typeof value === 'string' && finishReasons.has(value) ? value : undefined;
	}
	if (key === 'stage') {
		return typeof value === 'string' && sdkStages.has(value) ? value : undefined;
	}
	if (key === 'storageKey') {
		return typeof value === 'string' && storageKeys.has(value) ? value : undefined;
	}
	return undefined;
}

function safeFrames(stack: unknown): SafeThinkDiagnosticFrame[] | undefined {
	if (typeof stack !== 'string') return undefined;
	const frames: SafeThinkDiagnosticFrame[] = [];
	const lines = stack.slice(0, 12_000).split('\n');
	for (const line of lines) {
		if (frames.length === 5) break;
		const trimmed = line.trim();
		if (!trimmed.startsWith('at ')) continue;
		let location = trimmed.slice(3);
		const openParen = location.lastIndexOf(' (');
		if (openParen >= 0 && location.endsWith(')')) {
			location = location.slice(openParen + 2, -1);
		}
		const match = location.match(/^(.*):([1-9]\d{0,5}):([1-9]\d{0,5})$/);
		if (!match) continue;
		const sourceLocation = match[1];
		let file: string | undefined;
		if (internalWorkerFiles.has(sourceLocation)) {
			file = sourceLocation;
		} else if (
			sourceLocation === internalThinkPackageFile ||
			(sourceLocation.endsWith(`/${internalThinkPackageFile}`) &&
				/^[A-Za-z0-9_./-]+$/.test(sourceLocation) &&
				!sourceLocation.split('/').includes('..'))
		) {
			file = 'think.js';
		} else {
			const sourceMatch = sourceLocation.match(/^(?:\.\/)?worker\/agents\/think\/([A-Za-z0-9-]+\.ts)$/);
			if (sourceMatch && internalSourceFiles.has(sourceMatch[1])) file = sourceMatch[1];
		}
		if (!file) continue;
		const lineNumber = Number(match[2]);
		const column = Number(match[3]);
		if (!Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(column)) continue;
		frames.push({ file, line: lineNumber, column });
	}
	return frames.length ? frames : undefined;
}

function readProperty(value: object, key: string): { read: true; value: unknown } | { read: false } {
	try {
		return { read: true, value: (value as Record<string, unknown>)[key] };
	} catch {
		return { read: false };
	}
}

function serializeErrorAtDepth(
	error: unknown,
	depth: number,
	seen: Set<object>,
): SafeThinkDiagnosticError | { circular: true } | { truncated: true } {
	if (depth > 3) return { truncated: true };
	if (error === null) return { name: 'UnknownError' };
	if (typeof error !== 'object' && typeof error !== 'function') {
		return { name: typeof error === 'string' ? 'ThrownString' : 'UnknownError' };
	}
	if (seen.has(error)) return { circular: true };
	seen.add(error);

	const record: SafeThinkDiagnosticError = { name: 'UnknownError' };
	const name = readProperty(error, 'name');
	if (name.read && typeof name.value === 'string' && errorNames.has(name.value)) {
		record.name = name.value;
	}
	const code = readProperty(error, 'code');
	if (code.read && typeof code.value === 'string' && errorCodes.has(code.value)) {
		record.code = code.value;
	}
	const stack = readProperty(error, 'stack');
	if (stack.read) {
		const frames = safeFrames(stack.value);
		if (frames) record.frames = frames;
	}
	if (depth < 3) {
		const cause = readProperty(error, 'cause');
		if (cause.read && cause.value !== undefined) {
			record.cause = serializeErrorAtDepth(cause.value, depth + 1, seen);
		}
	}
	return record;
}

/**
 * Returns an allowlisted error classification only. Message text and arbitrary
 * properties are never read or emitted.
 */
export function serializeThinkDiagnosticError(error: unknown): SafeThinkDiagnosticError | undefined {
	try {
		const safeError = serializeErrorAtDepth(error, 0, new Set());
		return 'name' in safeError ? safeError : { name: 'UnknownError' };
	} catch {
		return undefined;
	}
}

/** Run diagnostic-only work without allowing it to escape into application flow. */
export function withThinkDiagnosticSafety(fn: () => void): void {
	try {
		fn();
	} catch {
		// Diagnostics are best-effort; application behavior always wins.
	}
}

export function emitThinkDiagnostic(
	boundary: string,
	event: string,
	context: ThinkDiagnosticContextSource = {},
	error?: unknown,
): void {
	withThinkDiagnosticSafety(() => {
		if (!boundaryNames.has(boundary) || !eventNames.has(event)) return;

		const record: Record<string, unknown> = {
			schema: 1,
			timestamp: new Date().toISOString(),
			boundary,
			event,
		};
		const metadata = typeof context === 'function' ? context() : context;
		if (metadata !== null && typeof metadata === 'object') {
			for (const key of contextKeys) {
				const candidate = readProperty(metadata, key);
				if (!candidate.read) continue;
				const safeValue = safeContextValue(key, candidate.value);
				if (safeValue !== undefined) record[key] = safeValue;
			}
		}
		if (error !== undefined) {
			const safeError = serializeThinkDiagnosticError(error);
			if (safeError !== undefined) record.error = safeError;
		}

		// Validate JSON formatting while still inside the non-interference boundary.
		const json = JSON.stringify(record);
		if (json !== undefined) console.info('THINK_DIAGNOSTIC', record);
	});
}

export async function observeThinkBoundary<T>(
	boundary: string,
	context: ThinkDiagnosticContextSource,
	operation: () => Promise<T>,
): Promise<T> {
	emitThinkDiagnostic(boundary, 'start', context);
	try {
		const result = await operation();
		emitThinkDiagnostic(boundary, 'resolved', context);
		return result;
	} catch (error) {
		emitThinkDiagnostic(boundary, 'error', context, error);
		throw error;
	}
}

export function observeThinkBoundarySync<T>(
	boundary: string,
	context: ThinkDiagnosticContextSource,
	operation: () => T,
): T {
	try {
		const result = operation();
		emitThinkDiagnostic(boundary, 'resolved', context);
		return result;
	} catch (error) {
		emitThinkDiagnostic(boundary, 'error', context, error);
		throw error;
	}
}