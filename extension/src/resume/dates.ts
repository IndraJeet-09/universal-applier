const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_PATTERN = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const OPEN_ENDED = '(present|current|now|ongoing|till\\s+date|to\\s+date)';

export interface DateRange {
  start?: string;
  end?: string;
  current: boolean;
  raw: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(month: number | undefined, year: number): string {
  return month ? `${year}-${pad(month)}` : String(year);
}

function parseToken(token: string): { month?: number; year?: number } | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;

  const monthYear = t.match(new RegExp(`^${MONTH_PATTERN}\\s+(\\d{4})$`));
  if (monthYear) {
    return { month: MONTH_MAP[monthYear[1]], year: parseInt(monthYear[2], 10) };
  }
  const yearMonth = t.match(new RegExp(`^(\\d{4})\\s+${MONTH_PATTERN}$`));
  if (yearMonth) {
    return { month: MONTH_MAP[yearMonth[2]], year: parseInt(yearMonth[1], 10) };
  }
  const yearOnly = t.match(/^(\d{4})$/);
  if (yearOnly) {
    return { year: parseInt(yearOnly[1], 10) };
  }
  const slash = t.match(/^(\d{1,2})[\/.](\d{4})$/);
  if (slash) {
    return { month: parseInt(slash[1], 10), year: parseInt(slash[2], 10) };
  }
  return null;
}

const RANGE_PATTERNS: RegExp[] = [
  new RegExp(
    `(${MONTH_PATTERN}\\.?\\s+\\d{4}|\\d{4})\\s*(?:-|–|—|to|through)\\s*(${MONTH_PATTERN}\\.?\\s+\\d{4}|\\d{4}|${OPEN_ENDED})`,
    'i'
  ),
  new RegExp(
    `\\d{1,2}[/.]\\d{4}\\s*(?:-|–|—|to)\\s*(\\d{1,2}[/.]\\d{4}|${OPEN_ENDED})`,
    'i'
  ),
];

export function findDateRange(line: string): DateRange | null {
  for (const pattern of RANGE_PATTERNS) {
    const match = line.match(pattern);
    if (!match) continue;

    const start = parseToken(match[1]);
    if (!start || !start.year) continue;
    const startIso = toIso(start.month, start.year);

    const endToken = match[2];
    const isCurrent = new RegExp(`^${OPEN_ENDED}$`, 'i').test(endToken.trim());

    let endIso: string | undefined;
    if (!isCurrent) {
      const end = parseToken(endToken);
      if (!end || !end.year) continue;
      endIso = toIso(end.month, end.year);
    }

    return {
      start: startIso,
      end: endIso,
      current: isCurrent,
      raw: match[0],
    };
  }
  return null;
}

export function stripDateRange(line: string): string {
  let out = line;
  for (const pattern of RANGE_PATTERNS) {
    out = out.replace(pattern, ' ');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function findYear(text: string): number | undefined {
  const matches = text.match(/\b(19[89]\d|20[0-4]\d)\b/g);
  if (!matches) return undefined;
  const years = matches.map((m) => parseInt(m, 10));
  return Math.max(...years);
}

export function currentYear(): number {
  return new Date().getFullYear();
}

export function computeYearsOfExperience(ranges: Array<{ start?: string; current: boolean; end?: string }>): number | undefined {
  const startYears = ranges
    .map((r) => (r.start ? parseInt(r.start.slice(0, 4), 10) : undefined))
    .filter((y): y is number => typeof y === 'number' && y > 1950);
  if (startYears.length === 0) return undefined;
  const earliest = Math.min(...startYears);
  const lastEndYears = ranges
    .map((r) => (r.current ? currentYear() : r.end ? parseInt(r.end.slice(0, 4), 10) : undefined))
    .filter((y): y is number => typeof y === 'number');
  const latest = lastEndYears.length > 0 ? Math.max(...lastEndYears) : currentYear();
  const years = latest - earliest;
  return years > 0 ? Math.min(years, 60) : undefined;
}