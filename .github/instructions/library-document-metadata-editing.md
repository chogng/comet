# Library Document Metadata Editing

This document records the current stopping point for library item editing and the next planned step.

## Current State

The knowledge base item context menu currently supports three actions:

- Rename
- Edit source URL
- Delete

These actions are intentionally minimal. They are enough for tree-level maintenance, but they do not cover full library metadata management.

## Planned Upgrade

The future goal is to replace the current single-field "edit source URL" flow with a complete metadata editing flow for a library document.

Planned editable fields:

- Title
- DOI
- Authors
- Journal title
- Published date
- Source URL

Depending on storage coverage, we may also extend this to abstract/description later, but that is not part of the current target.

## Planned Interaction

The likely interaction model is:

1. Right-click a library document item
2. Choose a dedicated metadata edit action
3. Open a full metadata form modal instead of a single text input
4. Submit changes through `upsert_library_document_metadata`
5. Refresh the shared library summary so tree, editor, and assistant surfaces all observe the same updated metadata

## Why This Is Deferred

The current priority is fetch quality.

Right now the more urgent issue is that metadata extraction can be incomplete at ingest time. Expanding the manual edit UI before stabilizing the fetch/parser layer would push complexity into the wrong place and make the product feel inconsistent.

So the sequence is:

1. Improve fetch/parser completeness
2. Keep the current lightweight rename / source URL / delete actions
3. Come back and upgrade editing into full metadata management

## Design Constraint

When full metadata editing is implemented, it should update the canonical stored document metadata rather than maintaining a tree-only UI patch layer.
