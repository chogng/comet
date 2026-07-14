# Optional connected Agent product migration

## Temporary scope

This migration covers the direct replacement of the remaining Copilot and
Codex mock package products by their production SDK-backed connected runtimes.
Claude has already completed that direct product replacement. Its official
Agent SDK runtime remains in scope as the production conformance boundary while
the other products migrate. The scope is limited to:

- `src/cs/code/common/agentHost/mockAgentPackages.ts`,
  `claudeAgentPackage.ts`, `agentPackageProducts.ts`, and
  `localAgentRuntimeProtocol.ts`;
- `src/cs/code/electron-utility/agentRuntime/mockAgentRuntime.ts` and
  `mockAgentRuntimeMain.ts`, plus `claudeAgentRuntime.ts` and
  `claudeAgentRuntimeMain.ts`;
- `src/cs/code/electron-main/agentHost/localAgentPackageArtifactPort.ts`;
- `src/cs/code/electron-main/agentHost/localAgentRuntimeProcess.ts`;
- `src/cs/code/electron-main/agentHost/localAgentRuntimeSandboxProcess.ts`;
- the corresponding package catalog, runtime factory, artifact-store path,
  lifecycle reconciliation port, build entry, and tests in
  `localAgentHostMain.ts`, `main.ts`, `environmentMainService.ts`,
  `agentPackageLifecycle.ts`, `build/lib/electronBuild.ts`, and the Agent Host
  test directories.

The remaining mock products are explicit installable user packages. They are
absent from the installed and active catalogs by default, start one connected
utility process only after their exact install transaction, and use the
complete Agent Runtime Protocol. They are not a fallback for a missing SDK,
failed runtime, another package revision, or the embedded Comet runtime.

The product composition injects one local Agent runtime process port. It
derives the complete launch authority from the product-verified installed
record, re-verifies the exact artifact for every process generation, supplies
only the explicit runtime protocol environment, and owns the process lifetime.
The Claude runtime receives its package-owned state directory and verified
native SDK executable through that port. It resolves the Anthropic API key only
through the Turn-scoped Host credential operation and starts the SDK with
fail-closed operating-system sandboxing and the exact Anthropic network grant.
SDK transcript persistence uses the SDK-native `SessionStore` contract, while
per-Chat native transcript files are isolated as removable runtime cache.
Copilot and Codex still reach the deterministic mock runtime through the same
package authority; they receive no SDK credential or production capability.

The same product composition injects one artifact authority into package
lifecycle and runtime launch. Staging atomically materializes a package-owned,
digest-addressed dependency closure and its exact authorization receipt. The
persisted installed catalog and unresolved package transitions own receipt
lifetime; startup and terminal reconciliation verify retained receipts and
remove orphaned revisions. Cold restore and launch authorize the historical
installed record against that receipt, never against the current installable
product catalog. Receipt staging and discard remain owned by the exact package
operation.

## Direct replacement

Each production package replaces its corresponding mock product directly. The
replacement supplies one verified immutable dependency closure through the
product package catalog, launches its SDK-backed runtime outside Agent Host,
registers the same product-owned Agent identity through
`IAgentRuntimeConnection`, and privately maps the canonical configuration
properties documented in `src/cs/sessions/AGENT_HOST.md` to SDK values. Host
package, Agent, Session, Chat, Turn, configuration, content, Tool, and protocol
call sites do not receive a compatibility adapter or a second route.

For each remaining mock product, replacement is complete when:

1. the product artifact catalog contains the production verified package and
   no mock offering for that package ID;
2. install, activation, cold restoration, update, uninstall, retained-history
   unavailability, compatible reinstall, Agent-backed deletion, and operation
   reconciliation pass through the production connected process;
3. configuration schema, execution-profile, Session, Chat, Turn, content, and
   canonical Tool conformance pass without SDK-native values crossing the
   runtime protocol;
4. the production sandbox process port enforces the exact process, filesystem,
   network, secret, and Tool-executor authority derived from the verified
   manifest, and the production entry point and build contain no selection or
   launch path to that package's mock process; and
5. install, cold restore, update, rollback reconciliation, and uninstall use
   the production product's immutable artifact ownership without the mock
   product catalog.

Claude satisfies these product-specific conditions with
`@anthropic-ai/claude-agent-sdk` and its exact platform executable in the
verified package closure. Its production entry point contains no mock-runtime
selection path. This does not complete the document while Copilot or Codex
remains in the product mock catalog.

## Deletion condition

Delete this migration document in the same change that directly replaces the
Copilot and Codex mock package products and removes every mock catalog and
product-launch entry. The local package artifact authority, generic local
runtime process port, and production Claude Agent SDK runtime remain as durable
product infrastructure. A deterministic mock runtime may remain only as a
test-owned conformance fixture after that change; it must not remain reachable
from product composition.
