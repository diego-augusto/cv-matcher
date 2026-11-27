# CV Matcher

> Beta 0.0.1. For now, it works only with Claude, by Anthropic.

A Chrome extension that generates a résumé tailored to the job posting open on the current tab, using Claude.

It reads the page text, combines it with your full résumé, and returns a version of up to two pages that highlights what is most relevant to that job, ready to save as a PDF.

Project page: <https://diego-augusto.github.io/cv-matcher/>

## Installation

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `src` folder.

## Setup

Click the extension icon. The first time, the popup opens straight into setup; afterwards, setup is behind the settings button in the corner of the popup. Fill in:

- **Anthropic API key** (`sk-ant-...`), created at [platform.claude.com](https://platform.claude.com).
- **Model** used for generation.
- **Interface language** (Portuguese, English or Spanish) and **theme** (system, light or dark). This does not change the language of the generated résumé, which follows the job posting.
- **Your full résumé**, as plain text or Markdown. Paste everything: experience, projects, skills, education and contact details. The extension only uses what is here, so the more complete it is, the better the selection for each job.

Everything is saved automatically. To edit the résumé with more room, open the same screen as a tab under **Details → Extension options**.

## Usage

1. Open a job posting (any site).
2. Click the extension icon, then **Generate résumé for this job**.
3. Wait for the generation in the new tab (about a minute); you can cancel it.
4. Click the text to adjust anything. Edits are saved.
5. Check the page estimate and click **Print / Save PDF**.

The last résumé is kept: reloading the tab or reopening it from the popup shows what was saved, with no new API call. A new generation only happens from the popup button or from **Generate again**.

## Generation rules

- **Nothing invented:** the model selects, reorders and rewrites what is in your résumé, but does not add experience, skills or results you did not state.
- **Language:** the résumé is written in the language of the job posting.
- **Page as data:** instructions that appear in the page text are ignored.

To change these rules, edit the `SYSTEM` constant in `src/core.js`.

## Files

| File | Purpose |
|---|---|
| `src/` | The extension itself; this is the folder Chrome loads. |
| `src/manifest.json` | Extension manifest (Manifest V3). |
| `src/popup.html`, `src/popup.js` | Icon popup: generate button, model, key and résumé. Also the options page. |
| `src/result.html`, `src/result.js` | Calls the Claude API, renders the résumé, saves edits and handles printing. |
| `src/core.js` | Logic with no DOM: the prompt, the request, response parsing and error mapping. |
| `src/i18n.js` | Interface strings in the three languages, and theme handling. |
| `src/ui.css` | Colors and controls shared by both screens (light and dark theme). |
| `docs/` | The project page, served by GitHub Pages from `main`. Not part of the extension. |
| `test/core.test.mjs` | Unit tests for `core.js` and static checks on the extension files. |
| `test/check-i18n.mjs` | Checks that the three languages have the same keys. |
| `test/fake-resume.md` | Fictional résumé for testing. |

There is no build step and there are no dependencies. Run the tests with `npm test` (Node 22 or newer).

## Model and cost

The model is chosen in settings: Opus 5.5 (default), Sonnet 5.5, Haiku 5.5 or Fable 5.2. Each generation sends your résumé and the full page text, and is billed to your Anthropic account.

## Privacy

- The key and the résumé are stored in `chrome.storage.local`, unencrypted, only in this browser.
- Data is sent only to `api.anthropic.com`.
- The extension reads a page only when you click generate (`activeTab` permission).

## Limitations

- Chrome's internal pages (`chrome://`, the Web Store) cannot be read.
- Postings that load the description inside an iframe may come through without the text; in that case, open the posting on its own page.
- No history: only the last résumé is kept, and each generation replaces the previous one.
- The on-screen page count is an estimate for A4 paper.
