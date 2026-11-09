import { decryptAiCredential } from '../../../shared/ai-credential-crypto';
import {
	classifyGatewayStatus,
	recordBuildEvent,
	safeBuildError,
	type BuildDiagnosticContext,
} from './build-diagnostics';

export type BuildProviderModelMetadata = {
	providerId?: string;
	modelId?: string;
	encryptedApiKey?: string | null;
	useStoredKeys?: boolean;
};

export function createBuildProviderFetch(options: {
	model: BuildProviderModelMetadata;
	db?: D1Database;
	buildDiagnostics: BuildDiagnosticContext | null;
	encryptionSecret?: string;
	fetchImpl?: typeof fetch;
	transformRequestBody?: (body: BodyInit | null | undefined) => BodyInit | null | undefined;
	transformResponseBody?: (body: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
}): typeof fetch {
	const fetchImpl = options.fetchImpl || fetch;
	return async (input, init) => {
		const headers = new Headers(init?.headers);
		if (options.model.encryptedApiKey) {
			try {
				if (!options.encryptionSecret) throw new Error();
				const apiKey = await decryptAiCredential(options.encryptionSecret, options.model.encryptedApiKey);
				headers.set('authorization', `Bearer ${apiKey}`);
			} catch {
				await recordBuildEvent(options.db, options.buildDiagnostics, {
					eventType: 'provider_configuration_failed',
					stage: 'provider_configuration',
					status: 'error',
					errorCode: 'PROVIDER_CONFIG_FAILED',
					provider: options.model.providerId,
					modelId: options.model.modelId,
				});
				throw new Error(safeBuildError('PROVIDER_CONFIG_FAILED').message);
			}
		}
		if (options.model.useStoredKeys) headers.delete('authorization');
		const body = options.transformRequestBody
			? options.transformRequestBody(init?.body)
			: init?.body;
		await recordBuildEvent(options.db, options.buildDiagnostics, {
			eventType: 'provider_request_started',
			stage: 'provider_request',
			status: 'active',
			provider: options.model.providerId,
			modelId: options.model.modelId,
		});

		let response: Response;
		try {
			response = await fetchImpl(input as RequestInfo, { ...(init ?? {}), headers, body });
		} catch {
			await recordBuildEvent(options.db, options.buildDiagnostics, {
				eventType: 'provider_request_failed',
				stage: 'provider_request',
				status: 'error',
				errorCode: 'PROVIDER_NETWORK_ERROR',
				provider: options.model.providerId,
				modelId: options.model.modelId,
			});
			throw new Error(safeBuildError('PROVIDER_NETWORK_ERROR').message);
		}

		const errorCode = classifyGatewayStatus(response.status);
		await recordBuildEvent(options.db, options.buildDiagnostics, {
			eventType: 'provider_response_received',
			stage: 'provider_response',
			status: errorCode ? 'error' : 'complete',
			errorCode: errorCode || undefined,
			provider: options.model.providerId,
			modelId: options.model.modelId,
providerStatus: response.status,
			correlationId: response.headers.get('cf-ray')?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128),
		});

		if (!response.body || !options.transformResponseBody) return response;
		const responseHeaders = new Headers(response.headers);
		responseHeaders.delete('content-length');
		responseHeaders.delete('content-encoding');
		return new Response(options.transformResponseBody(response.body), {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
		});
	};
}
