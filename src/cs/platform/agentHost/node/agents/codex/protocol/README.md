# Codex app-server protocol

The TypeScript bindings in `generated/` come from the exact
`@openai/codex` version pinned by
`build/agent-sdk/agents/codex/package.json`.

Generate them with:

```text
npm run codex:gen-protocol
```

Verify the committed tree without modifying it with:

```text
npm run codex:check-protocol
```

The generator resolves only the pinned build dependency binary. It does not use
an ambient Codex installation. Generated files and `protocolMetadata.ts` must
not be edited manually.
