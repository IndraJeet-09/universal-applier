/**
 * CAPTCHA detection — informational only. This extension never bypasses,
 * solves or tampers with CAPTCHAs; it tells the user to solve it manually.
 */
const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="captcha"]',
  'iframe[title*="captcha" i]',
  'iframe[title*="challenge" i]',
  '.g-recaptcha',
  '.h-captcha',
  '.cf-turnstile',
  '#cf-turnstile',
  '[data-sitekey]',
  '[data-callback*="captcha" i]',
  '[id*="captcha" i]',
  '[class*="captcha" i]',
];

const CAPTCHA_TEXT =
  /verify you are human|confirm you are (a )?human|complete (the|a) captcha|are you a robot|security check|human verification/i;

export const CAPTCHA_MESSAGE = 'CAPTCHA detected. Please complete it manually.';

export function detectCaptcha(root: ParentNode = document): boolean {
  for (const selector of CAPTCHA_SELECTORS) {
    try {
      if (root.querySelector(selector)) return true;
    } catch {
      /* invalid selector for this root */
    }
  }

  const text = (document.body?.innerText || document.body?.textContent || '').slice(0, 20000);
  return CAPTCHA_TEXT.test(text);
}
