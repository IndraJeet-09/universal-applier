export interface ResumeSections {
  preamble: string[];
  summary: string[];
  experience: string[];
  education: string[];
  skills: string[];
  projects: string[];
  certifications: string[];
}

type HeaderMatcher = (line: string) => keyof ResumeSections | null;

export function splitSections(lines: string[], matchHeader: HeaderMatcher): ResumeSections {
  const sections: ResumeSections = {
    preamble: [],
    summary: [],
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
  };

  let current: keyof ResumeSections = 'preamble';
  for (const line of lines) {
    const header = matchHeader(line);
    if (header && header in sections) {
      current = header;
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

const BULLET_RE = /^\s*[•▪▸►●○◦*-–—‣]\s+/;

export function isBullet(line: string): boolean {
  return BULLET_RE.test(line);
}

export function stripBullet(line: string): string {
  return line.replace(BULLET_RE, '').trim();
}