# Comet Configuration Model

## Goal

This document defines how Comet should model configuration before implementing durable configuration persistence.

The purpose is to prevent configuration from becoming:

- scattered constructor defaults
- adapter-local alias tables
- frontend-only settings with no runtime meaning
- thread or session state disguised as config

## Short Answer

Comet should add a dedicated `config` crate.

It should own:

- config file discovery
- TOML parsing and validation
- profile and include resolution
- merge and override semantics
- resolved runtime configuration snapshots

Comet should document this first, then implement persistence against that model.

If persistence is added before the model is clear, Comet will likely mix together:

- user defaults
- workspace policy
- session state
- per-turn overrides
- subagent policy

Those are different layers and should stay different.

## Why This Matters

Comet already has configuration-like data in multiple places:

- provider auth and base URL in adapter configs
- model aliases in adapter-local mapping tables
- sandbox and approval settings in session start payloads
- TUI behavior in frontend startup code

That is acceptable for an MVP, but it will not scale once Comet needs:

- multiple providers
- reusable model profiles
- workspace-specific policy
- different models for different conversations
- subagent-specific model and safety policy
- durable session restore with predictable behavior

## Design Principles

1. Configuration is distinct from runtime state.
2. Secrets should be referenced, not copied into durable thread history.
3. Model selection should use logical names first and provider-native names second.
4. Merge behavior must be explicit and deterministic.
5. Existing sessions should use a resolved snapshot, not silently change under their feet when files change.
6. Frontends should not each invent their own config loading behavior.

## Scope Layers

Comet should treat configuration as a set of ordered layers.

### 1. Built-In Defaults

Shipped by the binary.

Examples:

- default provider kind
- default approval mode
- default sandbox mode
- default TUI toggles

### 2. User Config

Machine-level personal defaults.

Recommended path on Unix-like systems:

- `~/.comet/config.toml`

Optional override:

- `$COMET_CONFIG`

This layer is the right place for:

- personal model profiles
- auth profile references
- default TUI behavior
- reusable shared profiles

### 3. Workspace Config

Repository or project-local overrides.

Recommended path:

- `.comet/config.toml`

This layer is the right place for:

- repository-specific provider choice
- stricter sandbox or approval policy
- project-preferred model defaults
- workspace-specific TUI defaults if needed

### 4. Session Creation Overrides

Explicit values chosen when creating a session.

Examples:

- start this session in `agent` mode
- use `reasoning_fast`
- force `danger-full-access`

This layer should override file-based defaults, but it is still configuration, not runtime state.

### 5. Turn Overrides

Per-turn choices inside one session.

Examples:

- this conversation turn uses a different model
- this turn enables web access
- this turn requests a different planning style

Turn overrides should be durable as part of turn metadata because they affect replay semantics.

### 6. Subagent Overrides

Subagent-specific policy applied on top of the parent context.

Examples:

- deep-search subagents use a cheaper or faster model
- spec-writing subagents run in `chat` mode
- fix-lints subagents have tighter tool permissions

Subagent policy is configuration, while the subagent's live execution state is runtime state.

## Recommended Config Domains

The first version should keep the number of domains small and practical.

### `providers`

Provider profiles and non-secret connection settings.

Examples:

- provider kind
- profile name
- API base URL
- organization or project id later if needed
- auth reference type

### `model_profile`

Configuration should select a platform-managed model profile.

The runtime should ask for a logical profile like:

- `reasoning_default`
- `reasoning_fast`

The platform-owned registry should resolve that profile to:

- provider kind
- provider profile
- concrete provider model name

End-user config should not define arbitrary provider model mappings.

### `profiles`

Reusable common configuration bundles.

Profiles are how Comet should support "common/shared" settings without repeating fields everywhere.

A profile may group:

- default model
- provider profile
- approval mode
- sandbox mode
- session mode
- web usage default
- planning defaults

### `subagents`

Policy by subagent kind or named role.

Examples:

- `deep_search`
- `fix_lints`
- `spec`
- `task`

Each may override:

- model
- provider profile
- approval mode
- sandbox mode
- tool allow/deny lists later

### `tui`

Frontend preferences that matter to the local terminal client.

Examples:

- default session mode
- thinking visibility
- pane layout
- compact or verbose tool rendering
- contextual hints
- theme selection
- onboarding policy

### `workspaces`

Path-scoped overrides applied when the current working directory matches a configured workspace rule.

This is how Comet should support "project A uses model X, project B uses model Y" without changing the global config each time.

## Recommended TOML Shape

The exact schema can still evolve, but it should be close to this shape:

```toml
version = 1
includes = ["./team.toml"]

[defaults]
profile = "coding"
session_mode = "agent"

[providers.openai.default]
api_base = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"

[profiles.coding]
model_profile = "reasoning_default"
provider = "openai/default"
sandbox_mode = "workspace-write"
approval_mode = "on-request"

[profiles.review]
inherits = "coding"
model_profile = "reasoning_fast"
session_mode = "chat"

[subagents.deep_search]
model_profile = "reasoning_fast"
approval_mode = "never"

[tui]
default_mode = "chat"
show_thinking = true
show_hints = true
theme = "comet"
tool_rendering = "compact"
onboarding = "auto"

[workspaces."/Users/lance/Desktop/comet"]
profile = "coding"
```

Current implementation status:

- recommended workspace path: `.comet/config.toml`
- recommended user path: `~/.comet/config.toml`
- example file in repo: `.comet/config.toml.example`
- currently implemented parser support:
- `[providers.openai.<profile>]`
- `[profiles.<name>]`
- `[defaults]`
- `[workspaces.<absolute_path>]`
- `[tui]`
- `includes = ["..."]`
- profile inheritance via `profiles.<name>.inherits`
The current code uses the structured `providers/profiles/defaults` shape with platform-managed `model_profile` ids.

Current `[tui]` parser support:

- `default_mode`
- `show_thinking`
- `show_hints`
- `theme`
- `tool_rendering`
- `onboarding`

Current load/resolve pipeline status:

- include files are loaded relative to the declaring file
- include cycles are rejected
- profile inheritance is resolved at load time
- profile inheritance cycles are rejected
- resolved session defaults apply this order:
  1. built-in defaults
  2. loaded config (includes + main file)
  3. matched workspace override
  4. selected profile
  5. explicit override layers (session/turn/subagent)

## Merge And Override Rules

These rules should be strict and documented because configuration bugs are almost always precedence bugs.

### Source Precedence

From lowest to highest:

1. built-in defaults
2. included files, in listed order
3. the current config file
4. matched workspace override
5. selected reusable profile
6. explicit session creation overrides
7. explicit turn overrides
8. explicit subagent spawn overrides

Subagent defaults are a special case:

- a subagent starts from the fully resolved parent turn config
- then applies its configured subagent policy
- then applies explicit spawn overrides

### Value Merge Rules

The first version should keep merge rules simple:

- scalar values: last writer wins
- objects: deep merge by field
- maps: merge by key
- arrays: replace, do not append implicitly

Replacing arrays by default is important because append semantics make it hard to reason about tool allowlists, workspace lists, and UI ordering.

### Includes

Includes should be resolved relative to the file that declares them.

The config crate should detect:

- include cycles
- profile inheritance cycles
- duplicate logical model ids when that would become ambiguous

## Secrets And Auth

The config file should not require raw API keys to be stored in plaintext.

The first version should support secret references such as:

- environment variable reference
- OS keychain reference later
- external command reference later if needed

Durable runtime records should store at most:

- provider profile id
- provider kind
- non-secret connection metadata

Durable runtime records should not store:

- raw API keys
- bearer tokens
- copied secret material from the environment

## Resolved Snapshots

The runtime should not read TOML files on every tool call or provider request.

Instead, session creation should produce a resolved snapshot.

Recommended resolved types:

- `ResolvedAppConfig`
- `ResolvedSessionConfig`
- `ResolvedTurnConfig`
- `ResolvedSubagentConfig`

Current implementation note:

- `comet-config` now exposes `ResolvedSessionConfig` and `ResolvedSubagentConfig`
- resolver entry points:
  - `AppConfig::load_resolved_for_path(cwd, overrides)`
  - `AppConfig::load_resolved_subagent_for_path(cwd, subagent_name, parent, overrides)`
- provider adapters should consume resolved config snapshots instead of reading raw `AppConfig`.
- `StartSession` now carries an explicit resolved session snapshot so `core` does not reconstruct config from partial wire fields.

Important rule:

Once a session starts, it should keep using its resolved session snapshot until the user explicitly reloads or recreates that session.

That avoids confusing behavior where:

- a config file changes in the middle of a run
- the same session suddenly changes model or approval policy
- replay becomes non-deterministic

## Persistence Boundary

Comet should separate configuration persistence from runtime persistence.

### The `config` crate should own

- loading config sources
- validating them
- merging them
- resolving them into immutable snapshots
- writing config files back atomically when the product adds create or modify flows

### `core` should own

- session lifecycle
- thread and turn persistence
- storing the resolved runtime snapshot needed for replay
- storing per-turn and per-subagent override metadata

### `comet-api` should own

- consuming already resolved provider settings (`ResolvedSessionConfig`)
- not parsing TOML itself
- not using raw `AppConfig` as its primary runtime adapter input
- not becoming the generic home for reusable transport client setup

### `comet-client` should own

- transport defaults that are shared across provider integrations or Rust clients
- reusable HTTP, SSE, WebSocket, or IPC client configuration
- retry, timeout, and connection policy defaults that are transport concerns rather than provider semantics

This boundary matters because config files are user intent, while thread logs are runtime history.

## How This Fits Current Code

Today, several configuration concerns are still local defaults:

- `OpenAiAdapterConfig` owns provider auth env var and base URL
- OpenAI provider mapping logic still lives in `comet-api`
- some provider transport concerns still live too close to `comet-api`
- `StartSession` directly carries model, sandbox, and approval settings

That suggests the first migration steps:

1. keep model/profile data in `config` and avoid provider runtime logic in `config`
2. load provider profiles from config rather than adapter-local defaults
3. keep `StartSession` wire fields aligned with the resolved snapshot and reject mismatches
4. later add explicit `profile` and `overrides` fields if protocol evolution needs them

Current `comet-rs/config` module shape follows this split:

- `schema.rs`: typed TOML config schema
- `state.rs`: discovery, loading, and resolved runtime snapshots
- `providers.rs`: provider profile data structures
- `merge.rs`: TOML merge utilities
- `values.rs`: typed config value parsers and protocol conversions
- `model_profiles.rs`: platform-owned model profile registry
- `overrides.rs`: override layer construction helpers
- `diagnostics.rs`: typed config diagnostic formatting

## Recommended Implementation Order

Comet should implement this in phases.

### Phase 1

Documentation only:

- define the configuration model
- define the crate boundary
- define precedence and persistence rules

### Phase 2

Introduce `comet-rs/config`:

- parse `config.toml`
- support built-in defaults plus one user config file
- resolve logical model ids and provider profiles

### Phase 3

Add workspace overrides and profile inheritance:

- `.comet/config.toml`
- workspace matching by cwd
- reusable profiles

### Phase 4

Persist resolved session snapshots in runtime storage:

- session start records store the resolved config snapshot needed for replay
- turn records store only the explicit override delta

### Phase 5

Add mutation flows:

- create config file
- modify config keys safely
- validate before write
- write atomically

## Non-Goals For The First Version

The first configuration version should not try to solve everything.

It should not initially require:

- remote config sync
- live hot reload during a running turn
- arbitrary expression languages inside config
- frontend-specific config formats separate from Rust

## Recommendation

Yes: Comet should document the configuration system first, then build a dedicated `config` crate, then add persistence.

That order is safer because it fixes the boundaries before the data becomes durable.
