# Service Migration Instructions

These notes are for Codex agents working on Literature Studio service and
workbench migrations. Keep service wiring explicit and disposable.

## Scope

Use this guidance when adding or porting VS Code-style services,
contributions, workbench controllers, or UI code that consumes shared state.
Prefer the repository's existing `ls/*` patterns over copying upstream
infrastructure wholesale.

## Ownership Boundaries

- Services own durable resources: IPC channels, timers, storage watchers,
  caches, background workers, and shared model state.
- Consumers own subscriptions: view listeners, service `onDid*` handlers,
  DOM listeners, and temporary reactions created for a UI/controller instance.
- Contributions connect services to UI and lifecycle. They should be thin
  orchestration code, not hidden service containers.
- Views render and expose user events. Avoid constructing platform services
  inside views.

## Registration

- Register services at a composition root for the current runtime surface.
  Examples include workbench bootstrap, electron-main setup, or a dedicated
  platform entry module.
- Do not introduce ad hoc module-level singletons unless the surrounding
  package already uses that pattern and the lifetime is process-wide.
- Keep constructor dependencies explicit. If a lightweight service collection
  is added later, it should preserve typed ownership and disposal semantics.
- When porting upstream code that expects `IInstantiationService`, first map
  the actual dependencies and wire only the services this repository needs.

## Consumption

- Consumers should receive services through constructor/options parameters or
  a narrow factory, not by importing mutable service instances from unrelated
  modules.
- Subscribe close to the consumer that reacts to the event, and register the
  returned disposable immediately.
- Use `LifecycleStore`, `DisposableStore`, `MutableLifecycle`,
  `MutableDisposable`, `_register`, or `toDisposable` for all listener cleanup.
- Avoid naked `addEventListener`, naked unsubscribe callbacks, and fire-and-
  forget service listeners.

## Disposal

- If a service creates a resource, the service disposes it.
- If a consumer subscribes to a service, the consumer disposes that
  subscription.
- If a contribution creates services or controllers for a workbench lifetime,
  the contribution must own a store and dispose it from the workbench shutdown
  path.
- Replacing a controller/model should clear the previous store before wiring
  the next one.

## Event Contracts

- Use `onDid*` names for state change events and keep payloads stable.
- Prefer payloads that describe the changed state rather than requiring every
  consumer to query global state synchronously.
- Event emitters live inside the owner of the state. Expose only the event
  function, not the emitter.
- Do not fire events from constructors until consumers have had a chance to
  subscribe; expose a snapshot getter for initial state.

## Upstream Mapping

- `IDisposable` maps to `DisposableLike` / `IDisposable`.
- `DisposableStore` maps to `LifecycleStore` / `DisposableStore`.
- `Disposable` maps to the local `Disposable` base when `_register` is useful.
- `MutableDisposable` maps to `MutableLifecycle` / `MutableDisposable`.
- `IInstantiationService` should not be copied in full unless several services
  genuinely need lazy graph construction.

## Review Checklist

- Service lifetime is clear and rooted in one runtime surface.
- Consumers dispose every subscription they create.
- No view imports a platform service singleton directly.
- No module-level mutable singleton was added without a process-wide lifetime.
- Tests cover disposal or replacement when the change adds long-lived
  subscriptions.
