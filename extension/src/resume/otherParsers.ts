import type { Project, Certification } from '@schemas/candidate';
import { findYear } from './dates';
import { isBullet, stripBullet } from './sections';
import { splitSkillLine } from './skills';

export function extractSummary(lines: string[]): string | undefined {
  const text = lines.join(' ').trim();
  if (text.length === 0) return undefined;
  return text.length > 800 ? `${text.slice(0, 797).trimEnd()}…` : text;
}

const URL_IN_LINE = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s)]*)?/;

export function parseProjects(lines: string[]): Omit<Project, 'id'>[] {
  const results: Omit<Project, 'id'>[] = [];
  let current: Omit<Project, 'id'> | null = null;

  for (const line of lines) {
    if (isBullet(line)) {
      if (!current) continue;
      const bullet = stripBullet(line);
      const url = bullet.match(URL_IN_LINE);
      if (url && !current.url) {
        current.url = url[0].startsWith('http') ? url[0] : `https://${url[0]}`;
        const desc = bullet.replace(URL_IN_LINE, '').trim();
        if (desc) current.description = current.description ? `${current.description} ${desc}` : desc;
      } else {
        current.highlights = [...(current.highlights ?? []), bullet];
      }
      continue;
    }

    if (line.length < 3 || line.length > 120) continue;

    if (current) {
      const url = line.match(URL_IN_LINE);
      if (url && !current.url) {
        current.url = url[0].startsWith('http') ? url[0] : `https://${url[0]}`;
      } else if (!current.description) {
        current.description = line;
      } else if (line.length > 40) {
        current.description = `${current.description} ${line}`;
      }
      continue;
    }

    const name = line.replace(URL_IN_LINE, '').replace(/[:•\s]+$/, '').trim();
    if (!name) continue;
    current = { name, highlights: undefined };
    const url = line.match(URL_IN_LINE);
    if (url) current.url = url[0].startsWith('http') ? url[0] : `https://${url[0]}`;
    results.push(current);
  }

  return results.map((p) => {
    const techMatch = p.description?.match(/(?:built with|technologies|stack)\s*:\s*([^.]+)/i);
    if (techMatch) {
      return {
        ...p,
        technologies: splitSkillLine(techMatch[1]),
        description: p.description?.replace(techMatch[0], '').trim(),
      };
    }
    return p;
  });
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