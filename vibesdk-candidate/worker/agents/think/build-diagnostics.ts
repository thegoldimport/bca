export type BuildAttemptStatus = 'running' | 'completed' | 'failed';
export type BuildEventStatus = 'active' | 'complete' | 'error' | 'info';

export type BuildErrorCode =
	| 'PROVIDER_AUTH_FAILED'
	| 'PROVIDER_BILLING_FAILED'
	| 'PROVIDER_RATE_LIMITED'
	| 'PROVIDER_REQUEST_REJECTED'
	| 'PROVIDER_UNAVAILABLE'
	| 'PROVIDER_NETWORK_ERROR'
	| 'PROVIDER_CONFIG_FAILED'
	| 'AGENT_TOOL_FAILED'
	| 'PREVIEW_BUILD_FAILED'
	| 'PREVIEW_UNAVAILABLE'
	| 'BUILD_RUNTIME_FAILED';

export type BuildEventType =
	| 'agent_connection_established'
	| 'build_request_received'
	| 'provider_configuration_resolved'
	| 'provider_configuration_failed'
	| 'provider_request_started'
	| 'provider_request_failed'
	| 'provider_response_received'
	| 'agent_generation_started'
	| 'tool_execution_started'
	| 'tool_execution_failed'
	| 'file_changed'
	| 'validation_started'
	| 'validation_completed'
	| 'preview_generated'
	| 'build_completed'
	| 'build_failed';

export type BuildStage =
	| 'agent_connection'
	| 'build_request'
	| 'provider_configuration'
	| 'provider_request'
	| 'provider_response'
	| 'agent_generation'
	| 'tool_execution'
	| 'file_write'
	| 'validation'
	| 'preview'
	| 'build';

export type BuildDiagnosticContext = {
	attemptId: string;
	projectId: number;
	userId: string;
	agentId: string;
};

export type BuildDiagnosticInput = {
	eventType: BuildEventType;
	stage: BuildStage;
	status: BuildEventStatus;
	errorCode?: BuildErrorCode;
	provider?: string;
	modelId?: string;
	providerStatus?: number;
	correlationId?: string;
};

export type BuildDiagnosticDatabase = Pick<D1Database, 'prepare' | 'batch'>;

const EVENT_MESSAGES: Record<BuildEventType, string> = {
	agent_connection_established: 'Connected to the coding agent.',
	build_request_received: 'Build request received.',
	provider_configuration_resolved: 'AI provider settings were loaded.',
	provider_configuration_failed: 'AI provider settings could not be applied.',
	provider_request_started: 'AI provider request started.',
	provider_request_failed: 'The runtime could not complete the AI provider request.',
	provider_response_received: 'The AI provider returned a response.',
	agent_generation_started: 'The coding agent started processing the request.',
	tool_execution_started: 'The coding agent started a workspace action.',
	tool_execution_failed: 'The coding agent could not complete a workspace action.',
	file_changed: 'A project file was created or modified.',
	validation_started: 'Build validation started.',
	validation_completed: 'Build validation completed.',
	preview_generated: 'A preview was generated.',
	build_completed: 'The coding agent completed this turn without a reported runtime error.',
	build_failed: 'The build attempt stopped before completion.',
};

const ERROR_MESSAGES: Record<BuildErrorCode, string> = {
	PROVIDER_AUTH_FAILED: 'The AI provider rejected the configured credentials. Check your provider settings.',
	PROVIDER_BILLING_FAILED: 'The AI provider rejected the request because of account or billing limits. Check your provider account.',
	PROVIDER_RATE_LIMITED: 'The AI provider temporarily limited requests. Wait a moment, then retry.',
	PROVIDER_REQUEST_REJECTED: 'The AI provider rejected the request. Check the selected model and provider settings.',
	PROVIDER_UNAVAILABLE: 'The AI provider is temporarily unavailable. Try again later.',
	PROVIDER_NETWORK_ERROR: 'The runtime could not reach the AI provider. Try again later.',
	PROVIDER_CONFIG_FAILED: 'The saved AI provider settings could not be applied. No other provider was used.',
	AGENT_TOOL_FAILED: 'The coding agent could not complete a workspace action.',
	PREVIEW_BUILD_FAILED: 'Project validation or preview generation failed.',
	PREVIEW_UNAVAILABLE: 'The project may be saved, but its live preview could not be opened.',
	BUILD_RUNTIME_FAILED: 'The coding agent stopped before completing the request. Review this attempt before retrying.',
};

export function safeBuildError(code: BuildErrorCode): { code: BuildErrorCode; message: string } {
	return { code, message: ERROR_MESSAGES[code] };
}

export function classifyGatewayStatus(status: number): BuildErrorCode | null {
	if (!Number.isInteger(status) || status < 100 || status > 599 || status < 400) return null;
	if (status === 401 || status === 403) return 'PROVIDER_AUTH_FAILED';
	if (status === 402) return 'PROVIDER_BILLING_FAILED';
	if (status === 429) return 'PROVIDER_RATE_LIMITED';
	if (status === 400 || status === 422) return 'PROVIDER_REQUEST_REJECTED';
	if (status >= 500) return 'PROVIDER_UNAVAILABLE';
	return 'PROVIDER_REQUEST_REJECTED';
}

function safeProvider(value: string | undefined): string | null {
	if (!value) return null;
	const normalized = value.toLowerCase();
	return /^[a-z0-9_-]{1,32}$/.test(normalized) ? normalized : null;
}

function safeModelId(value: string | undefined): string | null {
	if (!value || value.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)) return null;
	return value;
}

function safeCorrelationId(value: string | undefined): string | null {
	if (!value || value.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(value)) return null;
	return value;
}

export async function startBuildAttempt(
	db: BuildDiagnosticDatabase | undefined,
	input: { userId: string; agentId: string },
): Promise<BuildDiagnosticContext | null> {
	if (!db || !input.userId || !input.agentId) return null;
	try {
		const project = await db.prepare(
			`SELECT p.id AS project_id,p.user_id
			 FROM runtime_project_links l
			 JOIN projects p ON p.id=l.project_id
			 WHERE l.agent_id=? AND p.user_id=? AND l.runtime_provider='stock-think'
			 LIMIT 1`,
		).bind(input.agentId, input.userId).first<{ project_id: number; user_id: string }>();
		if (!project || !Number.isSafeInteger(Number(project.project_id)) || project.user_id !== input.userId) return null;

		const context: BuildDiagnosticContext = {
			attemptId: crypto.randomUUID(),
			projectId: Number(project.project_id),
			userId: input.userId,
			agentId: input.agentId,
		};
		const startedAt = Date.now();
		await db.batch([
			db.prepare(
				`INSERT INTO native_build_attempts
				 (attempt_id,project_id,user_id,agent_id,started_at_ms,status,last_stage,correlation_id)
				 VALUES(?,?,?,?,?,'running','build_request',?)`,
			).bind(context.attemptId, context.projectId, context.userId, context.agentId, startedAt, context.attemptId),
			db.prepare(
				`INSERT INTO native_build_events
				 (id,attempt_id,occurred_at_ms,event_type,stage,status,customer_message,correlation_id)
				 VALUES(?,?,?,'agent_connection_established','agent_connection','complete',?,?)`,
			).bind(crypto.randomUUID(), context.attemptId, startedAt, EVENT_MESSAGES.agent_connection_established, context.attemptId),
			db.prepare(
				`INSERT INTO native_build_events
				 (id,attempt_id,occurred_at_ms,event_type,stage,status,customer_message,correlation_id)
				 VALUES(?,?,?,'build_request_received','build_request','complete',?,?)`,
			).bind(crypto.randomUUID(), context.attemptId, startedAt, EVENT_MESSAGES.build_request_received, context.attemptId),
		]);
		return context;
	} catch {
		// Diagnostics must not prevent the customer's actual build from running.
		return null;
	}
}

export async function recordBuildEvent(
	db: BuildDiagnosticDatabase | undefined,
	context: BuildDiagnosticContext | null | undefined,
	input: BuildDiagnosticInput,
): Promise<void> {
	if (!db || !context) return;
	try {
		const occurredAt = Date.now();
		const error = input.errorCode ? safeBuildError(input.errorCode) : null;
		const provider = safeProvider(input.provider);
		const modelId = safeModelId(input.modelId);
		const providerStatus = Number.isInteger(input.providerStatus) && input.providerStatus! >= 100 && input.providerStatus! <= 599
			? input.providerStatus! : null;
		const correlationId = safeCorrelationId(input.correlationId) || context.attemptId;
		const terminal = input.eventType === 'build_completed' || input.eventType === 'build_failed';
		const nextAttemptStatus: BuildAttemptStatus | null = input.eventType === 'build_completed'
			? 'completed' : input.eventType === 'build_failed' ? 'failed' : null;
		const update = db.prepare(
			`UPDATE native_build_attempts
			 SET last_stage=?,
			     last_successful_stage=CASE WHEN ?='complete' THEN ? ELSE last_successful_stage END,
			     failure_stage=CASE WHEN ?='error' THEN ? ELSE failure_stage END,
			     error_code=COALESCE(?,error_code),
			     customer_message=COALESCE(?,customer_message),
			     provider=COALESCE(?,provider),
			     model_id=COALESCE(?,model_id),
			     correlation_id=COALESCE(?,correlation_id),
			     status=COALESCE(?,status),
			     finished_at_ms=CASE WHEN ?=1 THEN ? ELSE finished_at_ms END
			 WHERE attempt_id=? AND project_id=? AND user_id=? AND agent_id=? AND status='running'`,
		).bind(
			input.stage, input.status, input.stage, input.status, input.stage,
			error?.code || null, error?.message || null, provider, modelId, correlationId,
			nextAttemptStatus, terminal ? 1 : 0, terminal ? occurredAt : null,
			context.attemptId, context.projectId, context.userId, context.agentId,
		);
		const insert = db.prepare(
			`INSERT INTO native_build_events
			 (id,attempt_id,occurred_at_ms,event_type,stage,status,error_code,customer_message,provider_status,correlation_id)
			 SELECT ?,?,?,?,?,?,?,?,?,?
			 WHERE EXISTS (
			   SELECT 1 FROM native_build_attempts
			   WHERE attempt_id=? AND project_id=? AND user_id=? AND agent_id=?
			 )`,
		).bind(
			crypto.randomUUID(), context.attemptId, occurredAt, input.eventType, input.stage,
			input.status, error?.code || null, error?.message || EVENT_MESSAGES[input.eventType],
			providerStatus, correlationId, context.attemptId, context.projectId, context.userId, context.agentId,
		);
		await db.batch([update, insert]);
	} catch {
		// Never include exception text: provider/client errors can contain secrets or customer content.
	}
}

const BUILD_ERROR_CODES = new Set<BuildErrorCode>([
	'PROVIDER_AUTH_FAILED',
	'PROVIDER_BILLING_FAILED',
	'PROVIDER_RATE_LIMITED',
	'PROVIDER_REQUEST_REJECTED',
	'PROVIDER_UNAVAILABLE',
	'PROVIDER_NETWORK_ERROR',
	'PROVIDER_CONFIG_FAILED',
	'AGENT_TOOL_FAILED',
	'PREVIEW_BUILD_FAILED',
	'PREVIEW_UNAVAILABLE',
	'BUILD_RUNTIME_FAILED',
]);

export async function latestBuildErrorCode(
	db: BuildDiagnosticDatabase | undefined,
	context: BuildDiagnosticContext | null | undefined,
): Promise<BuildErrorCode | null> {
	if (!db || !context) return null;
	try {
		const row = await db.prepare(
			`SELECT error_code FROM native_build_events
			 WHERE attempt_id=? AND stage IN ('provider_configuration','provider_request','provider_response')
			   AND status='error' AND error_code IS NOT NULL
			 ORDER BY occurred_at_ms DESC LIMIT 1`,
		).bind(context.attemptId).first<{ error_code: string }>();
		return row && BUILD_ERROR_CODES.has(row.error_code as BuildErrorCode)
			? row.error_code as BuildErrorCode : null;
	} catch {
		return null;
	}
}
