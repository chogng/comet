# Editor IME Smoke

This checklist is the release gate for native IME behavior that cannot be fully covered by `jsdom`.

## Why this exists

- `npm run test:editor` now covers our composition, focus-restore, prop-sync, and DOM integration logic.
- It does **not** exercise the real macOS input method candidate UI.
- For Apple Pinyin and other native IMEs, we still need one short manual pass before release.

## Environment

- macOS
- System input source: Apple Pinyin
- App build: latest local branch build
- Test page: open a draft tab in the writing editor

## Checklist

1. Focus the editor and type `ni`, then press `Space`.
Expected: `你` is committed and the editor keeps focus.

2. Continue typing `hao`, then press `Space`.
Expected: `好` is committed immediately after `你`, without losing focus.

3. Type a longer phrase such as `zhongwen shuru ceshi`, using `Space` to commit each candidate.
Expected: repeated commit cycles continue to work.

4. Start composition, do **not** commit yet, then click a ribbon button that uses `mousedown.preventDefault()`.
Expected: selection stays stable and composition is not broken by toolbar interaction.

5. Start composition, commit a candidate, then continue typing another Chinese word immediately.
Expected: no one-character-only regression, no unexpected blur.

6. Insert a citation or figure, then return to text input and continue Chinese typing.
Expected: editor remains editable and IME still works.

7. Switch to another tab and switch back to the draft tab.
Expected: text input still works and focus restoration does not trap the user.

## If this fails

- Record the exact input sequence.
- Record whether failure happened:
  - before `compositionend`
  - immediately after candidate commit
  - after an outer workbench rerender
  - after toolbar interaction
- Check:
  - `src/ls/workbench/browser/readerPageView.ts`
  - `src/ls/editor/browser/text/input.ts`
  - `src/ls/editor/browser/text/sync.ts`
  - `src/ls/editor/browser/text/editor.ts`
