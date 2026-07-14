# Optional connected Agent product migration

## Temporary scope

This migration covers the explicit Copilot, Claude, and Codex mock package
products used while their production SDK-backed connected runtimes are not yet
part of this repository. Its scope is limited to:

- `src/cs/code/common/agentHost/mockAgentPackages.ts`;
- `src/cs/code/electron-utility/agentRuntime/mockAgentRuntime.ts` and
  `mockAgentRuntimeMain.ts`;
- `src/cs/code/electron-main/agentHost/localAgentPackageArtifactPort.ts`;
- `src/cs/code/electron-main/agentHost/mockAgentRuntimeProcess.ts`;
- `src/cs/code/electron-main/agentHost/mockAgentRuntimeSandboxProcess.ts`;
- the corresponding package catalog, runtime factory, artifact-store path,
  lifecycle reconciliation port, build entry, and tests in
  `localAgentHostMain.ts`, `main.ts`, `environmentMainService.ts`,
  `agentPackageLifecycle.ts`, `build/lib/electronBuild.ts`, and the Agent Host
  test directories.

The mock products are explicit installable user packages. They are absent from
the installed and active catalogs by default, start one connected utility
process only after their exact install transaction, and use the complete Agent
Runtime Protocol. They are not a fallback for a missing SDK, failed runtime,
another package revision, or the embedded Comet runtime.

The product composition also injects an explicit mock implementation of the
Agent runtime sandbox process port. It derives the complete launch authority
from the product-verified installed record, re-verifies the exact artifact for
every process generation, supplies no ambient environment, arguments, working
directory, standard streams, or credentials, and owns the process lifetime.
This temporary port does not provide operating-system sandbox enforcement.

The same product composition injects one artifact authority into package
lifecycle and runtime launch. Staging atomically materializes a package-owned,
digest-addressed dependency closure and its exact authorization receipt. The
persisted installed catalog and unresolved package transitions own receipt
lifetime; startup and terminal reconciliation verify retained receipts and
remove orphaned revisions. Cold restore and launch authorize the historical
installed record against that receipt, never against the current installable
mock catalog. Receipt staging and discard remain owned by the exact package
operation.

## Direct replacement

Each production package replaces its corresponding mock product directly. The
replacement supplies one signed, verified immutable dependency closure through
the production package registry, launches its SDK-backed runtime outside Agent
Host, registers the same product-owned Agent identity through
`IAgentRuntimeConnection`, and privately maps the canonical configuration
properties documented in `src/cs/sessions/AGENT_HOST.md` to SDK values. The
production registry directly replaces the temporary mock catalog and receipt
authority while preserving installed-revision and unresolved-transition
ownership. Host package, Agent, Session, Chat, Turn, configuration, content,
Tool, and protocol call sites do not receive a compatibility adapter or a
second route.

For each of Copilot, Claude, and Codex, replacement is complete when:

1. the product artifact catalog contains the production verified package and
   no production mock offering for that package ID;
2. install, activation, cold restoration, update, uninstall, retained-history
   unavailability, compatible reinstall, Agent-backed deletion, and operation
   reconciliation pass through the production connected process;
3. configuration schema, execution-profile, Session, Chat, Turn, content, and
   canonical Tool conformance pass without SDK-native values crossing the
   runtime protocol; and
4. the production sandbox process port enforces the exact process, filesystem,
	network, secret, and Tool-executor authority derived from the verified
	manifest, and the production entry point and build contain no selection or
	launch path to that package's mock process; and
5. install, cold restore, update, rollback reconciliation, and uninstall use
   the production registry's immutable artifact ownership without the mock
   product catalog or receipt authority.

## Deletion condition

Delete this migration document in the same change that directly replaces all
three production mock package products and removes their production launcher
and catalog entries, including `MockAgentRuntimeSandboxProcessPort` and the
temporary mock artifact receipt authority. A generic deterministic runtime may
remain only as a test-owned conformance fixture after that change; it must not
remain reachable from product composition.
