# Universal Job Application Assistant

A Chrome (Manifest V3) extension that understands arbitrary job application forms
instead of hardcoding selectors per website. It parses your resume into a structured
candidate profile, keeps that profile local, and uses it to fill applications you
review before submitting.

> Core principle: **build a universal form-understanding engine, not a collection of
> website scrapers.**

## Status

The foundation (Part 1) is complete:

- Vite + React + TypeScript + Tailwind extension shell (MV3)
- Candidate profile schema with Zod validation
- Resume upload (PDF / DOCX / TXT) → parse → normalize → validate → local storage
- Technology alias normalization (`Node`/`NodeJS` → `Node.js`, `Postgres` → `PostgreSQL`)
- Capability index with per-skill evidence and confidence
- Popup and options UI
- Local-only storage layer and privacy boundaries
- Test suite (Vitest) covering schema, parsing, normalization, capabilities, persistence

The universal DOM intelligence engine (Part 2) is complete:

- DOM scanner over document, nested shadow roots and accessible iframes
  (cross-origin frames are skipped gracefully, never fatal)
- Label resolution: `label[for]`, wrapping labels, sibling text, ARIA — scoped
  per tree
- Compact `SemanticField` schema with structural fingerprints; rescans keep
  stable ids and never reprocess unchanged fields
- Deterministic field taxonomy + synonym dictionaries (no AI for obvious fields)
- Confidence bands (`exact`/`strong`/`contextual`/`weak`/`unknown`) with a hard
  0.60 unknown floor
- Page classifier: `NOT_JOB_PAGE` / `JOB_LISTING` / `APPLICATION_FORM` /
  `APPLICATION_STEP` / `UNKNOWN` — contact and login pages stay excluded
- MutationObserver-driven rescans for dynamic, React-rendered and multi-step forms
- In-page debug panel showing `#n · Label · Semantic · Confidence` per field
- Synthetic fixtures for every major form style (no proprietary markup)

Fill execution builds on that engine (Part 3): semantic scan → fill plan →
execution → in-page review, with AI used only for fields the deterministic tiers
cannot resolve confidently.

## Getting started

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
npm run build       # production build into dist/
```

Load the extension:

1. Run `npm run build`.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `dist/` directory.
4. Open the extension **Options** page → **Resume** tab → upload a resume.
5. Click the toolbar icon to see the popup summary.

`npm run dev` runs a watch build.

## Repository layout

```text
extension/
  public/            manifest.json, icons
  src/
    background/      MV3 service worker: message hub, AI proxy, storage access
    content/         scanner, field extractor, semantic extractor, root collector
                     (shadow DOM + iframes), field registry, mutation observer,
                     debug panel, form filler, review panel
    popup/           toolbar popup (status, candidate summary, autofill actions)
    options/         profile, resume upload, saved answers, settings
    intelligence/    field classifier, page classifier, confidence bands,
                     fill planner, answer generator, taxonomy, candidate matcher
    resume/          extraction, sectioning, parsing, normalization, capabilities
    storage/         candidateStore, resumeStore, settingsStore, answerStore
    utils/           messaging, logging, DOM helpers
packages/
  schemas/           Zod schemas + shared types (candidate, dom, application, ai)
  ai/                provider abstraction, prompts, caching, error taxonomy
tests/               Vitest suites and fixtures (forms, resumes)
docs/                architecture and candidate profile documentation
```

## Privacy

Your resume and profile never leave the browser unless you explicitly configure an AI
provider, and then only the minimum context needed for a single request is sent. Web
pages never get direct access to candidate data — see
[docs/architecture.md](docs/architecture.md#privacy-model).

## Documentation

- [docs/architecture.md](docs/architecture.md) — runtime architecture, data flow, privacy and storage models
- [docs/candidate-profile.md](docs/candidate-profile.md) — profile schema, resume parsing, normalization, evidence
