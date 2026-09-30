import type { Project, Certification } from '@schemas/candidate';
import { findYear } from './dates';
import { isBullet, stripBullet } from './sections';
import { canonicalSkill, splitSkillLine } from './skills';
import { findUrl, toAbsoluteUrl } from './urls';

export function extractSummary(lines: string[]): string | undefined {
  const text = lines.join(' ').trim();
  if (text.length === 0) return undefined;
  return text.length > 800 ? `${text.slice(0, 797).trimEnd()}…` : text;
}

const TECH_LINE_RE = /(?:built with|technologies|tech stack|stack)\s*:?\s*(.+?)(?:\.\s|$)/i;

/** Prose words that mean the captured segment is a sentence, not a tech list. */
const PROSE_WORD_RE =
  /\b(for|with|using|the|an?|of|in|on|to|by|our|my|your|that|this|from|as|at|it|is|are|was|were|who|which|when|where|we|i|he|she|they)\b/i;

function looksLikeProjectHeader(line: string, previousWasBullet: boolean): boolean {
  if (!previousWasBullet) return false;
  if (line.length > 60) return false;
  if (/[.!?]$/.test(line)) return false;
  return /^[A-Z0-9]/.test(line);
}

function looksLikeTechList(segment: string): boolean {
  return !PROSE_WORD_RE.test(segment.replace(/\band\b/gi, ' '));
}

function technologiesFrom(description: string): { technologies?: string[]; description: string } {
  const techMatch = description.match(TECH_LINE_RE);
  if (!techMatch) return { description };

  const segment = techMatch[1].trim();
  if (!looksLikeTechList(segment)) return { description };

  const technologies = splitSkillLine(segment)
    .map((raw) => canonicalSkill(raw))
    .filter((name): name is string => Boolean(name));

  if (technologies.length === 0) return { description };
  return {
    technologies,
    description: description.replace(techMatch[0], '').trim(),
  };
}

export function parseProjects(lines: string[]): Omit<Project, 'id'>[] {
  const results: Omit<Project, 'id'>[] = [];
  let current: Omit<Project, 'id'> | null = null;
  let previousWasBullet = false;

  for (const line of lines) {
    if (isBullet(line)) {
      previousWasBullet = true;
      if (!current) continue;
      const bullet = stripBullet(line);
      const url = findUrl(bullet);
      if (url && !current.url) {
        current.url = toAbsoluteUrl(url);
        const desc = bullet.replace(url, '').trim();
        if (desc) {
          current.description = current.description ? `${current.description} ${desc}` : desc;
        }
      } else {
        current.highlights = [...(current.highlights ?? []), bullet];
      }
      continue;
    }

    const isHeaderCandidate = looksLikeProjectHeader(line, previousWasBullet);
    previousWasBullet = false;

    if (line.length < 3 || line.length > 120) continue;

    const startsNewProject = !current || (isHeaderCandidate && (current.highlights?.length ?? 0) > 0);
    if (startsNewProject) {
      const url = findUrl(line);
      const name =
        (url ? line.replace(url, '') : line).replace(/[:•\s]+$/, '').trim() || line.trim();
      const entry: Omit<Project, 'id'> = { name, highlights: undefined };
      if (url) entry.url = toAbsoluteUrl(url);
      results.push(entry);
      current = entry;
      continue;
    }

    if (!current) continue;

    const url = findUrl(line);
    if (url && !current.url) {
      current.url = toAbsoluteUrl(url);
    } else if (!current.description) {
      current.description = line;
    } else if (line.length > 40) {
      current.description = `${current.description} ${line}`;
    }
  }

  return results.map((p) => (p.description ? { ...p, ...technologiesFrom(p.description) } : p));
}

export function parseCertifications(lines: string[]): Omit<Certification, 'id'>[] {
  const results: Omit<Certification, 'id'>[] = [];

  for (const line of lines) {
    const text = isBullet(line) ? stripBullet(line) : line;
    if (text.length < 3 || text.length > 140) continue;

    const parts = text.split(/\s+[—–|]\s+|\s+by\s+|\s+from\s+/i).map((p) => p.trim());
    const year = findYear(text);

    results.push({
      name: parts[0],
      issuer: parts.length > 1 ? parts[1] : undefined,
      issueDate: year ? String(year) : undefined,
    });
  }

  return results;
}

const CATEGORY_PREFIX =
  /^(languages?|programming languages?|frameworks?|libraries|databases?|db|cloud|devops|tools?|platforms?|other|soft skills?|methodologies)\s*:\s*/i;

export function parseSkillsSection(lines: string[]): string[] {
  const skills: string[] = [];

  for (const rawLine of lines) {
    const line = (isBullet(rawLine) ? stripBullet(rawLine) : rawLine).trim();
    if (line.length === 0) continue;

    const withoutPrefix = line.replace(CATEGORY_PREFIX, '');
    const parts = splitSkillLine(withoutPrefix);

    if (parts.length > 0) {
      skills.push(...parts);
    } else if (line.length <= 60) {
      skills.push(line);
    }
  }

  return skills;
}
