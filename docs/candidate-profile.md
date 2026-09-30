# Candidate Profile

The resume file is **not** the application database. It is an input: uploaded once,
parsed, normalized into a structured `CandidateProfile`, and stored locally. Every
later feature (autofill, resume tailoring, answer generation) reads the profile, not
the PDF.

## Shape

Canonical types live in `packages/schemas/candidate.ts`; the validating Zod schema
lives in `extension/src/resume/profileSchema.ts`.

```ts
interface CandidateProfile {
  personal: { fullName, firstName?, middleName?, lastName?, email, phone?,
              location?, city?, state?, country?, postalCode?, address?, dateOfBirth? };

  professional: { headline?, summary?, yearsOfExperience?, currentRole?, currentCompany?,
                  desiredRoles?, preferredLocations?, remotePreference?, relocation?,
                  noticePeriod?, salaryExpectation? };

  education:    Education[];      // id, institution, degree, fieldOfStudy?, graduationYear?, gpa?, ...
  experience:   Experience[];     // id, company, title, startDate, endDate?, current, technologies?, ...
  projects:     Project[];        // id, name, description?, technologies?, url?, highlights?, ...

  skills: {
    programmingLanguages: string[]; frameworks: string[]; databases: string[];
    cloud: string[]; devops: string[]; tools: string[]; other: string[];
  };

  capabilities: CandidateCapability[];   // evidence index, see below
  certifications: Certification[];
  links: { github?, linkedin?, portfolio?, twitter?, website?, other? };
  preferences: { desiredRoles?, preferredLocations?, remotePreference?, relocation? };
  applicationAnswers: ApplicationAnswer[];  // id, question, answer, scope, timestamps
  workAuthorization: { authorizedToWork?, requiresSponsorship?, visaStatus?, ... };
  metadata: { source: 'resume' | 'manual' | 'imported', parsedAt, version };
}
```

The schema is deliberately extensible: every non-essential field is optional, and
`EMPTY_CANDIDATE_PROFILE` provides the empty buckets.

### Validation rules

`validateProfile()` returns `{ valid: true, profile }` or `{ valid: false, errors }`
with readable `path: message` strings. Notable rules:

- `personal.email` is required **once `fullName` is non-empty** (a completely empty
  profile is still valid — nothing has been entered yet).
- `capabilities` must be present (legacy profiles without it are rejected; use
  `mergeWithDefaults()` to upgrade them).
- `confidence` must be within `[0, 1]`; `applicationAnswers[].scope` must be
  `global | company | role`; all skill buckets, including `devops`, must exist.

## Capability evidence

Storing `Redis` alone does not say *why* the candidate can claim it. Every skill is
backed by an evidence trail:

```ts
interface CandidateCapability {
  name: string;            // canonical, e.g. "Node.js"
  category: string;        // language | framework | database | cloud | devops | tool | other
  evidence: Array<{
    source: 'resume' | 'project' | 'experience' | 'education' | 'user';
    reference?: string;    // e.g. "Talent-IQ" or "Senior Software Engineer @ Acme"
    description?: string;  // e.g. a quoted snippet from a bullet
  }>;
  confidence: number;      // 0..1, capped at 0.99
}
```

```json
{
  "name": "Redis",
  "category": "database",
  "evidence": [
    { "source": "resume",     "description": "Listed in the resume skills section (database)" },
    { "source": "experience", "reference": "Senior Software Engineer @ Acme Technologies",
      "description": "Listed as a technology used in this role" },
    { "source": "project",    "reference": "Talent-IQ",
      "description": "Mentioned in project details: …\"Used Redis in backend application for caching\"" }
  ],
  "confidence": 0.98
}
```

Evidence weights: skills listing `0.7`, structured technology list (role/project)
`0.95`, free-text mention `0.6`, education `0.4`. Confidence is `1 - Π(1 - weight)`
rounded to two decimals and capped at `0.99`, so the strongest achievable state is
"corroborated but never certain". The index is sorted by descending confidence —
that ordering is what a resume-tailoring engine will consume first.

Free-text mentions are matched with longest-match-wins token boundaries, so
`Node.js` wins over `Node`, and every capability always carries at least one piece
of evidence.

## Upload and parse flow

```text
Upload Resume (PDF / DOCX / TXT)
      ↓  options page → extractResumeText()
Parse Resume
      ↓  splitSections() + per-section parsers
Extract Candidate Information
      ↓  canonicalSkill() / normalizeSkillList()
Normalize Information
      ↓  validateProfile()  (abort with readable errors if invalid)
Save Candidate Profile  → candidateStore  (structured)
Save Original Resume    → resumeStore     (bytes, untouched)
```

- **PDF** → `pdfjs-dist` text extraction; **DOCX** → `fflate` zip + `word/document.xml`;
  **TXT/MD** → UTF-8 decode. Legacy `.doc`/`.rtf` are rejected with an actionable
  message rather than parsed wrongly.
- The original bytes are kept as an `ArrayBuffer` so the extension can attach the
  real file to a file input later. Parsing never mutates the file.
- Parsing happens entirely in the extension (options page); no upload to a server.

### What the parser extracts

Header block → name (word/capitalization heuristic), email, phone, location, and the
contact links (GitHub / LinkedIn / portfolio). Sections → summary, skills (bucketed),
experience (title, company, location, date range, `Tech:` line, bullets), education
(institution, degree expansion such as `B.Tech` → `Bachelor of Technology`, field,
graduation year, GPA), projects (name, description, technology list, URL,
highlights), certifications (name, issuer, year).

URL detection is heuristic rather than greedy: `Node.js` and `B.Tech` are *not*
links, email domains are not portfolio links, and a short header line following
bullets starts a new project instead of being appended to the previous one.

## Normalization

Equivalent technologies collapse to one canonical name while the original string is
preserved wherever the resume is rendered verbatim (`ALIASES` in
`extension/src/resume/skills.ts`):

| Seen in resume | Stored as |
| --- | --- |
| `Node`, `NodeJS`, `node_js`, `Node.js` | `Node.js` |
| `Postgres`, `PostgreSQL` | `PostgreSQL` |
| `K8s`, `Kubernetes` | `Kubernetes` |
| `ReactJS`, `React.js` | `React` |
| `AWS`, `Amazon Web Services` | `AWS` |
| `GitHub Actions`, `GitLab CI`, `Terraform` | kept as canonical devops entries |

Skills are then bucketed by category rules (`categorizeSkill`) into
`programmingLanguages`, `frameworks`, `databases`, `cloud`, `devops`, `tools`,
`other`. Unknown skills keep a title-cased form of the original text — the parser
never invents skills that are not in the resume.

## Storage and lifecycle

- `candidateStore.getCandidateProfile()` returns a hydrated profile (missing buckets
  filled from `EMPTY_CANDIDATE_PROFILE`) and writes are versioned so schema changes
  can migrate old data.
- `resumeStore` holds the original file; `settingsStore` holds autofill/AI config;
  saved answers live in `profile.applicationAnswers` with a `scope` of `global`,
  `company` or `role`.
- Everything is local. See the [privacy model](architecture.md#privacy-model).
