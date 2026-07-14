import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptsMarker = `${path.sep}scripts${path.sep}`;
const scriptsMarkerIndex = scriptFilePath.lastIndexOf(scriptsMarker);
const rootDir =
  scriptsMarkerIndex >= 0
    ? scriptFilePath.slice(0, scriptsMarkerIndex)
    : path.dirname(scriptFilePath);
const outputDir = path.join(rootDir, '.tmp', 'agent-tests');
const agentHostCommonEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'common',
  'agentHostProtocol.test.ts',
);
const agentConfigurationEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'common',
  'agentConfiguration.test.ts',
);
const runtimeSandboxEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'common',
  'runtimeSandbox.test.ts',
);
const remoteAgentHostAddressEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'common',
  'remoteAgentHostAddress.test.ts',
);
const remoteTunnelAuthenticationEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'common',
  'remoteTunnelAuthentication.test.ts',
);
const remoteTunnelProtocolEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'common',
  'remoteTunnelProtocol.test.ts',
);
const remoteTunnelAgentHostTransportEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'browser',
  'remoteTunnelAgentHostTransport.test.ts',
);
const remoteTunnelAgentHostBindingEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'remoteTunnelAgentHostBinding.test.ts',
);
const agentPackageLifecycleEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'packages',
  'agentPackageLifecycle.test.ts',
);
const agentPackageRuntimeRegistryEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'packages',
  'agentPackageRuntimeRegistry.test.ts',
);
const agentHostAuthorityEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'host',
  'agentHostAuthority.test.ts',
);
const agentHostStateStoresEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'storage',
  'agentHostStateStores.test.ts',
);
const agentToolsEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'tools',
  'agentTools.test.ts',
);
const agentClientToolPublicationEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'tools',
  'agentClientToolPublication.test.ts',
);
const clientAgentToolsEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'browser',
  'clientAgentTools.test.ts',
);
const clientContentResourcesEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'browser',
  'clientContentResources.test.ts',
);
const localAgentHostConnectionEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'electron-browser',
  'localAgentHostConnection.test.ts',
);
const agentContentResourceServiceEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'content',
  'agentContentResourceService.test.ts',
);
const agentCredentialServiceEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'credentials',
  'agentCredentialService.test.ts',
);
const cometAgentEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'agents',
  'comet',
  'cometAgent.test.ts',
);
const openAIResponsesEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'agents',
  'comet',
  'openAIResponses.test.ts',
);
const openAIChatCompletionsEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'agents',
  'comet',
  'openAIChatCompletions.test.ts',
);
const connectedAgentRuntimeEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'agentHost',
  'test',
  'node',
  'runtime',
  'connectedAgentRuntime.test.ts',
);
const mockAgentRuntimeEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'code',
  'electron-utility',
  'agentRuntime',
  'test',
  'mockAgentRuntime.test.ts',
);
const remoteAgentHostRoutesEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'server',
  'test',
  'node',
  'agentHost',
  'remoteAgentHostRoutes.test.ts',
);
const remoteAgentHostMainEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'server',
  'test',
  'node',
  'agentHost',
  'remoteAgentHostMain.test.ts',
);
const remoteTunnelAgentHostMainEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'server',
  'test',
  'node',
  'agentHost',
  'remoteTunnelAgentHostMain.test.ts',
);
const remoteAgentHostEndpointCredentialAuthorityEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'server',
  'test',
  'node',
  'agentHost',
  'remoteAgentHostEndpointCredentialAuthority.test.ts',
);
const remoteTunnelEntryPoint = path.join(
  rootDir,
  'src',
  'cs',
  'platform',
  'tunnel',
  'test',
  'common',
  'remoteTunnel.test.ts',
);
const agentHostCommonOutputFile = path.join(outputDir, 'agent-host-common.test.mjs');
const agentConfigurationOutputFile = path.join(outputDir, 'agent-configuration.test.mjs');
const runtimeSandboxOutputFile = path.join(outputDir, 'runtime-sandbox.test.mjs');
const remoteAgentHostAddressOutputFile = path.join(outputDir, 'remote-agent-host-address.test.mjs');
const remoteTunnelAuthenticationOutputFile = path.join(outputDir, 'remote-tunnel-authentication.test.mjs');
const remoteTunnelProtocolOutputFile = path.join(outputDir, 'remote-tunnel-protocol.test.mjs');
const remoteTunnelAgentHostTransportOutputFile = path.join(outputDir, 'remote-tunnel-agent-host-transport.test.mjs');
const remoteTunnelAgentHostBindingOutputFile = path.join(outputDir, 'remote-tunnel-agent-host-binding.test.mjs');
const agentPackageLifecycleOutputFile = path.join(outputDir, 'agent-package-lifecycle.test.mjs');
const agentPackageRuntimeRegistryOutputFile = path.join(outputDir, 'agent-package-runtime-registry.test.mjs');
const agentHostAuthorityOutputFile = path.join(outputDir, 'agent-host-authority.test.mjs');
const agentHostStateStoresOutputFile = path.join(outputDir, 'agent-host-state-stores.test.mjs');
const agentToolsOutputFile = path.join(outputDir, 'agent-tools.test.mjs');
const agentClientToolPublicationOutputFile = path.join(outputDir, 'agent-client-tool-publication.test.mjs');
const clientAgentToolsOutputFile = path.join(outputDir, 'client-agent-tools.test.mjs');
const clientContentResourcesOutputFile = path.join(outputDir, 'client-content-resources.test.mjs');
const localAgentHostConnectionOutputFile = path.join(outputDir, 'local-agent-host-connection.test.mjs');
const agentContentResourceServiceOutputFile = path.join(outputDir, 'agent-content-resource-service.test.mjs');
const agentCredentialServiceOutputFile = path.join(outputDir, 'agent-credential-service.test.mjs');
const cometAgentOutputFile = path.join(outputDir, 'comet-agent.test.mjs');
const openAIResponsesOutputFile = path.join(outputDir, 'openai-responses.test.mjs');
const openAIChatCompletionsOutputFile = path.join(outputDir, 'openai-chat-completions.test.mjs');
const connectedAgentRuntimeOutputFile = path.join(outputDir, 'connected-agent-runtime.test.mjs');
const mockAgentRuntimeOutputFile = path.join(outputDir, 'mock-agent-runtime.test.mjs');
const remoteAgentHostRoutesOutputFile = path.join(outputDir, 'remote-agent-host-routes.test.mjs');
const remoteAgentHostMainOutputFile = path.join(outputDir, 'remote-agent-host-main.test.mjs');
const remoteTunnelAgentHostMainOutputFile = path.join(outputDir, 'remote-tunnel-agent-host-main.test.mjs');
const remoteAgentHostEndpointCredentialAuthorityOutputFile = path.join(outputDir, 'remote-agent-host-endpoint-credential-authority.test.mjs');
const remoteTunnelOutputFile = path.join(outputDir, 'remote-tunnel.test.mjs');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const [entryPoint, outputFile] of [
  [agentHostCommonEntryPoint, agentHostCommonOutputFile],
  [agentConfigurationEntryPoint, agentConfigurationOutputFile],
  [runtimeSandboxEntryPoint, runtimeSandboxOutputFile],
  [remoteAgentHostAddressEntryPoint, remoteAgentHostAddressOutputFile],
  [remoteTunnelAuthenticationEntryPoint, remoteTunnelAuthenticationOutputFile],
  [remoteTunnelProtocolEntryPoint, remoteTunnelProtocolOutputFile],
  [remoteTunnelAgentHostTransportEntryPoint, remoteTunnelAgentHostTransportOutputFile],
  [remoteTunnelAgentHostBindingEntryPoint, remoteTunnelAgentHostBindingOutputFile],
  [agentPackageLifecycleEntryPoint, agentPackageLifecycleOutputFile],
  [agentPackageRuntimeRegistryEntryPoint, agentPackageRuntimeRegistryOutputFile],
  [agentHostAuthorityEntryPoint, agentHostAuthorityOutputFile],
  [agentHostStateStoresEntryPoint, agentHostStateStoresOutputFile],
  [agentToolsEntryPoint, agentToolsOutputFile],
  [agentClientToolPublicationEntryPoint, agentClientToolPublicationOutputFile],
  [clientAgentToolsEntryPoint, clientAgentToolsOutputFile],
  [clientContentResourcesEntryPoint, clientContentResourcesOutputFile],
  [localAgentHostConnectionEntryPoint, localAgentHostConnectionOutputFile],
  [agentContentResourceServiceEntryPoint, agentContentResourceServiceOutputFile],
  [agentCredentialServiceEntryPoint, agentCredentialServiceOutputFile],
  [cometAgentEntryPoint, cometAgentOutputFile],
  [openAIResponsesEntryPoint, openAIResponsesOutputFile],
  [openAIChatCompletionsEntryPoint, openAIChatCompletionsOutputFile],
  [connectedAgentRuntimeEntryPoint, connectedAgentRuntimeOutputFile],
  [mockAgentRuntimeEntryPoint, mockAgentRuntimeOutputFile],
  [remoteAgentHostRoutesEntryPoint, remoteAgentHostRoutesOutputFile],
  [remoteAgentHostMainEntryPoint, remoteAgentHostMainOutputFile],
  [remoteTunnelAgentHostMainEntryPoint, remoteTunnelAgentHostMainOutputFile],
  [remoteAgentHostEndpointCredentialAuthorityEntryPoint, remoteAgentHostEndpointCredentialAuthorityOutputFile],
  [remoteTunnelEntryPoint, remoteTunnelOutputFile],
]) {
  await build({
    entryPoints: [entryPoint],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: 'inline',
    external: ['node:assert/strict', 'node:test'],
    loader: {
      '.css': 'empty',
      '.svg': 'text',
    },
  });
}

const result = spawnSync(process.execPath, [
  '--test',
  '--test-concurrency=1',
  agentHostCommonOutputFile,
  agentConfigurationOutputFile,
  runtimeSandboxOutputFile,
  remoteAgentHostAddressOutputFile,
  remoteTunnelAuthenticationOutputFile,
  remoteTunnelProtocolOutputFile,
  remoteTunnelAgentHostTransportOutputFile,
  remoteTunnelAgentHostBindingOutputFile,
  agentPackageLifecycleOutputFile,
  agentPackageRuntimeRegistryOutputFile,
  agentHostAuthorityOutputFile,
  agentHostStateStoresOutputFile,
  agentToolsOutputFile,
  agentClientToolPublicationOutputFile,
  clientAgentToolsOutputFile,
  clientContentResourcesOutputFile,
  localAgentHostConnectionOutputFile,
  agentContentResourceServiceOutputFile,
  agentCredentialServiceOutputFile,
  cometAgentOutputFile,
  openAIResponsesOutputFile,
  openAIChatCompletionsOutputFile,
  connectedAgentRuntimeOutputFile,
  mockAgentRuntimeOutputFile,
  remoteAgentHostRoutesOutputFile,
  remoteAgentHostMainOutputFile,
  remoteTunnelAgentHostMainOutputFile,
  remoteAgentHostEndpointCredentialAuthorityOutputFile,
  remoteTunnelOutputFile,
], {
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
