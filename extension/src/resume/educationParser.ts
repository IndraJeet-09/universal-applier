import { findYear } from './dates';
import { isBullet, stripBullet } from './sections';

export interface ParsedEducation {
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  graduationYear?: number;
  gpa?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
}

const INSTITUTION_RE =
  /(university|college|institute|school|academy|polytechnic|iit\b|nit\b|iim\b|iiit|community college|universit[é]|escuela|technikum)/i;

const DEGREE_RE =
  /\b(ph\.?d|doctorate|master(?:'s)?|bachelor(?:'s)?|mba|m\.?b\.?a|m\.?tech|b\.?tech|m\.?e\.?|b\.?e\.?|m\.?s(?:c)?\.?|b\.?s(?:c)?\.?|mca|bca|m\.?a\.?|b\.?a\.?|associate(?:'s)?|diploma|certificate)\b/i;

const FIELD_RE =
  /\b(?:in|of)\s+([A-Za-z][A-Za-z&\s]{2,40})/;

const YEAR_RANGE_RE = /\b(19[89]\d|20[0-4]\d)\s*(?:-|–|—|to)?\s*(19[89]\d|20[0-4]\d)?\b/;

function parseDegreeLine(line: string): { degree: string; field?: string } | null {
  const match = line.match(DEGREE_RE);
  if (!match) return null;

  const degreeStart = match.index ?? 0;
  let degree = match[0].trim();

  const full = line.slice(degreeStart);
  const expansion: Record<string, string> = {
    'b.tech': 'Bachelor of Technology',
    'btech': 'Bachelor of Technology',
    'm.tech': 'Master of Technology',
    'mtech': 'Master of Technology',
    'b.e.': 'Bachelor of Engineering',
    'm.e.': 'Master of Engineering',
    'b.s.c': 'Bachelor of Science',
    'm.s.c': 'Master of Science',
    'bsc': 'Bachelor of Science',
    'msc': 'Master of Science',
    'bca': 'Bachelor of Computer Applications',
    'mca': 'Master of Computer Applications',
    'm.b.a': 'Master of Business Administration',
    'mba': 'Master of Business Administration',
    'ph.d': 'Doctor of Philosophy',
    phd: 'Doctor of Philosophy',
  };
  const key = degree.toLowerCase().replace(/\s+/g, '');
  degree = expansion[key] ?? degree;

  let field: string | undefined;
  const fieldMatch = full.match(FIELD_RE);
  if (fieldMatch && fieldMatch[1] && !DEGREE_RE.test(fieldMatch[1])) {
    field = fieldMatch[1].trim().replace(/[.,;]+$/, '');
  }

  const commaParts = line.split(',');
  if (!field && commaParts.length > 1) {
    const candidate = commaParts.find(
      (p) => !DEGREE_RE.test(p) && !INSTITUTION_RE.test(p) && p.trim().length > 2 && !/\d{4}/.test(p)
    );
    if (candidate) field = candidate.trim();
  }

  return { degree, field };
}

function extractGpa(text: string): string | undefined {
  const m = text.match(/gpa[:\s]*([0-9]\.\d{1,2}(?:\s*\/\s*[0-9]\.?\d*)?)/i);
  return m?.[1]?.trim();
}

function extractInstitution(lines: string[]): { institution: string; location?: string } {
  const idx = lines.findIndex((l) => INSTITUTION_RE.test(l));
  if (idx < 0) {
    const first = lines[0] ?? '';
    return { institution: first.split(/[,—–|]/)[0].trim() };
  }

  const line = lines[idx];
  let institution = line;
  let location: string | undefined;

  const parts = line.split(/\s+[—–|]\s+|,\s+/).map((p) => p.trim());
  if (parts.length > 1) {
    institution = parts.find((p) => INSTITUTION_RE.test(p)) ?? parts[0];
    location = parts.find((p) => p !== institution && /^[A-Za-z .'-]+$/.test(p) && p.length <= 40);
  }

  return { institution, location };
}

export function parseEducation(lines: string[]): ParsedEducation[] {
  if (lines.length === 0) return [];

  const entryStarts: number[] = [];
  lines.forEach((line, i) => {
    if (isBullet(line)) return;
    if (INSTITUTION_RE.test(line) || DEGREE_RE.test(line)) {
      if (i === 0 || entryStarts.length === 0 || i > entryStarts[entryStarts.length - 1]) {
        entryStarts.push(i);
      }
    }
  });

  if (entryStarts.length === 0) {
    const degreeLine = lines.find((l) => DEGREE_RE.test(l));
    if (!degreeLine) return [];
    const { institution, location } = extractInstitution(lines);
    const parsed = parseDegreeLine(degreeLine);
    return [
      {
        institution,
        degree: parsed?.degree ?? '',
        fieldOfStudy: parsed?.field,
        graduationYear: findYear(lines.join(' ')),
        gpa: extractGpa(lines.join(' ')),
        location,
      },
    ];
  }

  const results: ParsedEducation[] = [];
  for (let i = 0; i < entryStarts.length; i++) {
    const from = entryStarts[i];
    const to = i + 1 < entryStarts.length ? entryStarts[i + 1] : lines.length;
    const group = lines.slice(from, to);
    const text = group.join(' ');

    const { institution, location } = extractInstitution(group);
    const degreeLine = group.find((l) => DEGREE_RE.test(l)) ?? '';
    const parsed = degreeLine ? parseDegreeLine(degreeLine) : null;

    const years = text.match(YEAR_RANGE_RE);
    let graduationYear = findYear(text);
    if (years?.[2]) {
      const second = parseInt(years[2], 10);
      if (second > 1950 && second <= new Date().getFullYear() + 1) graduationYear = second;
    }

    const gpa = extractGpa(text);

    results.push({
      institution,
      degree: parsed?.degree ?? '',
      fieldOfStudy: parsed?.field,
      graduationYear,
      gpa,
      location,
    });
  }

  return results;
}

export function stripEducationBullets(line: string): string {
  return stripBullet(line);
}