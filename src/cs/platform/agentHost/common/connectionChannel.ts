/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Desktop IPC channel carrying the one local Agent Host logical connection. */
export const localAgentHostConnectionChannelName = 'agentHost';

/** Renderer-owned content reader used by the local Agent Host connection. */
export const localAgentHostClientContentResourceChannelName = 'agentHost.contentResources';

/** Renderer-owned canonical Tool executors used by the local Agent Host connection. */
export const localAgentHostClientToolChannelName = 'agentHost.clientTools';
