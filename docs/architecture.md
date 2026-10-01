# Architecture

## Goals

The extension must work on job portals it has never seen. Instead of per-site
selectors, it builds a structural model of whatever page it is on (fields, labels,
sections, job context) and decides what to fill from that model plus the candidate
profile. Website-specific code paths are explicitly out of scope.

## Layers

```text
Webpage  (untrusted, has no access to candidate data)
   ↕ DOM only
Content script  (extension-isolated world)
   ↕ chrome.tabs.sendMessage (typed MessageEnvelope)
Background service worker  (gateway to storage and to the AI provider)
   ↕ chrome.storage
chrome.storage  (candidate profile, original resume, settings, saved answers)
```

| Layer | Lives in | Responsibility |
| --- | --- | --- |
| Content script | `extension/src/content/` | Scan DOM/shadow DOM, classify fields, execute fill plans, render the in-page review panel |
| Background worker | `extension/src/background/` | Message hub, storage access, AI proxy, settings, logging |
| Popup | `extension/src/popup/` | Status, candidate summary, analyze/autofill actions |
| Options | `extension/src/options/` | Profile view, resume upload, saved answers, settings |
| Intelligence | `extension/src/intelligence/` | Field taxonomy, deterministic classifier, fill planner, answer generation |
| Resume | `extension/src/resume/` | Text extraction, sectioning, parsing, normalization, capability evidence |
| Storage | `extension/src/storage/` | Thin typed wrappers over `chrome.storage` |
| Shared schemas | `packages/schemas/` | Single source of truth for types + Zod validation |
| AI client | `packages/ai/` | Provider abstraction, prompt building, response validation, caching, errors |

### Who may touch storage

Only privileged extension contexts: the background service worker and the
popup/options pages. The content script never opens `chrome.storage` itself — when
it needs the profile to build a fill plan it sends `get-profile` / `get-settings` to
the worker and gets exactly that document back. Keeping one hop between stored
candidate data and the page means the release point is auditable. AI calls leave
from here too, carrying a reduced profile slice rather than the whole document.

## Universal DOM intelligence

The core subsystem understands arbitrary application forms without any
website-specific selectors:

```text
Unknown webpage
   ↓  content/domScanner.ts        input, textarea, select, radio, checkbox, file,
                                   contenteditable, ARIA roles, custom controls
   ↓  content/rootCollector.ts     document → shadowRoot (+ nested) → accessible
                                   iframes (+ their shadow roots); cross-origin
                                   frames are reported "iframe inaccessible"
                                   and never crash the scan
   ↓  content/fieldExtractor.ts    labels (label[for], wrapping label, sibling
                                   text, aria-labelledby), descriptions,
                                   placeholder, headings, fieldset/legend,
                                   section, options, required/disabled/visible
   ↓  content/semanticExtractor.ts SemanticField list + page signals + sections
   ↓  intelligence/fieldClassifier deterministic tiers: input type → autocomplete
                                   → label/aria synonyms → heuristics → name →
                                   placeholder → surrounding text → section
   ↓  intelligence/confidence.ts   band: exact ≥0.97, strong ≥0.90,
                                   contextual ≥0.75, weak ≥0.60, else unknown
   ↓  intelligence/pageClassifier  NOT_JOB_PAGE | JOB_LISTING | APPLICATION_FORM |
                                   APPLICATION_STEP | UNKNOWN
```

Everything sent downstream (including to the AI, when configured) is the compact
`SemanticField` — never the whole page.

### Semantic field schema

`packages/schemas/dom.ts` defines `SemanticField`: element type, label,
placeholder, name, type, role, aria metadata, description, surrounding text,
section, options, required/visible/disabled flags and a `fingerprint`.

- **Fingerprint** hashes only structural signals (label, name, placeholder,
  type, section). Volatile surrounding copy is deliberately excluded, so an
  untouched field keeps the same fingerprint — and the same `field-*` id —
  across rescans. Rescans therefore never reprocess unchanged fields; the
  registry reuses resolved elements and prunes removed ones.
- Duplicate fingerprints (identical fields in one scan) get ordered suffixes in
  document order.

### Label resolution order

For every element the extractor tries, in order: `label[for]` inside the
element's own tree → wrapping `<label>` (minus control text) → previous sibling
text → `aria-labelledby` → `aria-label`. Id lookups are scoped to the tree the
element lives in (document, shadow root or iframe document), which is what makes
labels resolve inside shadow DOM and same-origin frames.

### Confidence bands

| Band | Range | Typical source |
| --- | --- | --- |
| exact | ≥ 0.97 | exact `autocomplete`, exact label |
| strong | ≥ 0.90 | strong synonym match |
| contextual | ≥ 0.75 | contextual/phrase match |
| weak | ≥ 0.60 | weak inference |
| unknown | < 0.60 | discarded — never guessed, eligible for AI fallback |

Deterministic tiers run first and are consulted for every field; the AI is only
reached for fields below 0.60 by the fill planner.

### Page classification

`intelligence/pageClassifier.ts` scores compact page signals (title, headings,
control texts, field summaries, truncated visible text) against job evidence:
application/resume/education/… terms, apply CTAs, file uploads, identity fields,
step progress. Contact and sign-in pages are explicitly held out, so a generic
contact form is never labelled a job application.

### Dynamic DOM

`content/mutationObserver.ts` watches child/attribute changes with debouncing;
each change triggers a rescan that adds only new fingerprints. `MutationObserver`
plus stable fingerprints covers React-rendered forms, dialogs and next-step
forms.

### Debug mode

With debug on (popup **Debug** toggle or `set-debug` message) the content script
renders `content/debugPanel.ts`: an in-page overlay listing every detected field
as `#n / Label / Semantic / Confidence` with its band and match reason, plus the
page classification — the primary tool for developing the universal engine.

### Fixtures

`tests/fixtures/` holds synthetic, non-proprietary forms: `simple`,
`random-fields`, `react-like`, `dynamic-form`, `shadow-dom`, `multi-step`,
`ambiguous-form`, `unknown-ats`, `lever-like`, `contact-form`, `job-listing`.

## Message protocol

`extension/src/utils/messaging.ts` wraps `chrome.runtime` / `chrome.tabs` messaging
in a request/response envelope:

```ts
interface MessageEnvelope<T> { type: string; payload?: T; requestId: string }
interface MessageResult<T>   { requestId: string; success: boolean; data?: T; error?: string }
```

Both the worker and the content script call `registerHandlers({ 'message-name': fn })`;
callers use `sendMessage('message-name', payload, 'background' | { tabId })`. Every
response is validated at the boundary, and failures surface as readable errors rather
than `undefined`.

Representative flow of one autofill:

```text
popup                         background                    content
  │  analyze-form             │                              │
  ├───────────────────────────┼──────────────────────────────►│
  │                           │◄──── FormAnalysis ────────────┤
  │  build-fill-plan          │                              │
  ├───────────────────────────┼──────────────────────────────►│  (classifier → planner,
  │                           │◄──── FillPlan ────────────────┤   AI only for uncertain fields)
  │  execute-fill             │                              │
  ├───────────────────────────┼──────────────────────────────►│  fills DOM, returns result
  │  show-review-panel        │                              │
  ├───────────────────────────┼──────────────────────────────►│  overlay for user review
```

## Privacy model

1. **Web pages never see candidate data.** The profile lives in
   `chrome.storage.local` and is only released to extension contexts: the service
   worker, the popup/options pages, and — while building a fill plan — the content
   script's isolated world. Page JavaScript cannot reach any of those. The only thing
   a page can observe is a value written into an input, indistinguishable from the
   user having typed it.
2. **No remote code.** CSP is `script-src 'self'`; there is no `eval`, no
   `new Function`, no dynamically injected script from a URL.
3. **AI is opt-in and minimized.** Requests are made only from the service worker
   using the user-configured provider, and only field metadata crosses that boundary
   for classification (`ai-classify`). Answer generation (`ai-answer`) builds a
   reduced slice of the profile in the worker — name, location, headline, roles,
   education, skills, projects, links — never the raw resume file, phone number or
   date of birth. Responses are validated against a Zod schema before use, and
   failures degrade to deterministic behaviour (skip / mark for review), never to a
   blind fill.
4. **Sensitive fields are skipped by default** (demographics, legal, security
   questions) — see `skipSensitiveFields` in settings.
5. **The original resume is stored untouched** and is only read for file-input
   attachment; parsing produces a separate structured profile.
6. **Nothing is uploaded by default.** Removing the extension (or clearing site data
   for `chrome.storage`) removes everything.

## Storage model

No IndexedDB is needed at this stage: a profile is a single small document read in
one shot, so `chrome.storage` is enough.

| Store | Area | Key | Contents |
| --- | --- | --- | --- |
| `candidateStore.ts` | local | `candidate_profile` | Structured profile + storage `version` for migration/hydration |
| `resumeStore.ts` | local | `resume_file` | Original file bytes (`ArrayBuffer`), filename, format, mime, size, timestamp |
| `settingsStore.ts` | local | `ai_config` | AI provider configuration — kept local because it can contain an API key |
| `settingsStore.ts` | sync | `autofill_settings` | Non-sensitive autofill toggles, mirrored across the user's devices |
| `answerStore.ts` | local | (inside the profile) | Saved/reusable application answers with `global`/`company`/`role` scope |

Sensitive material (profile, resume, credentials) never enters sync storage; a legacy
synced `ai_config` is migrated to local storage on first read.

Conventions:

- Stores expose small async functions (`get*`, `set*`, `clear*`); no store is
  imported by a content script directly.
- `getCandidateProfile()` hydrates missing buckets from
  `EMPTY_CANDIDATE_PROFILE`, so older stored data keeps validating as the schema
  grows.
- Writes are whole-value (read → merge → write) because a profile is a single small
  document; there is no partial-update API to get out of sync.

## Data flow: resume → profile

```text
file (PDF/DOCX/TXT)
  → extractResumeText()   pdfjs-dist / fflate+XML / utf-8
  → splitSections()       preamble, summary, skills, experience, education, projects, certifications
  → parsers               experienceParser, educationParser, otherParsers, skills
  → normalizeSkillList()  alias → canonical name, bucket by category
  → extractCapabilities() evidence + confidence index
  → validateProfile()     Zod; failure aborts the save with readable errors
  → candidateStore        profile
  → resumeStore           original bytes (untouched)
```

See [candidate-profile.md](candidate-profile.md) for the schema and normalization
rules.

## Build and testing

- `scripts/build.mjs` runs two Vite builds: extension pages (`popup`, `options`,
  `background`) and the content script, emitting MV3 artifacts + `manifest.json`
  into `dist/`.
- Vitest runs in a Node environment with the same path aliases as the app
  (`@schemas`, `@ai`, `@shared`, `@`). DOM-dependent suites use `jsdom` plus HTML
  fixtures in `tests/fixtures/` (simple, random-fields, react-like, dynamic,
  shadow-DOM, multi-step, ambiguous, unknown-ATS, contact, job-listing forms)
  so scanner/classifier/filler behaviour is exercised without a browser.
- Resume suites run against a realistic fixture resume
  (`tests/fixtures/resumes/sample-resume.txt`) covering the whole pipeline.

## Extension points

- **New field types** → add to `intelligence/taxonomy.ts` and the classifier rules;
  the registry and planner consume the taxonomy, so no page-specific code is needed.
- **New profile data** → extend `packages/schemas/candidate.ts`, then
  `extension/src/resume/profileSchema.ts` and the hydration defaults in
  `candidateStore`.
- **New AI provider** → implement the `AIProvider` interface in `packages/ai` and
  register it in `createProvider`.
