---
description: One-time rules for migrating the old sessions source boundary into the Workbench.
applyTo: "src/cs/sessions/**"
---

# Sessions migration

Read `src/cs/sessions/MIGRATION.md` and all final architecture documents it
links before changing files under `src/cs/sessions/`.

Migrate files and affected call sites directly to their final Workbench owners.
Do not add new product logic, entry points, wrappers, facades, adapters, aliases,
re-exports, compatibility layers, or fallback behavior under the old boundary.

Delete superseded source and CSS in the same change that moves its call sites.
The migration is complete only when `src/cs/sessions/` can be deleted.
