# Built-in Agent SDK cache migration

## Temporary scope

This migration covers:

- `build/agent-sdk/**`;
- `src/cs/platform/agentHost/node/agentSdkDownloader.ts`;
- `src/cs/platform/agentHost/node/agents/claude/**`;
- `src/cs/platform/agentHost/node/agents/codex/**`;
- `src/cs/platform/agentHost/node/packages/**` where Claude and Codex are removed from the installable package lifecycle;
- `src/cs/code/electron-main/main.ts`;
- `src/cs/code/electron-main/agentHost/**`;
- `src/cs/platform/environment/electron-main/environmentMainService.ts`;
- the Agent Host protocol and Sessions call sites required to prepare a built-in Agent before creating its first Session;
- the corresponding tests and architecture documents.

## Current boundary being removed

Claude and Codex are currently product-authored optional Agent packages. Desktop startup reads complete SDK artifacts from `dist-agent-sdk`, publishes them as installable packages, and constructs each Agent only after a user package-install operation. This makes the SDK artifact lifecycle, product Agent availability, and external Agent package management one lifecycle.

The current Agent Host root publishes only active Session types. A Claude or Codex Session type therefore cannot be visible until its SDK has already been loaded and its native model snapshot has produced an exact descriptor.

## Final project-owned target

Comet, Claude, and Codex are product-built-in Agent orchestration layers. Their `IAgent` behavior mappings compile with the App. Claude and Codex SDK bytes are product-owned runtime dependencies selected by exact App configuration and cached by package ID, SDK version, and host target.

Agent SDK resolution uses one exact source:

```text
explicit development SDK root
    or
product SDK configuration
    → completed version-and-target cache
    or
one deduplicated download
    → verified extraction
    → atomic cache publication
    → SDK-specific module or executable resolution
```

Deleting cached bytes does not uninstall the built-in Agent. The next explicit preparation downloads the same App-selected version again. SDK version selection changes only with an App update.

The Agent Host publishes built-in Agent availability without loading SDK bytes. Selecting a cold Claude or Codex Session type invokes an explicit preparation operation, forwards download progress, loads the native SDK, obtains its exact model snapshot, and atomically publishes the active Agent registration and model-backed Session type. Startup, passive catalog reads, restoration scans, and Settings rendering never trigger a cold download.

External Agent packages retain the generic install, update, activation, and uninstall lifecycle. They do not use the built-in SDK cache.

## Direct migration steps

1. Add the product-configured SDK downloader with exact target resolution, completed-cache detection, concurrent download deduplication, cancellation, bounded progress, safe extraction, atomic publication, and a short failure latch.
2. Change `build/agent-sdk` output from App resources to target-specific SDK tarballs and product configuration inputs.
3. Remove Claude and Codex offerings, manifests, artifact staging, install, update, and uninstall from the generic Agent package catalog.
4. Construct Claude and Codex as built-in Agent definitions whose SDK bindings resolve only through the downloader.
5. Add an explicit built-in Agent preparation operation and publish availability separately from active Agent registrations and Session types.
6. Make Sessions await preparation after the user selects a cold built-in Session type and before creating its draft. Publish progress and the resulting exact model snapshot through the existing Host state channels.
7. Migrate persisted Claude and Codex installed-package records to built-in ownership without changing their Agent IDs, Session IDs, Chat IDs, normalized history, or opaque resume state.
8. Remove the old product package factories and all Settings install or uninstall actions for Claude and Codex.

Call sites migrate directly. No package alias, compatibility factory, placeholder Agent, second SDK source, or first-Turn download path remains.

## Implemented slice

- The desktop Host publishes cold Claude and Codex availability without
  reading or downloading SDK bytes.
- Sessions awaits explicit preparation before creating a draft.
- Preparation resolves the exact product SDK, discovers native models, and
  atomically activates the direct `IAgent`.
- Claude and Codex are excluded from external package persistence, catalog,
  installation, activation, and uninstall.
- Existing external-package records for those built-in IDs are removed from
  package lifecycle state while retained Host backing remains attributed to
  the same package and Agent identities.
- Desktop builds no longer embed `dist-agent-sdk`, and the obsolete product
  package factories are deleted.

## Remaining work in scope

- Carry bounded SDK download progress and cancellation across the Agent Host
  protocol.
- Exercise cache deletion and retained backing restoration through composed
  desktop and remote Host tests.
- Complete the exhaustive Claude and Codex native behavior mappings described
  by the parent Agent Host migration.

## Behavior that must be preserved

- exact Claude and Codex Agent IDs and retained backing ownership;
- App-compiled exhaustive SDK behavior mappings;
- exact native model discovery and descriptor revisions;
- SDK-native Session, Turn, Tool, permission, input, plan, task, subagent, background, compaction, retry, and terminal authority;
- canonical Comet behavior, interaction, Tool, persistence, and connection contracts;
- deterministic cancellation and failure reporting;
- local and remote Host placement using the same Agent Host protocol.

## Completion criteria

- Claude and Codex never appear in installable or installed external Agent package catalogs.
- Product startup and passive catalog reads perform no SDK download.
- Selecting a cold built-in Agent prepares its exact SDK and publishes its model-backed Session type before draft creation.
- A completed cache is reused without network access; a deleted cache is downloaded again without changing Agent installation state.
- SDK downloads are exact-version, exact-target, deduplicated, cancellable, safely extracted, and atomically published.
- SDK download progress crosses the Agent Host protocol.
- Existing Claude and Codex retained Sessions restore under built-in ownership.
- All affected tests, type checks, protocol checks, and desktop builds pass.
- The obsolete product package factories and embedded SDK resources are deleted.
- This migration document is deleted.
