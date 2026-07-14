# Comet Tests

## Contents

Comet keeps source tests beside the code they exercise and application-level
test support under this folder. Refer to:

- Unit tests: `*.test.ts` beside their owning modules or under the owning
  `test` directory ([runner](unit/README.md),
  [guidelines](../.github/instructions/writing-test.instructions.md)).
- Integration tests: `*.integrationTest.ts` beside the subsystem whose real
  runtime or process boundary they exercise
  ([runner](unit/README.md),
  [guidelines](../.github/instructions/writing-test.instructions.md)).
- `automation`: reusable Playwright drivers and Comet page objects
  ([README](automation/README.md)).
- `smoke`: automated user-visible flows against the built Electron application
  ([README](smoke/README.md)).
