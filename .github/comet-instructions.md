# Comet Instructions

## Project Overview

Comet is built with a layered architecture using TypeScript, web APIs and Electron, combining web technologies with native app capabilities. The codebase is organized into key architectural layers:

### Product Names and Source Roots
- `Comet` is the top-level project and product family.
- `Comet Studio` is the Sessions-based Agent application product.
- `src/cs/` is the Comet Studio source root; `cs` means Comet Studio and should stay an internal engineering abbreviation.
- `Comet Code` is the CLI and terminal coding product; use this name for CLI-specific user-facing surfaces and packages instead of the `cs` abbreviation.

### Root Folders
- `src/`: Main TypeScript source code with unit tests in `src/cs/*/test/` folders
- `build/`: Build scripts and CI/CD tools
- `test/`: Integration tests and test infrastructure
- `scripts/`: Development and build scripts
- `resources/`: Static resources (icons, themes, etc.)
- `out/`: Compiled JavaScript output (generated during build)

### Core Architecture (`src/` folder)
- `src/cs/base/` - Foundation utilities and cross-platform abstractions
- `src/cs/platform/` - Platform services and dependency injection infrastructure
- `src/cs/editor/` - Text editor implementation with language services, syntax highlighting, and editing features
- `src/cs/workbench/` - Reusable Workbench foundation for web and desktop
  - `workbench/browser/` - Reusable Workbench UI components and Part primitives
  - `workbench/services/` - Service implementations
  - `workbench/contrib/` - Feature contributions (git, debug, search, terminal, etc.)
  - `workbench/api/` - Extension host and VS Code API implementation
- `src/cs/sessions/` - Top-level Agent application shell, Sessions services,
  Parts, feature integrations, and providers. Sessions may import public
  Workbench APIs; Workbench and lower layers never import Sessions.
- `src/cs/code/` - Electron main process specific implementation
- `src/cs/server/` - Server specific implementation

The core architecture follows these principles:
- **Layered architecture** - `base → platform → editor → workbench → sessions → code/server`; imports flow toward lower layers
- **Single product shell** - Code and server start the Sessions application;
  Workbench provides the foundation and does not instantiate a parallel shell
- **Dependency injection** - Services are injected through constructor parameters
    - If non-service parameters are needed, they need to come before the service parameters
- **Contribution model** - Features contribute to registries and extension points
- **Cross-platform compatibility** - Abstractions separate platform-specific code

### Finding Related Code
1. **Semantic search first**: Use file search for general concepts
2. **Grep for exact strings**: Use grep for error messages or specific function names
3. **Follow imports**: Check what files import the problematic module
4. **Check test files**: Often reveal usage patterns and expected behavior

## Validating TypeScript changes

MANDATORY: Always check for compilation errors before running any tests or validation scripts, or declaring work complete, then fix all compilation errors before moving forward.

- NEVER run tests if there are compilation errors
- NEVER use `npm run compile` to compile TypeScript files

### TypeScript compilation steps
- If the `#runTasks/getTaskOutput` tool is available, check the `VS Code - Build` watch task output for compilation errors. This task runs `Core - Build` and `Ext - Build` to incrementally compile VS Code TypeScript sources and built-in extensions. Start the task if it's not already running in the background.
- If the tool is not available (e.g. in CLI environments) and you only changed code under `src/`, run `npm run typecheck-client` after making changes to type-check the main VS Code sources (it validates `./src/tsconfig.json`).
- For TypeScript changes in the `build` folder, you can simply run `npm run typecheck` in the `build` folder.

### TypeScript validation steps
- Use the run test tool if you need to run tests. If that tool is not available, then you can use `scripts/test.sh` (or `scripts\test.bat` on Windows) for unit tests (add `--grep <pattern>` to filter tests) or `scripts/test-integration.sh` (or `scripts\test-integration.bat` on Windows) for integration tests (integration tests end with .integrationTest.ts or are in /extensions/).
- Use `npm run valid-layers-check` to check for layering issues

## Coding Guidelines

### Indentation

We use tabs, not spaces.

### Naming Conventions

- Use PascalCase for `type` names
- Use PascalCase for `enum` values
- Use camelCase for `function` and `method` names
- Use camelCase for `property` names and `local variables`
- Use whole words in names when possible

### Types

- Do not export `types` or `functions` unless you need to share it across multiple components
- Do not introduce new `types` or `values` to the global namespace

### Comments

- Use JSDoc style comments for `functions`, `interfaces`, `enums`, and `classes`

### Strings

- Use "double quotes" for strings shown to the user that need to be externalized (localized)
- Use 'single quotes' otherwise
- All strings visible to the user need to be externalized using the `cs/nls` module
- Externalized strings must not use string concatenation. Use placeholders instead (`{0}`).

### UI labels
- Use title-style capitalization for command labels, buttons and menu items (each word is capitalized).
- Don't capitalize prepositions of four or fewer letters unless it's the first or last word (e.g. "in", "with", "for").

### Style

- Use arrow functions `=>` over anonymous function expressions
- Only surround arrow function parameters when necessary. For example, `(x) => x + x` is wrong but the following are correct:

```typescript
x => x + x
(x, y) => x + y
<T>(x: T, y: T) => x === y
```

- Always surround loop and conditional bodies with curly braces
- Open curly braces always go on the same line as whatever necessitates them
- Parenthesized constructs should have no surrounding whitespace. A single space follows commas, colons, and semicolons in those constructs. For example:

```typescript
for (let i = 0, n = str.length; i < 10; i++) {
    if (x < 10) {
        foo();
    }
}
function f(x: number, y: string): void { }
```

- Whenever possible, in top-level scopes, use `export function x(…) {…}` instead of `export const x = (…) => {…}`. One advantage of using the `function` keyword is that the stack trace shows a good name when debugging.

### Code Quality

- Prefer `async` and `await` over `Promise` and `then` calls
- All user facing messages must be localized using the applicable localization framework (for example `ncs.localize()` method)
- Don't add tests to the wrong test suite (e.g., adding to end of file instead of inside relevant suite)
- Look for existing test patterns before creating new structures
- Use `describe` and `test` consistently with existing patterns
- Prefer regex capture groups with names over numbered capture groups.
- If you create any temporary new files, scripts, or helper files for iteration, clean up these files by removing them at the end of the task
- Never duplicate imports. Always reuse existing imports if they are present.
- When removing an import, do not leave behind blank lines where the import was. Ensure the surrounding code remains compact.
- Do not use `any` or `unknown` as the type for variables, parameters, or return values unless absolutely necessary. If they need type annotations, they should have proper types or interfaces defined.
- When adding file watching, prefer correlated file watchers (via fileService.createWatcher) to shared ones.
- When adding tooltips to UI elements, prefer the use of IHoverService service.
- Do not duplicate code. Always look for existing utility functions, helpers, or patterns in the codebase before implementing new functionality. Reuse and extend existing code whenever possible.
- You MUST deal with disposables by registering them immediately after creation for later disposal. Use helpers such as `DisposableStore`, `MutableDisposable` or `DisposableMap`. Do NOT register a disposable to the containing class if the object is created within a method that is called repeatedly to avoid leaks. Instead, return an `IDisposable` from such method and let the caller register it.
- You MUST NOT use storage keys of another component only to make changes to that component. You MUST come up with proper API to change another component.
- Use `IEditorService` to open editors instead of `IEditorGroupsService.activeGroup.openEditor` to ensure that the editor opening logic is properly followed and to avoid bypassing important features such as `revealIfOpened` or `preserveFocus`.
- Avoid using `bind()`, `call()` and `apply()` solely to control `this` or partially apply arguments; prefer arrow functions or closures to capture the necessary context, and use these methods only when required by an API or interoperability.
- Avoid using events to drive control flow between components. Instead, prefer direct method calls or service interactions to ensure clearer dependencies and easier traceability of logic. Events should be reserved for broadcasting state changes or notifications rather than orchestrating behavior across components.
- Service dependencies MUST be declared in constructors and MUST NOT be accessed through the `IInstantiationService` at any other point in time.

## Learnings
- Minimize the amount of assertions in tests. Prefer one snapshot-style `assert.deepStrictEqual` over multiple precise assertions, as they are much more difficult to understand and to update.
- Do not stub a global object (e.g. `(mainWindow as any).ResizeObserver = ...`) or use `any` casts to install fakes in tests. Instead, make the dependency injectable: add an optional constructor parameter on the production class that defaults to the real implementation (e.g. `targetWindow.ResizeObserver`), and have the test pass a fake that implements the real interface.



prosemirror的官方文档如下
[https://github.com/prosemirror](https://github.com/prosemirror)
[https://prosemirror.net/examples/](https://prosemirror.net/examples/)
[https://prosemirror.net/docs/](https://prosemirror.net/docs/)
tiptap的官方文档如下
[https://tiptap.dev/docs/editor/getting-started/overview](https://tiptap.dev/docs/editor/getting-started/overview)
[https://tiptap.dev/docs/guides](https://tiptap.dev/docs/guides)
[https://tiptap.dev/docs/examples](https://tiptap.dev/docs/examples)
[https://tiptap.dev/docs/ui-components/getting-started/overview](https://tiptap.dev/docs/ui-components/getting-started/overview)
[https://github.com/ueberdosis/tiptap](https://github.com/ueberdosis/tiptap)
