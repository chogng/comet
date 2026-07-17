# Nireco Editor integration migration

## Temporary scope

This migration directly replaces the standalone `../nireco-editor` boundary and Comet's current Writing Editor document authority with the architecture defined by `src/cs/editor/NIRECO.md`.

The temporary change surface is:

- `src/cs/editor/editor.all.ts` as the only Editor-owned browser-registration aggregate loaded by the Workbench shell;
- `src/cs/editor/common/core/**` for canonical JSON, SHA-256, Editor domain identifiers, semantic positions, manuscript resource validation, and typed errors;
- `src/cs/editor/common/model.ts` and `src/cs/editor/common/model/**` for the authoritative Manuscript model, schema, snapshots, indexes, transactions, PositionMap, Revision, Proposal, Semantic Diff, replay, and recovery semantics;
- `src/cs/editor/common/services/**` for Model Service, resolver, history, revision-bound reads, diagnostics, Proposal, and Editor durability;
- `src/cs/editor/browser/text/**` for the indispensable ProseMirror projection, step translation, selection, composition, input, and DOM divergence handling;
- `src/cs/editor/contrib/**` for removable Editor-owned capabilities such as formatting UI and Figure resize behavior;
- `src/cs/platform/storage/**` for a generic fenced durable byte-storage port and its real runtime implementations;
- `src/cs/workbench/contrib/draftEditor/**` for model references, save/revert, user review, Agent session/grant/cursor, Tool execution, attachments, targets, and presentations;
- affected Platform Agent Host call sites and tests where Feature-specific Editor types or copied Nireco contracts must be removed; and
- Node, Browser, Electron, layer, coverage, performance, recovery, and direct integration evidence.

No worktree, integration branch, external package, compatibility path, or parallel implementation is part of this migration. Work happens directly in the Comet repository with focused verification and phase commits.

## Boundary being removed

The standalone repository contains valuable domain behavior and tests, but its production package boundary is obsolete. The following are migration evidence only and are not copied into Comet:

- `@comet-internal/nireco-editor`, package exports, tarballs, packed consumers, and public/entrypoint barrels;
- Contract Bundle, Preview schemas, generated types, handshake, capability matrix, Mock Service, adapters, and cross-repository conformance;
- Nireco-owned URI, Event, Observable, Disposable, Cancellation, Clock, generic Result, registry, and test foundations;
- `src/cs/platform/nireco/**`, `integrations/nireco/**`, standalone Web Component, and isolated Browser Spike delivery paths;
- Node-specific production SHA-256, production in-memory durability, legacy fixture ID parsers, and package governance hashes; and
- the standalone coding standard and Roadmap where they conflict with Comet's repository instructions, runtime, dependencies, test hosts, or direct development workflow.

Gate 0 reports, Browser Spike artifacts, old performance measurements, and `/private/tmp/comet-nireco-gate0` remain historical evidence. They do not prove the integrated Comet implementation and must not be merged.

## Upstream structure evidence

The final directory follows the ownership rules visible in upstream Monaco:

```text
common/model.ts
common/model/**
common/services/model.ts
common/services/modelService.ts
common/services/resolverService.ts
browser/**                  # indispensable Editor core
contrib/<feature>/**        # removable Editor features
test/{common,browser}/**    # tests mirror their runtime owner
```

`src/cs/editor/standalone` is absent because Comet does not publish a standalone editor distribution. Product-only Input, Pane, Agent Tool, and review behavior remains under `src/cs/workbench/contrib/draftEditor`; it does not become Editor `contrib`.

This evidence determines ownership, not implementation text. Comet uses its own Manuscript contracts and existing base/platform services. No upstream source, fixture, barrel, standalone API, or unrelated contribution tree is copied.

## Current Comet conflicts

The direct cutover removes these current conflicts rather than wrapping them:

- `common/writingEditorDocument.ts` imports Browser ProseMirror schema and can replace invalid data with an empty document;
- `browser/text/schema.ts` can allocate IDs with `Math.random`;
- `browser/text/editor.ts` installs ProseMirror history;
- `browser/text/sync.ts` echoes whole ProseMirror documents as state;
- `DraftEditorInput` owns a second document and pane Selection snapshot;
- `DraftEditorService` scans active groups instead of resolving the resource model; and
- Draft Agent Tools operate on handwritten block snapshots instead of revision-bound Editor services and Proposal contracts.

Every migrated file enters its final owner and name. No call site may depend on a transitional name or on an uncommitted compatibility surface.

## Direct migration phases

1. Freeze `NIRECO.md`, this migration boundary, the single performance profile, and deterministic core vectors. Split canonical JSON, hash preimage, SHA-256, identifiers, resource validation, and typed errors into their final modules. Remove Workspace, read-session, debug, governance-manifest, Preview fixture, and package-only identities from Editor core.
2. Move Manuscript nodes, strict schema, immutable Snapshot, document index, academic graph, Semantic Position, Operation, Transaction, normalization, PositionMap, inverse, and replay into `common/model/**`. Do not connect Browser or storage yet.
3. Add `IManuscriptModel`, Model Service, exact-scheme resolver, reference lifecycle, Revision/history, and trusted identity service using Comet Event, Disposable, Cancellation, URI/resources, and DI.
4. Add the generic Platform durable byte-storage port and real failure-injectable implementation, then Editor WAL/Snapshot/manifest codecs, fencing, recovery, `whenDurable`, save semantics, and terminal fault behavior.
5. Add Proposal state, Semantic Edit compilation, persistent Operation IDs, Change Group UUIDv8 identity, Semantic Diff, rebase, diagnostics, and dependency-closure compilation.
6. Cut Draft Editor and ProseMirror directly to the model. In the same cutover, delete `WritingEditorDocument` authority, Input-owned document state, ProseMirror history, prop-echo sync, Browser ID allocation, and invalid-to-empty behavior.
7. Cut Feature-owned Draft Agent reads and writes directly to revision-bound Editor and Proposal services. Keep Agent session, grant, scope, opaque cursor, idempotency, review controller, Tool descriptor/executor, target, and presentation in Workbench. Keep Platform Agent Host Feature-neutral.
8. Run real Browser input/IME/multi-view evidence, Platform durability fault/recovery evidence, Workbench direct integration, S/M/L performance, all unit runtimes, typecheck, coverage, layer checks, build, and repository verification. Remove standalone package dependencies and obsolete copied artifacts.

Each phase is verified and committed before the next phase broadens the change surface. A phase commit contains final-path code only; it does not preserve a temporary facade, alias, dual authority, or fallback for later cleanup.

## Behavior preserved from the standalone source

- canonical structured content, strict validation, immutable snapshots, canonical JSON, exact SHA-256 preimages, and deterministic hashes;
- trusted UUIDv7 allocation, persisted Operation identity, UUIDv8 Change Group derivation, and exact golden vectors;
- ordered atomic Transaction application, PositionMap, inverse generation, replay, and complete failure state;
- linear Revision history, inverse-Transaction undo/redo, one writable authority, fencing, memory/WAL/Snapshot durability, corruption detection, and recovery;
- revision-bound outline/read/search/history/diagnostics and cancellation;
- Proposal state, optimistic proposal revision, Semantic Edit compilation, Semantic Diff, rebase, conflict, and dependency closure;
- academic graph, Reference Snapshot, Claim, Evidence Link, Citation, bibliography, and provenance semantics; and
- explicit failure without current-head substitution, silent truncation, alternate storage, alternate authority, or duplicate execution.

## New evidence required

Standalone pass labels are not inherited. The integrated implementation must newly prove:

- the exact hash preimage and all golden hashes in Comet;
- UUIDv7 clock rollback/exhaustion, persisted Operation IDs, and exact UUIDv8 Change Group payload/order;
- WAL append/fsync terminal behavior, Snapshot retry behavior, fence loss, orphan Snapshot, tail truncation, middle corruption, sequence/parent mismatch, and dirty/save/close behavior;
- one active model per Comet resource and two independent Views over one model;
- ProseMirror projection without document/history/ID authority;
- real Browser IME, composition, beforeinput, Selection mapping, paste, undo/redo, structure, Figure, Citation, and divergence recovery;
- direct Draft Tool to Editor service calls with proposal-only Agent mutation and no Agent Host Editor import; and
- one Comet-owned S/M/L profile with raw performance evidence from the real integrated path.

## Completion and deletion

This migration is complete only when:

- all surviving production behavior is owned by the final Comet Editor, generic Platform storage, Workbench Draft Editor, or existing Feature-neutral Agent Host boundary;
- Editor common imports no Browser, Node, Electron, Workbench, Sessions, or Agent Host implementation;
- `IManuscriptModel` is the only document, Revision, Transaction, history, and durability authority;
- every ProseMirror View and Draft Input consumes the same resolved model;
- Agent operations use Feature-owned canonical Tools and direct Editor services, and no Agent path can accept or commit a Proposal;
- Comet contains no external Nireco package, `src/cs/platform/nireco`, copied contract, adapter, package entrypoint, compatibility parser, alias, re-export, fallback, or dual path;
- affected Node, Browser, Electron, type, coverage, layer, build, recovery, performance, and repository verification passes; and
- `../nireco-editor` is not required to build, test, run, or release Comet.

Delete this migration document in the same change that satisfies every criterion.
