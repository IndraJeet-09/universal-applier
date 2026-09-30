import type { CandidateProfile, Links, PersonalInfo } from '@schemas/candidate';
import { EMPTY_CANDIDATE_PROFILE } from '@schemas/candidate';
import { computeYearsOfExperience } from './dates';
import { splitSections, type ResumeSections } from './sections';
import { normalizeSkillList } from './skills';
import { extractCapabilities } from './capabilities';
import { parseExperience } from './experienceParser';
import { parseEducation } from './educationParser';
import { parseProjects, parseCertifications, parseSkillsSection, extractSummary } from './otherParsers';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/;
const GITHUB_RE = /github\.com\/[a-zA-Z0-9._-]+/i;
const LINKEDIN_RE = /linkedin\.com\/in\/[a-zA-Z0-9._-]+/i;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s,;)*)]*)?)/g;

const SECTION_HEADERS = {
  summary: /^(summary|profile|professional summary|about (me|the candidate)|objective|career objective)$/,
  experience:
    /^((professional|relevant|work|industry)?\s*experience|employment(\s+(history|record|background))?|work history|career history|work experience)$/,
  education:
    /^(education|academic (background|qualifications)|educational (background|qualification)|qualifications|academics|education & training)$/,
  skills: /^(skills|technical skills|core competencies|technologies|tech stack|areas? of expertise|key skills|skills & tools)$/,
  projects: /^(projects|selected projects|personal projects|key projects|academic projects|portfolio)$/,
  certifications:
    /^(certifications?|licenses? (&|and) certificates?|awards (&|and) honors?|achievements|licenses)$/,
} as const;

export type SectionKey = keyof typeof SECTION_HEADERS;

export function matchSectionHeader(line: string): SectionKey | null {
  const normalized = line.toLowerCase().replace(/[:•\s]+$/, '').trim();
  if (normalized.length === 0 || normalized.length > 60) return null;
  for (const [key, pattern] of Object.entries(SECTION_HEADERS)) {
    if (pattern.test(normalized)) return key as SectionKey;
  }
  return null;
}

function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && !/example\.(com|org|net)$/i.test(email) && !email.includes('..');
}

function extractEmail(text: string): string | undefined {
  const matches = text.match(new RegExp(EMAIL_RE.source, 'gi')) ?? [];
  const valid = matches.find((m) => isValidEmail(m));
  return valid;
}

function extractPhone(text: string): string | undefined {
  const candidates = text.match(
    /(\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g
  );
  if (!candidates) return undefined;
  const digits = (s: string) => s.replace(/\D/g, '');
  const best = candidates
    .map((c) => c.trim())
    .filter((c) => {
      const d = digits(c);
      return d.length >= 7 && d.length <= 15 && !/^(19|20)\d{2}$/.test(d);
    })
    .sort((a, b) => digits(b).length - digits(a).length)[0];
  return best;
}

function extractLinks(text: string): Links {
  const links: Links = {};
  const github = text.match(GITHUB_RE);
  if (github) links.github = `https://${github[0]}`;
  const linkedin = text.match(LINKEDIN_RE);
  if (linkedin) links.linkedin = `https://${linkedin[0]}`;

  const urls = [...text.matchAll(URL_RE)]
    .map((m) => m[0])
    .filter((u) => !GITHUB_RE.test(u) && !LINKEDIN_RE.test(u) && !u.includes('@'));

  for (const url of urls) {
    const full = url.startsWith('http') ? url : `https://${url}`;
    const domain = full.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    if (!links.portfolio && !domain.includes('github') && !domain.includes('linkedin')) {
      links.portfolio = full;
    } else if (domain.includes('twitter') || domain.includes('x.com')) {
      links.twitter = full;
    }
  }
  return links;
}

function looksLikeName(line: string): boolean {
  if (line.length < 3 || line.length > 60) return false;
  if (EMAIL_RE.test(line) || URL_RE.test(line) || PHONE_RE.test(line)) return false;
  const words = line.split(/\s+/).filter((w) => /^[A-Za-z.'-]+$/.test(w));
  if (words.length < 2 || words.length > 5) return false;
  const capitalized = words.filter((w) => /^[A-Z]/.test(w) || /^\./.test(w));
  return capitalized.length >= Math.max(2, words.length - 1);
}

function looksLikeLocation(line: string): boolean {
  if (line.length < 4 || line.length > 60) return false;
  if (EMAIL_RE.test(line) || /\d{4,}/.test(line)) return false;
  const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((p) => /^[A-Za-z .'()-]+$/.test(p) && p.length <= 30);
}

function extractPersonal(lines: string[]): PersonalInfo {
  const text = lines.join('\n');
  const personal: PersonalInfo = { fullName: '', email: extractEmail(text) ?? '' };

  const phone = extractPhone(text);
  if (phone) personal.phone = phone;

  const nameLine = lines.slice(0, 12).find((l) => looksLikeName(l));
  if (nameLine) personal.fullName = nameLine.trim();

  const locationLine = lines
    .slice(0, 20)
    .find((l) => looksLikeLocation(l) && l.trim() !== personal.fullName);
  if (locationLine) {
    const parts = locationLine.split(',').map((p) => p.trim());
    personal.location = parts.join(', ');
    personal.city = parts[0];
    if (parts.length >= 2) {
      if (parts.length === 2 && parts[1].length <= 3) personal.state = parts[1];
      else personal.country = parts[parts.length - 1];
      if (parts.length === 3) personal.state = parts[1];
    }
  }

  if (personal.fullName) {
    const nameParts = personal.fullName.split(/\s+/);
    personal.firstName = nameParts[0];
    if (nameParts.length > 2) {
      personal.middleName = nameParts.slice(1, -1).join(' ');
      personal.lastName = nameParts[nameParts.length - 1];
    } else if (nameParts.length === 2) {
      personal.lastName = nameParts[1];
    }
  }

  return personal;
}

function newId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

export function normalizeResume(rawText: string): CandidateProfile {
  const cleaned = rawText
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const sections: ResumeSections = splitSections(lines, matchSectionHeader);
  const personal = extractPersonal(lines);
  const links = extractLinks(cleaned);

  const experience = parseExperience(sections.experience).map((e, i) => ({ ...e, id: newId('exp', i) }));
  const education = parseEducation(sections.education).map((e, i) => ({ ...e, id: newId('edu', i) }));
  const projects = parseProjects(sections.projects).map((p, i) => ({ ...p, id: newId('proj', i) }));
  const certifications = parseCertifications(sections.certifications).map((c, i) => ({
    ...c,
    id: newId('cert', i),
  }));
  const skills = normalizeSkillList(parseSkillsSection(sections.skills));
  const summary = extractSummary(sections.summary);

  const yearsOfExperience = computeYearsOfExperience(
    experience.map((e) => ({ start: e.startDate, end: e.endDate, current: e.current }))
  );

  const current = experience.find((e) => e.current) ?? experience[0];

  return {
    ...EMPTY_CANDIDATE_PROFILE,
    personal,
    professional: {
      headline: current ? `${current.title}${current.company ? ` at ${current.company}` : ''}` : undefined,
      summary,
      yearsOfExperience,
      currentRole: current?.title,
      currentCompany: current?.company,
    },
    education,
    experience,
    projects,
    skills,
    capabilities: extractCapabilities({ skills, experience, projects, education }),
    certifications,
    links,
    metadata: {
      source: 'resume',
      parsedAt: new Date().toISOString(),
      version: 1,
    },
  };
}