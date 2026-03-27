# Adding Model Profiles

## Goal

This document defines the standard process for adding new platform-managed `model_profile` entries in Comet.

The intent is to keep model selection centralized and auditable:

- internal callers choose a stable `model_profile`
- the platform registry resolves that profile to provider routing
- adapters consume resolved provider targets

Comet should not reintroduce adapter-local alias tables or user-managed provider model mappings.

## Short Answer

If the provider is already supported, adding a new model should usually mean:

1. add a new `model_profile` entry in the registry
2. point it at the correct provider and official provider model id
3. add tests
4. update the routing audit

If the provider is not yet supported, adding a model also requires a new adapter implementation.

## Terms

### `model_profile`

Platform-managed internal model selector.

Examples:

- `reasoning_default`
- `reasoning_fast`

This is the field internal callers should choose.
It should remain stable even if Comet later changes the exact provider model behind it.

### `provider_model_id`

The official model id expected by a provider API.

Examples:

- OpenAI: `gpt-5.4`
- OpenAI: `gpt-5.4-mini`
- Anthropic later: `claude-*`

This is not chosen directly by internal callers.
It is produced by the registry.

### `provider`

The provider route that should receive the request.

Today that includes:

- provider kind
- provider profile

## Standard Flow

Comet model selection should follow this path:

1. caller selects `model_profile`
2. registry resolves `model_profile -> provider + provider_model_id`
3. runtime stores the resolved result in session state
4. provider adapter consumes `provider_model_id`
5. adapter writes the official provider field

For OpenAI, that final write is the Responses API `model` field.

## Checklist For Adding A Model To An Existing Provider

Use this checklist when the provider adapter already exists, such as OpenAI.

### 1. Choose A Stable Internal Profile Id

Add a new platform-owned `model_profile` name.

Good examples:

- `reasoning_default`
- `reasoning_fast`
- `reasoning_high_context`

Avoid using the official provider model id as the internal primary identifier.

Reason:

- provider routing may change later
- one internal profile may later move to a newer provider model
- internal callers should not depend on provider-specific naming

### 2. Add The Registry Entry

Update the platform registry in:

- `comet-rs/protocol/src/model_registry.rs`

Each entry must define:

- `model_profile`
- `provider`
- `provider_model_id`

For OpenAI, `provider_model_id` must be the exact official model id from OpenAI documentation.
Do not invent aliases.

Template:

```rust
"reasoning_high_context" => Some(ResolvedProviderModel::new(
    model_profile,
    ProviderRef {
        kind: ProviderKind::OpenAi,
        profile: Some("default".to_string()),
    },
    "gpt-5.4",
)),
```

What to replace:

- `"reasoning_high_context"`: new internal `model_profile`
- `ProviderKind::OpenAi`: target provider
- `"default"`: provider profile
- `"gpt-5.4"`: official provider model id

### 3. Expose The Profile In The Supported List

Update:

- `supported_model_profiles()`

This keeps the supported internal profile list explicit and testable.

### 4. Add Tests

At minimum, add a test that verifies:

- the new `model_profile` resolves successfully
- `provider.kind` is correct
- `provider.profile` is correct
- `provider_model_id` matches the official provider model id

Also preserve the unknown-profile failure test.

Template:

```rust
#[test]
fn resolves_reasoning_high_context_profile() {
    let resolved =
        resolve_model_profile("reasoning_high_context").expect("resolve profile");

    assert_eq!(resolved.model_profile, "reasoning_high_context");
    assert_eq!(resolved.provider.kind, ProviderKind::OpenAi);
    assert_eq!(resolved.provider.profile.as_deref(), Some("default"));
    assert_eq!(resolved.provider_model_id, "gpt-5.4");
}
```

### 5. Update The Routing Audit

Update:

- `docs/model-routing-audit.md`

The audit entry should record:

- internal `model_profile`
- provider kind
- provider profile
- provider request field
- official provider model id
- any capability caveats relevant to routing review

## When Adapter Changes Are Not Needed

If the provider adapter already reads `provider_model_id` from the resolved session request, then adding a model should not require adapter code changes.

That is the current OpenAI path.

In that design, the adapter does not own model aliases.
It only writes the resolved official provider model id to the provider request.

## When Adapter Changes Are Required

Adapter changes are required when any of the following is true:

- the provider is new and has no adapter yet
- the provider request shape differs in a way the current adapter does not support
- the model requires provider-specific request options that Comet does not yet encode

Example:

- adding another OpenAI Responses model usually does not require adapter work
- adding Anthropic requires an Anthropic adapter even if the registry entry already exists

## What Not To Do

Do not do any of the following:

- add a second model alias table inside an adapter
- allow end users to define arbitrary provider model mappings in config
- push raw provider model strings through the internal protocol as the main model-selection path
- add a model based on memory instead of checking provider documentation

These patterns make model routing harder to audit and easier to break.

## Review Standard Before Merging

Before merging a new model profile, verify all of the following:

1. The provider model id was checked against official provider docs.
2. The registry entry resolves to the expected provider route.
3. Tests cover the new mapping.
4. The routing audit table was updated.
5. No adapter-local alias logic was added.

## Current Files To Touch

For a typical new OpenAI model profile, expect to update:

- `comet-rs/protocol/src/model_registry.rs`
- `docs/model-routing-audit.md`

Optionally also update:

- `docs/configuration-model.md`
- any user-facing config docs that mention supported profiles

## End-To-End Example

Example goal:

- add internal profile `reasoning_high_context`
- route it to OpenAI `default`
- send official model id `gpt-5.4`

Minimal registry change:

```rust
pub fn resolve_model_profile(model_profile: &str) -> Option<ResolvedProviderModel> {
    match model_profile {
        "reasoning_default" => Some(ResolvedProviderModel::new(
            model_profile,
            ProviderRef {
                kind: ProviderKind::OpenAi,
                profile: Some("default".to_string()),
            },
            "gpt-5.4",
        )),
        "reasoning_fast" => Some(ResolvedProviderModel::new(
            model_profile,
            ProviderRef {
                kind: ProviderKind::OpenAi,
                profile: Some("default".to_string()),
            },
            "gpt-5.4-mini",
        )),
        "reasoning_high_context" => Some(ResolvedProviderModel::new(
            model_profile,
            ProviderRef {
                kind: ProviderKind::OpenAi,
                profile: Some("default".to_string()),
            },
            "gpt-5.4",
        )),
        _ => None,
    }
}

pub fn supported_model_profiles() -> &'static [&'static str] {
    &["reasoning_default", "reasoning_fast", "reasoning_high_context"]
}
```

Minimal audit row:

| model_profile | provider kind | provider profile | provider request field | provider model id | tool calling | streaming | error body |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reasoning_high_context` | `openAi` | `default` | `responses.model` | `gpt-5.4` | Responses function tools | SSE | JSON `error.message` |

This example is intentionally simple.
If the new model needs provider-specific request semantics beyond selecting the official model id, that is no longer just a registry-only change and must be reviewed at the adapter boundary.

## Future Evolution

This document assumes the registry remains platform-owned and code-defined.

Comet may later move the registry to a control plane or managed platform config.
If that happens, the ownership model should stay the same:

- the platform owns the catalog
- internal callers choose `model_profile`
- adapters consume resolved provider targets

What should not change is the architectural boundary.
