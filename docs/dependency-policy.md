# Dependency Policy

This repository uses npm with `package-lock.json` as the source of truth for dependency resolution.

## Install

Use the lockfile-preserving install path:

```bash
npm ci
```

On Windows PowerShell, prefer the npm command shim if script execution policy blocks `npm.ps1`:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' ci
```

## Version Changes

Do not run broad dependency updates as part of regular feature or bug-fix work.

Dependency version changes should be made only when there is a specific reason, such as:

- a required security fix
- a required runtime or build-tool compatibility fix
- a bug fix that is known to be delivered by a specific package version

When a dependency change is required, keep it in a dedicated commit or pull request when practical, and include the relevant build or test verification.

## Package Manager

Do not introduce another package manager lockfile unless the repository intentionally migrates package managers.

Keep using:

- `package.json`
- `package-lock.json`

Do not add:

- `pnpm-lock.yaml`
- `yarn.lock`
