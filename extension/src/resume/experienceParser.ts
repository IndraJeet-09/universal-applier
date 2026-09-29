import { findDateRange, stripDateRange, type DateRange } from './dates';
import { isBullet, stripBullet } from './sections';

export interface ParsedExperience {
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  responsibilities?: string[];
  technologies?: string[];
}

const TITLE_RE =
  /(engineer|developer|designer|analyst|scientist|manager|consultant|architect|intern|fellow|lead|specialist|administrator|technician|recruiter|founder|officer|coordinator|associate|researcher|programmer|devops|sre|consultant|head of|director|vp|chief|cto|ceo|president|trainer|customer|sales|marketing|product|quality|qa|data)\b/i;

const COMPANY_RE =
  /(inc|llc|ltd|corp|corporation|co\.|technolog|labs?|systems|solutions|studio|group|holdings|gmbh|pvt|limited|\.com|\.io|\.ai|startup|university|college|institute)/i;

const LOCATION_RE =
  /^[A-Za-z .'-]+,\s*([A-Z]{2}|[A-Za-z .'-]{3,})$/;

function looksLikeTitle(text: string): boolean {
  return TITLE_RE.test(text);
}

function looksLikeCompany(text: string): boolean {
  if (COMPANY_RE.test(text)) return true;
  return /^[A-Z0-9&\s]{3,}$/.test(text) && text.split(/\s+/).length <= 5;
}

function looksLikeLocation(text: string): boolean {
  return LOCATION_RE.test(text.trim()) && !looksLikeTitle(text) && !looksLikeCompany(text);
}

interface Entry {
  headerLine: string;
  extraLines: string[];
  bullets: string[];
  range: DateRange;
}

function collectEntries(lines: string[]): Entry[] {
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (findDateRange(line)) starts.push(i);
  });

  if (starts.length === 0) return [];

  const entries: Entry[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const range = findDateRange(lines[from]);
    if (!range) continue;

    const group = lines.slice(from, to);
    const bullets: string[] = [];
    const extraLines: string[] = [];

    group.forEach((line, idx) => {
      if (idx === 0) return;
      if (isBullet(line)) bullets.push(stripBullet(line));
      else extraLines.push(line);
    });

    entries.push({ headerLine: lines[from], extraLines, bullets, range });
  }
  return entries;
}

function splitHeader(header: string): { parts: string[]; location?: string } {
  const stripped = stripDateRange(header);
  if (!stripped) return { parts: [] };

  let parts = stripped
    .split(/\s+[—–•·▪|]\s+|\s+at\s+|\s+@\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 1 && /,/.test(parts[0])) {
    const segments = parts[0].split(',').map((s) => s.trim());
    if (segments.length === 2) parts = segments;
  }

  const locationIdx = parts.findIndex((p) => looksLikeLocation(p));
  const location = locationIdx >= 0 ? parts[locationIdx] : undefined;
  if (locationIdx >= 0) parts.splice(locationIdx, 1);

  return { parts, location };
}

function resolveTitleAndCompany(
  header: string,
  extraLines: string[]
): { title: string; company: string; location?: string } {
  const { parts, location } = splitHeader(header);

  if (parts.length >= 2) {
    const [a, b] = parts;
    if (looksLikeTitle(a) && (looksLikeCompany(b) || !looksLikeTitle(b))) {
      return { title: a, company: b, location };
    }
    if (looksLikeTitle(b) && (looksLikeCompany(a) || !looksLikeTitle(a))) {
      return { title: b, company: a, location };
    }
    return { title: a, company: b, location };
  }

  const first = parts[0] ?? '';
  const nextLine = extraLines.find((l) => !isBullet(l) && !findDateRange(l));
  const second = nextLine ? stripDateRange(nextLine) : '';

  if (second && first) {
    if (looksLikeTitle(first) && !looksLikeTitle(second)) {
      return { title: first, company: second, location };
    }
    if (looksLikeTitle(second) && !looksLikeTitle(first)) {
      return { title: second, company: first, location };
    }
    if (looksLikeCompany(first) && !looksLikeCompany(second)) {
      return { title: second, company: first, location };
    }
    return { title: first, company: second, location };
  }

  if (looksLikeCompany(first)) return { title: '', company: first, location };
  return { title: first, company: '', location };
}

export function parseExperience(lines: string[]): ParsedExperience[] {
  const entries = collectEntries(lines);
  const results: ParsedExperience[] = [];

  for (const entry of entries) {
    const { title, company, location } = resolveTitleAndCompany(entry.headerLine, entry.extraLines);

    const techLine = entry.extraLines.find((l) => /^(tech|technologies|stack|tools)\s*:/i.test(l));
    const technologies = techLine
      ? techLine.replace(/^[^:]+:\s*/, '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
      : undefined;

    if (!title && !company) continue;

    results.push({
      company: company || 'Unknown',
      title: title || company || 'Unknown',
      location,
      startDate: entry.range.start ?? '',
      endDate: entry.range.end,
      current: entry.range.current,
      responsibilities: entry.bullets.length > 0 ? entry.bullets : undefined,
      technologies,
    });
  }

  return results;
}