/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';

import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import type { AgentHostChannelId } from 'cs/platform/agentHost/common/identities';
import { assertAgentHostReconnectResult, assertAgentHostSetSubscriptionsResult } from 'cs/platform/agentHost/common/protocol';

export interface IAgentHostSubscriptionConformanceScenario {
	readonly connection: IAgentHostConnection;
	readonly removedChannel: AgentHostChannelId;
	readonly retainedChannel: AgentHostChannelId;
	readonly missingChannel: AgentHostChannelId;
	readonly publishRemovedAndRetained: () => Promise<void>;
}

/** Exercises exact subscription replacement and reconnect over any Agent Host transport. */
export async function runAgentHostSubscriptionConformanceScenario(
	scenario: IAgentHostSubscriptionConformanceScenario,
): Promise<void> {
	const initialRequest = Object.freeze({
		subscriptions: Object.freeze([
			scenario.removedChannel,
			scenario.retainedChannel,
			scenario.missingChannel,
		]),
	});
	const initial = await scenario.connection.setSubscriptions(initialRequest);
	assertAgentHostSetSubscriptionsResult(initialRequest, initial);
	assert.deepStrictEqual(initial.snapshots.map(snapshot => snapshot.channel), [
		scenario.removedChannel,
		scenario.retainedChannel,
	]);
	assert.deepStrictEqual(initial.missingChannels.map(missing => missing.channel), [scenario.missingChannel]);

	const replacementRequest = Object.freeze({
		subscriptions: Object.freeze([scenario.retainedChannel, scenario.missingChannel]),
	});
	const replacement = await scenario.connection.setSubscriptions(replacementRequest);
	assertAgentHostSetSubscriptionsResult(replacementRequest, replacement);
	assert.deepStrictEqual(replacement.snapshots.map(snapshot => snapshot.channel), [scenario.retainedChannel]);
	assert.deepStrictEqual(replacement.missingChannels.map(missing => missing.channel), [scenario.missingChannel]);

	const received: AgentHostChannelId[] = [];
	const listener = scenario.connection.onDidReceiveAction(action => received.push(action.channel));
	try {
		await scenario.publishRemovedAndRetained();
	} finally {
		listener.dispose();
	}
	assert.deepStrictEqual(received, [scenario.retainedChannel]);

	const reconnectRequest = Object.freeze({
		connection: scenario.connection.connection,
		lastHostSequence: replacement.hostSequence,
		subscriptions: Object.freeze([scenario.retainedChannel]),
	});
	const reconnect = await scenario.connection.reconnect(reconnectRequest);
	assertAgentHostReconnectResult(reconnectRequest, reconnect);
	if (reconnect.kind === 'replay') {
		assert.ok(reconnect.actions.every(action => action.channel === scenario.retainedChannel));
	}

	for (const subscriptions of [
		[scenario.retainedChannel, scenario.missingChannel],
		[scenario.removedChannel, scenario.retainedChannel],
	]) {
		await assert.rejects(
			scenario.connection.reconnect({
				connection: scenario.connection.connection,
				lastHostSequence: replacement.hostSequence,
				subscriptions,
			}),
			error => {
				assert.ok(error instanceof AgentHostError);
				assert.equal(error.code, AgentHostErrorCode.InvalidProtocolValue);
				return true;
			},
		);
	}
}
