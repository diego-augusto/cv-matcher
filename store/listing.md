# Chrome Web Store listing

Text to paste into the developer dashboard (https://chrome.google.com/webstore/devconsole). Keep it in sync with the extension when permissions or data handling change.

## Package

The zip attached to the GitHub release of the tag (`cv-matcher-vX.Y.Z.zip`, built by CI from `src/`). Every upload needs a `version` higher than the last one.

## Store listing

- **Name:** CV Matcher
- **Summary:** taken from `description` in `src/manifest.json`.
- **Category:** Productivity → Tools
- **Language:** English (add Portuguese and Spanish listings with the same text translated)
- **Icon:** `src/icons/icon128.png`
- **Screenshots (1–5, 1280×800):** the popup over a job posting, the result tab with the requirements panel, the setup view.
- **Small promo tile (440×280):** required.
- **Homepage URL:** https://diego-augusto.github.io/cv-matcher/
- **Support URL:** https://github.com/diego-augusto/cv-matcher/issues

### Description

CV Matcher writes a résumé tailored to the job posting open in your current tab.

Each company screens applications with its own applicant tracking system (ATS), which scores your résumé against that one posting. A single generic résumé loses points everywhere, so the usual advice is to tailor it to every job. CV Matcher does that in one click.

How it works:
• Paste your full résumé once, or import it from a PDF.
• Open any job posting and click "Generate résumé for this job".
• Claude selects, reorders and rewrites what is in your résumé, using the posting's own terms. It never invents experience, skills or results you did not state.
• See which requirements of the job are covered and which are missing.
• Edit any line, then print or save as PDF.

The résumé is written in the language of the posting. The interface is available in English, Portuguese and Spanish.

You need your own Anthropic API key (platform.claude.com); each generation is billed to your Anthropic account. There is no CV Matcher server, no account and no analytics: your key and résumé stay in your browser and are sent only to api.anthropic.com.

## Privacy practices

### Single purpose

Generate a résumé tailored to the job posting on the current tab, from the résumé the user provides.

### Permission justifications

- **activeTab:** read the text of the job posting on the current tab, only when the user clicks the generate button.
- **scripting:** run the one-off script that reads `document.body.innerText` of that tab; nothing is injected into pages otherwise.
- **storage:** keep the user's API key, source résumé, settings and recently generated résumés in local storage on their device.
- **Host permission `https://api.anthropic.com/*`:** send the résumé and the posting text to the Claude API, the service that generates the tailored résumé. It is the only network request the extension makes.

### Remote code

No. All JavaScript ships in the package; the extension only exchanges JSON with the Claude API.

### Data usage

Data handled (all of it sent only to api.anthropic.com, on the user's request, and otherwise stored only on the device):

- [x] Personally identifiable information: the résumé the user provides (name, contact details, work history).
- [x] Authentication information: the user's Anthropic API key.
- [x] Website content: the text of the job posting page.

Certifications (all three checked):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

https://diego-augusto.github.io/cv-matcher/#privacy

## Publishing from CI

After the first version is uploaded by hand, CI uploads the release zip of every tag and submits it for review (`release` job in `.github/workflows/ci.yml`). One-time setup:

1. In Google Cloud, enable the Chrome Web Store API in a project and create a service account with a JSON key.
2. In the developer dashboard, Account → add the service account's email.
3. In the GitHub repo settings: secret `CWS_SERVICE_ACCOUNT_KEY` (the JSON key), variables `CWS_PUBLISHER_ID` and `CWS_ITEM_ID` (both shown in the dashboard).

## After approval

Replace the manual install steps with the store link in `README.md` (Installation) and in `docs/index.html` (`#install`, keys `install.*` in `docs/page.js` for pt and es).
