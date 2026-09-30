import {
  flattenSkills,
  type CandidateCapability,
  type CandidateProfile,
  type CapabilityEvidence,
} from '@schemas/candidate';
import { canonicalSkill, categorizeSkill, KNOWN_SKILL_NAMES, type SkillCategory } from './skills';

export type CapabilitySourceProfile = Pick<
  CandidateProfile,
  'skills' | 'experience' | 'projects' | 'education'
>;

const CATEGORY_LABEL: Record<SkillCategory, string> = {
  programmingLanguages: 'language',
  frameworks: 'framework',
  databases: 'database',
  cloud: 'cloud',
  devops: 'devops',
  tools: 'tool',
  other: 'other',
};

const WEIGHTS = {
  skillsListing: 0.7,
  structuredTechnology: 0.95,
  textMention: 0.6,
  education: 0.4,
} as const;

const MIN_MENTION_LENGTH = 3;
const SNIPPET_RADIUS = 40;

interface MutableCapability {
  name: string;
  category: string;
  evidence: CapabilityEvidence[];
  weights: number[];
}

interface RecordInput {
  evidence: CapabilityEvidence;
  weight: number;
  category?: string;
}

function evidenceKey(evidence: CapabilityEvidence): string {
  return `${evidence.source}::${evidence.reference ?? ''}`;
}

function record(
  map: Map<string, MutableCapability>,
  rawName: string,
  input: RecordInput
): string | null {
  const name = canonicalSkill(rawName) ?? rawName.trim();
  if (name.length === 0) return null;

  let entry = map.get(name);
  if (!entry) {
    entry = {
      name,
      category: input.category ?? CATEGORY_LABEL[categorizeSkill(name)],
      evidence: [],
      weights: [],
    };
    map.set(name, entry);
  }

  if (entry.evidence.some((e) => evidenceKey(e) === evidenceKey(input.evidence))) return name;
  entry.evidence.push(input.evidence);
  entry.weights.push(input.weight);
  return name;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileMentions(names: string[]): Array<{ name: string; re: RegExp }> {
  const unique = [...new Set(names)]
    .filter((n) => n.trim().length >= MIN_MENTION_LENGTH)
    .sort((a, b) => b.length - a.length);
  return unique.map((name) => ({
    name,
    re: new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`, 'gi'),
  }));
}

function snippet(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SNIPPET_RADIUS);
  const to = Math.min(text.length, end + SNIPPET_RADIUS);
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
}

/**
 * Finds mentions of known skill names in free text. Overlapping matches are
 * resolved in favour of the longest match so that "Node.js" wins over "Node".
 */
function scanMentions(text: string, patterns: Array<{ name: string; re: RegExp }>): Array<{
  name: string;
  start: number;
  end: number;
}> {
  const found: Array<{ name: string; start: number; end: number; length: number }> = [];
  for (const { name, re } of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      found.push({ name, start: match.index, end: match.index + match[0].length, length: match[0].length });
      if (re.lastIndex === match.index) re.lastIndex++;
    }
  }

  found.sort((a, b) => a.start - b.start || b.length - a.length);
  const kept: Array<{ name: string; start: number; end: number }> = [];
  let lastEnd = -1;
  for (const m of found) {
    if (m.start < lastEnd) continue;
    kept.push({ name: m.name, start: m.start, end: m.end });
    lastEnd = m.end;
  }
  return kept;
}

function addTextEvidence(
  map: Map<string, MutableCapability>,
  text: string,
  source: CapabilityEvidence['source'],
  reference: string,
  descriptionPrefix: string,
  patterns: Array<{ name: string; re: RegExp }>
): void {
  if (!text.trim()) return;
  for (const hit of scanMentions(text, patterns)) {
    record(map, hit.name, {
      evidence: {
        source,
        reference,
        description: `${descriptionPrefix}"${snippet(text, hit.start, hit.end)}"`,
      },
      weight: WEIGHTS.textMention,
    });
  }
}

function roleReference(title: string, company?: string): string {
  return company ? `${title} @ ${company}` : title;
}

function combineWeights(weights: number[]): number {
  const residual = weights.reduce((acc, w) => acc * (1 - Math.min(Math.max(w, 0), 1)), 1);
  return Math.min(0.99, Math.round((1 - residual) * 100) / 100);
}

/**
 * Builds the capability index for a parsed candidate profile. Every capability
 * carries the evidence that justifies it (which resume section, role, project
 * or education entry) plus a confidence derived from the strength and
 * plurality of that evidence.
 */
export function extractCapabilities(profile: CapabilitySourceProfile): CandidateCapability[] {
  const map = new Map<string, MutableCapability>();

  const skillBuckets: Array<[SkillCategory, string[]]> = [
    ['programmingLanguages', profile.skills?.programmingLanguages ?? []],
    ['frameworks', profile.skills?.frameworks ?? []],
    ['databases', profile.skills?.databases ?? []],
    ['cloud', profile.skills?.cloud ?? []],
    ['devops', profile.skills?.devops ?? []],
    ['tools', profile.skills?.tools ?? []],
    ['other', profile.skills?.other ?? []],
  ];

  for (const [category, names] of skillBuckets) {
    for (const raw of names) {
      record(map, raw, {
        evidence: {
          source: 'resume',
          description: `Listed in the resume skills section (${CATEGORY_LABEL[category]})`,
        },
        weight: WEIGHTS.skillsListing,
        category: CATEGORY_LABEL[category],
      });
    }
  }

  const patterns = compileMentions([...flattenSkills(profile.skills), ...KNOWN_SKILL_NAMES]);

  for (const role of profile.experience ?? []) {
    const reference = roleReference(role.title, role.company);
    for (const tech of role.technologies ?? []) {
      record(map, tech, {
        evidence: {
          source: 'experience',
          reference,
          description: 'Listed as a technology used in this role',
        },
        weight: WEIGHTS.structuredTechnology,
      });
    }
    const text = [role.description, ...(role.responsibilities ?? []), ...(role.achievements ?? [])]
      .filter((part): part is string => Boolean(part))
      .join('\n');
    addTextEvidence(map, text, 'experience', reference, 'Mentioned in role details: ', patterns);
  }

  for (const project of profile.projects ?? []) {
    for (const tech of project.technologies ?? []) {
      record(map, tech, {
        evidence: {
          source: 'project',
          reference: project.name,
          description: 'Listed in the project technology stack',
        },
        weight: WEIGHTS.structuredTechnology,
      });
    }
    const text = [project.description, ...(project.highlights ?? [])]
      .filter((part): part is string => Boolean(part))
      .join('\n');
    addTextEvidence(map, text, 'project', project.name, 'Mentioned in project details: ', patterns);
  }

  for (const entry of profile.education ?? []) {
    const reference = entry.institution ? `${entry.degree}, ${entry.institution}` : entry.degree;
    const text = [entry.degree, entry.fieldOfStudy, entry.institution, ...(entry.honors ?? [])]
      .filter((part): part is string => Boolean(part))
      .join(' ');
    addTextEvidence(map, text, 'education', reference, 'Mentioned in education entry: ', patterns);
  }

  const capabilities = [...map.values()].map((entry) => ({
    name: entry.name,
    category: entry.category,
    evidence: entry.evidence,
    confidence: combineWeights(entry.weights),
  }));

  capabilities.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  return capabilities;
}
