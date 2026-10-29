import type { ModelMessage } from 'ai';

const RECENT_MESSAGE_COUNT = 5;
const CONTINUATION_RECENT_MESSAGE_COUNT = 2;
export const THINK_INTERNAL_CONTINUATION_PREFIX = '__THINK_INTERNAL_CONTINUATION__:';
const CONTINUATION_DISCOVERY_TOOL_COUNT = 1;

type MessagePart = {
	type?: string;
	toolName?: string;
	toolCallId?: string;
};

function partsOf(message: ModelMessage): MessagePart[] {
	return Array.isArray(message.content) ? (message.content as MessagePart[]) : [];
}

function toolCallIds(message: ModelMessage): Set<string> {
	if (message.role !== 'assistant') return new Set();
	return new Set(
		partsOf(message)
			.filter((part) => part.type === 'tool-call' && typeof part.toolCallId === 'string')
			.map((part) => part.toolCallId as string),
	);
}

function toolResultIds(message: ModelMessage): Set<string> {
	if (message.role !== 'tool') return new Set();
	return new Set(
		partsOf(message)
			.filter((part) => part.type === 'tool-result' && typeof part.toolCallId === 'string')
			.map((part) => part.toolCallId as string),
	);
}

function containsToolCall(message: ModelMessage, toolName: string): boolean {
	return (
		message.role === 'assistant' &&
		partsOf(message).some(
			(part) => part.type === 'tool-call' && part.toolName === toolName,
		)
	);
}

function hasText(message: ModelMessage): boolean {
	if (message.role !== 'user' && message.role !== 'assistant') return false;
	if (typeof message.content === 'string') return message.content.trim().length > 0;
	return partsOf(message).some(
		(part) => part.type === 'text' && 'text' in part && typeof part.text === 'string' && part.text.trim().length > 0,
	);
}

function includeNamedToolPair(
	messages: ModelMessage[],
	selected: Set<number>,
	protectedToolMessages: Set<number>,
	callIndex: number,
): void {
	selected.add(callIndex);
	protectedToolMessages.add(callIndex);
	const calls = toolCallIds(messages[callIndex]);
	for (let candidate = callIndex + 1; candidate < messages.length; candidate++) {
		if (messages[candidate].role !== 'tool') break;
		const results = toolResultIds(messages[candidate]);
		if ([...results].some((id) => calls.has(id))) {
			selected.add(candidate);
			protectedToolMessages.add(candidate);
		}
	}
}

export function selectThinkContextMessages(messages: ModelMessage[]): ModelMessage[] {
	if (messages.length === 0) return [];
	const isInternalContinuation = (message: ModelMessage): boolean =>
		message.role === 'user' &&
		typeof message.content === 'string' &&
		message.content.startsWith(THINK_INTERNAL_CONTINUATION_PREFIX);
	const continuationContext = messages.some(isInternalContinuation);
	let latestContinuationIndex = -1;
	if (continuationContext) {
		for (let index = messages.length - 1; index >= 0; index--) {
			if (isInternalContinuation(messages[index])) {
				latestContinuationIndex = index;
				break;
			}
		}
	}

	const selected = new Set<number>([0]);
	const protectedToolMessages = new Set<number>();
	const latestSpecialCall = new Map<string, number>();
	if (continuationContext) {
		for (let index = messages.length - 1; index >= 0; index--) {
			for (const toolName of ['ask_questions', 'activate_skill', 'set_title']) {
				if (containsToolCall(messages[index], toolName) && !latestSpecialCall.has(toolName)) {
					latestSpecialCall.set(toolName, index);
				}
			}
		}
	}
	let recentTextCount = 0;
	const recentMessageLimit = continuationContext ? CONTINUATION_RECENT_MESSAGE_COUNT : RECENT_MESSAGE_COUNT;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (isInternalContinuation(messages[index])) {
			if (index === latestContinuationIndex) selected.add(index);
			continue;
		}
		if (!hasText(messages[index])) continue;
		selected.add(index);
		recentTextCount++;
		if (recentTextCount >= recentMessageLimit) break;
	}
	if (continuationContext) {
		for (let index = messages.length - 1; index >= 0; index--) {
			if (messages[index].role === 'user' && !isInternalContinuation(messages[index])) {
				selected.add(index);
				break;
			}
		}
	}

	for (let index = 0; index < messages.length; index++) {
		if (containsToolCall(messages[index], 'ask_questions')) {
			if (continuationContext && latestSpecialCall.get('ask_questions') !== index) continue;
			includeNamedToolPair(messages, selected, protectedToolMessages, index);
			for (let candidate = index + 1; candidate < messages.length; candidate++) {
				if (messages[candidate].role === 'user') {
					selected.add(candidate);
					break;
				}
			}
		}
		if (
			containsToolCall(messages[index], 'activate_skill') ||
			containsToolCall(messages[index], 'set_title')
		) {
			if (
				continuationContext &&
				((containsToolCall(messages[index], 'activate_skill') && latestSpecialCall.get('activate_skill') !== index) ||
					(containsToolCall(messages[index], 'set_title') && latestSpecialCall.get('set_title') !== index))
			) continue;
			includeNamedToolPair(messages, selected, protectedToolMessages, index);
		}
	}

	// A continuation should retain only the latest few targeted discovery calls,
	// with their corresponding results. This avoids replaying the entire tool
	// transcript while preserving recent evidence needed to make progress.
	if (continuationContext) {
		let discoveryCalls = 0;
		for (let index = messages.length - 1; index >= 0 && discoveryCalls < CONTINUATION_DISCOVERY_TOOL_COUNT; index--) {
			const message = messages[index];
			if (
				message.role !== 'assistant' ||
				!partsOf(message).some(
					(part) => part.type === 'tool-call' &&
						typeof part.toolName === 'string' &&
						['read', 'find', 'grep', 'list'].includes(part.toolName),
				)
			) continue;
			includeNamedToolPair(messages, selected, protectedToolMessages, index);
			discoveryCalls++;
		}
	}

	return messages.flatMap((message, index) => {
		if (!selected.has(index)) return [];
		if (
			message.role !== 'assistant' ||
			protectedToolMessages.has(index) ||
			!Array.isArray(message.content)
		) {
			return [message];
		}
		const textContent = message.content.filter((part) => part.type !== 'tool-call');
		return textContent.length > 0 ? [{ ...message, content: textContent }] : [];
	});
}
