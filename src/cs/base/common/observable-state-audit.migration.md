# Observable state boundary audit

## Temporary scope

This migration begins after the
[Observable graph kernel](observable.migration.md) is complete. It owns the
semantic review of surviving multi-observable state transitions and their
domain tests across Base, Platform, Editor, Workbench, Sessions, Agent Host,
Comet, and Code, plus the aggregate-versus-transaction decision rules in
`.github/instructions/observables.instructions.md`.

Sessions files also scoped by the
[Agent Host migration](../../sessions/agent-host.migration.md) are handled by
deleting legacy `default` and `mainChat` state, then auditing only the final
Agent Host, Comet, Session, and Chat models.

## Decision rule

For every sequence that writes more than one observable, the owning domain
chooses exactly one final model:

1. Use one aggregate observable when the fields are one authoritative value
   and no valid observer may see them independently.
2. Use one synchronous `transaction` when independently meaningful
   observables participate in one atomic transition. Pass the same addressed
   transaction through nested mutations.
3. Keep independent writes only when intermediate combinations are valid
   public states and observers are intended to react to each write.

A transaction does not justify duplicated authority, hide an invalid model,
or retain state that another migration deletes. The audit changes the owning
model and its call sites directly; it adds no aggregate facade, compatibility
setter, or mirrored legacy field.

## Direct migration sequence

1. Inventory multi-write transitions and the reactions that consume them.
   Record the owner, invariant, commit point, and required failure state in the
   focused domain test being added or updated.
2. Audit Base and Platform, then Editor and Workbench, then final Sessions,
   Agent Host, Comet, and Code models.
3. Replace duplicated authority with one aggregate value. Otherwise thread one
   addressed transaction through the real mutation methods or retain proven
   independent writes.
4. Test success, callback throw after each write boundary, reaction count,
   equality-neutral transitions, cancellation where applicable, and exact
   post-failure state.
5. Run every affected unit, integration, and smoke test runtime, then delete this
   document once every transition has a final classification.

## Completion and deletion criteria

This migration is complete only when every surviving multi-observable write
sequence is an aggregate write, one explicit addressed transaction, or a
tested intentionally independent sequence; no transaction preserves duplicate
authority or legacy Agent Host state; reactions never observe a forbidden
intermediate combination; exact pre- and post-commit failure states are
covered; and all affected test runtimes, type checking, coverage, and verification
pass.

Delete this document in the same change that satisfies these criteria.
