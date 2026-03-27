# Model Routing Audit

## Goal

This document records the platform-managed `model_profile` registry and the provider-specific routing details it must map to.

The registry is the only supported source of truth for model selection inside Comet.
Adapters must consume resolved provider targets from this registry rather than keeping their own alias tables.

For the standard process to add a new profile, see [Adding Model Profiles](./adding-model-profiles.md).

## OpenAI

| model_profile | provider kind | provider profile | provider request field | provider model id | tool calling | streaming | error body |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reasoning_default` | `openAi` | `default` | `responses.model` | `gpt-5.4` | Responses function tools | SSE | JSON `error.message` |
| `reasoning_fast` | `openAi` | `default` | `responses.model` | `gpt-5.4-mini` | Responses function tools | SSE | JSON `error.message` |

Notes:

- OpenAI routing is implemented in the platform registry and consumed by `comet-api/openai`.
- The adapter writes `providerModelId` into the official Responses `model` field.
- This audit covers model routing only. It does not claim that all provider semantics are cross-provider equivalent.

## Anthropic Template

| model_profile | provider kind | provider profile | provider request field | provider model id | tool calling | streaming | error body | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tbd` | `anthropic` | `tbd` | `tbd` | `tbd` | `tbd` | `tbd` | `tbd` | pending |

Checklist before enabling Anthropic:

- Confirm the official model id to expose for each internal profile.
- Confirm the exact request field that carries the model id.
- Confirm tool-call payload shape and whether it maps cleanly to Comet `ToolRequest`.
- Confirm streaming event lifecycle and completion boundaries.
- Confirm error-body shape and stable extraction of a model-visible error message.
