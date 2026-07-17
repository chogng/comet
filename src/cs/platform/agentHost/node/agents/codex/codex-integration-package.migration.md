# Codex integration package independence

## Temporary scope

This migration covers:

- `build/agent-sdk/**` where the pinned Codex binary, generated app-server
  protocol, and Host integration module become one immutable product artifact;
- `src/cs/platform/agentHost/node/agents/codex/**` where the generated protocol
  and exact Codex behavior mapping are owned;
- `src/cs/platform/agentHost/common/packages.ts` and
  `src/cs/platform/agentHost/node/packages/**` where a verified
  product-maintained Host integration entry point replaces App-compiled
  offering factories;
- local Agent Host composition and tests that currently register those
  factories from the App build.

The final package remains a direct Host `IAgent` integration. It does not use
the connected Agent Runtime Protocol and does not introduce another provider
runtime.

## Target boundary

One published Codex integration revision contains the exact native executable,
generated app-server protocol, behavior mapping module, registration contract,
and declared resume migrations. Comet selects and signs the revision. The user
chooses whether and when the addressed Host installs or updates it.

Agent Host verifies the complete dependency closure before loading the mapping
module. Activation imports only the declared immutable Host entry point and
passes explicit Host services. It never selects an App-compiled factory by
package revision, loads an ambient module, downloads during activation, or
tries another implementation after failure.

## Completion and deletion conditions

Delete this document when:

1. the Codex artifact contains its executable and Host mapping module generated
   against one exact committed protocol tree;
2. the Host manifest identifies the verified mapping entry point;
3. generic Host activation loads that entry point without a product-specific
   factory registered by application startup;
4. an independently published offering can update Codex without an App
   rebuild, while retained state and active Turns still use the common atomic
   package update transaction;
5. protocol freshness, artifact integrity, activation, update, rollback, and
   retained-state tests pass; and
6. durable Agent package documentation describes only that final boundary.
