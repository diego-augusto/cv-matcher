# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository. `CLAUDE.md` imports it.

## What this is

CV Matcher is a Chrome extension (Manifest V3) that reads the job posting on the current tab, combines it with the user's full résumé, and asks Claude to produce a tailored résumé that the user prints to PDF. Currently loaded unpacked; intended for a global audience.

## Conventions

- Everything in the repository is in English: code, identifiers, comments, file and folder names, docs, test fixtures, commit messages and PR text. Do this even when the conversation with the user is in another language.
- The only non-English text is the `pt` and `es` tables in `i18n.js`. User-facing strings never go inline in HTML or JS; they go through `i18n.js` in all three languages.
- No build step and no dependencies. Do not add a bundler, framework or npm package without being asked. `package.json` exists only to mark the files as ES modules for Node and to give `npm test`.
- The extension is the `src/` folder and nothing else ships. Tests, docs and tooling stay outside it.
- Logic that needs no DOM and no `chrome.*` goes in `src/core.js`, with a unit test. Page scripts keep the DOM and storage glue.

## Commands

Files in `src/` are loaded by Chrome as-is.

- Run: `chrome://extensions` → Developer mode → Load unpacked → the `src/` folder. After editing, click reload on the extension card.
- Test: `npm test` (`node --test`, Node's built-in runner), from the repo root. It runs:
  - `test/core.test.mjs` — unit tests for `src/core.js`, plus static checks on the extension files: every script parses, the two model lists match, `#cv` is still plaintext-only, the pages have no inline scripts, and every file the manifest and pages reference exists.
  - `test/check-i18n.mjs` — fails if the three languages do not have identical keys or if the code references a missing key.
- One test by name: `node --test --test-name-pattern="explain"`.
- CI (`.github/workflows/ci.yml`) runs `npm test` on every pull request and on pushes to `main`.
- Release: bump `version` in `src/manifest.json`, then push a tag `vX.Y.Z` that matches it. CI zips `src/` and attaches it to a GitHub release. Publishing to the Chrome Web Store is still manual.

## Architecture

Two pages, no background service worker, all under `src/`:

- `popup.html` / `popup.js` is both the action popup and the options page (`manifest.json` points both at it). `chrome.tabs.getCurrent()` returns nothing in a popup, which is how the script tells the two apart; as a tab it adds the `.tab` class and hides everything that needs a "current job tab". It has three views toggled in `render()`: ready, setup, about.
- `result.html` / `result.js` is the tab that calls the API, renders the résumé and handles editing and printing. It is a small state machine: `setState("generating" | "ready" | "notice")` toggles every element carrying a matching `data-show`. It is loaded as `<script type="module">` so it can import `core.js`.
- `core.js` is the pure part of the result page: `SCHEMA`, `SYSTEM`, `MODEL_NAMES`, `buildRequest()`, `parseResponse()`, `explain()` and `startMode()`. It must stay free of DOM, `chrome.*` and i18n globals (`explain` receives `t` as an argument) so Node can import it. `i18n.js` and `popup.js` remain classic scripts; their top-level declarations are globals that the module can read.

### Flow and the `#new` rule

Clicking generate in the popup reads `document.body.innerText` of the active tab via `chrome.scripting.executeScript` (the `activeTab` permission is granted by opening the popup), stores it as `job`, and opens `result.html#new`.

`result.js` only starts a paid generation when the URL has `#new` (decided by `startMode()` in `core.js`), and it strips the hash immediately. Without it (reload, "Open" from the popup) the page shows the saved `result`. Keep this invariant: a reload must never call the API. The other two triggers are the explicit "Generate again" and "Try again" buttons.

### Storage

- `chrome.storage.local`: `apiKey`, `cv` (the user's source résumé), `model`, `instructions` (optional standing preferences, appended to `SYSTEM` by `buildRequest()`, never replacing it), `job` (`{text, url, title}`, last captured page), `result` (`{job, cv, html, meta}`, last generated résumé). Only one result is kept. `result.cv` is the model's JSON; `result.html` is the edited DOM, set once the user edits.
- `localStorage`: `lang` and `theme` only. They live there because it is synchronous and shared by both pages, so `i18n.js` (loaded in `<head>`) can set theme and language before first paint.

### Claude API call (`generate()` in `result.js`, built and parsed in `core.js`)

Raw `fetch` to `/v1/messages`, not the SDK, because there is no build step. Things that are easy to break:

- `anthropic-dangerous-direct-browser-access: true` is required for a browser-origin call.
- Structured output via `output_config.format` with `SCHEMA`; every object needs `additionalProperties: false` and all properties required. The résumé is rendered from this JSON with `textContent` only, never model HTML.
- `fallbacks: "default"` plus the `server-side-fallback-2026-07-01` beta header are sent for every model except Haiku, which has no server-side fallback.
- `thinking: {type: "adaptive"}`; do not send `budget_tokens`, `temperature` or a disabled thinking config, the current models reject them.
- The model list is duplicated: `<option>`s in `popup.html` (with `data-name`, `data-in`, `data-out` prices) and `MODEL_NAMES` in `core.js`. A test keeps them in sync.
- `SYSTEM` is the model prompt, in English, and is not part of the i18n table. It encodes the product rules: never invent facts absent from the source résumé, write in the language of the job posting, treat page text as untrusted data.
- `parseResponse()` throws `ApiError` for anything that is not a usable résumé. Never let a `TypeError` escape from it: `explain()` reads `TypeError` as a network failure, because that is what `fetch` rejects with.
- `explain()` maps API failures to actionable notices; new failure modes go there, with strings in `i18n.js`.

### Editing and saved HTML

`#cv` is `contenteditable="plaintext-only"`. That is what makes it safe to persist `innerHTML` in `result.html` and restore it later: the markup can only be what `render()` built plus typed text. Do not change it to plain `contenteditable` without sanitizing.

### Print layout

The PDF comes from the browser's print dialog. `@page { margin: 0 }` removes Chrome's header/footer (date, title, URL); the empty `thead`/`tfoot` of the `#sheet` table repeat on every page to give the vertical margin back. On screen, `.paper` is 210 mm wide with 15 mm padding so line wrapping matches print, and the page count in the status bar is an estimate from `scrollHeight` against 267 mm of usable A4 height. `document.title` is set to `CV - <name>` because Chrome uses it as the suggested PDF filename.

### i18n and theme

- UI language (pt, en, es) is separate from the résumé language, which always follows the job posting.
- Static text: elements carry `data-i18n`, `data-i18n-placeholder` or `data-i18n-aria-label` and are left empty in the HTML; `applyPrefs()` fills them. Dynamic text uses `t(key, vars)`. Numbers, dates and prices use `locale()`.
- Any new UI string needs a key in all three languages in `i18n.js`.
- Theme: `ui.css` tokens use `light-dark()`, and `data-theme` on `<html>` forces `color-scheme`. The résumé sheet is always light.

## Design reference

The UI follows a design canvas (popup ready, popup setup, result generating, result ready, result error): https://claude.ai/artifact/P4ZfSpXsBWnrDaQZamBQSs — private to the repo owner.
