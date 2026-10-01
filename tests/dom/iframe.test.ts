// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { scanFields } from '../../extension/src/content/semanticExtractor';
import { collectRoots, getLastIframeReport } from '../../extension/src/content/rootCollector';
import { collectIframes } from '../../extension/src/content/iframeScanner';

function stubRect(win: Window & typeof globalThis): void {
  win.Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20,
      width: 100, height: 20, toJSON: () => ({}),
    } as DOMRect;
  };
}

beforeEach(() => {
  stubRect(window);
  document.title = '';
  document.body.innerHTML = '';
});

function makeFrame(src?: string): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  if (src) frame.setAttribute('src', src);
  document.body.appendChild(frame);
  return frame;
}

function writeInto(doc: Document, html: string): Document {
  doc.open();
  doc.write(html);
  doc.close();
  const win = doc.defaultView;
  if (win) stubRect(win);
  return doc;
}

function frameBody(frame: HTMLIFrameElement, html: string): Document {
  const doc = frame.contentDocument;
  if (!doc) throw new Error('frame document unavailable');
  return writeInto(doc, html);
}

describe('iframe scanning', () => {
  it('scans fields inside an accessible iframe with in-tree label resolution', () => {
    document.body.innerHTML = '<h1>Apply</h1><p>Email us later</p>';
    const frame = makeFrame();
    frameBody(
      frame,
      `<form>
         <label for="if-email">Email Address</label>
         <input type="email" id="if-email" name="email" autocomplete="email" />
         <label for="if-city">City</label>
         <input type="text" id="if-city" name="city" />
       </form>`
    );

    const roots = collectRoots();
    expect(roots.length).toBeGreaterThanOrEqual(2);

    const fields = scanFields();
    const email = fields.find((f) => f.name === 'email');
    expect(email).toBeDefined();
    expect(email?.label).toBe('Email Address');
    expect(email?.autocomplete).toBe('email');

    const city = fields.find((f) => f.name === 'city');
    expect(city?.label).toBe('City');
  });

  it('records cross-origin style inaccessible iframes without crashing', () => {
    document.body.innerHTML =
      '<label for="top-email">Email</label><input id="top-email" name="email" />';

    const blocked = makeFrame('https://cross-origin.example/embed');
    Object.defineProperty(blocked, 'contentDocument', {
      configurable: true,
      get() {
        throw new DOMException('Blocked a frame with origin', 'SecurityError');
      },
    });

    const nullFrame = makeFrame('https://another-origin.example/form');
    Object.defineProperty(nullFrame, 'contentDocument', {
      configurable: true,
      get() {
        return null;
      },
    });

    const report = collectIframes(document);
    expect(report.total).toBe(2);
    expect(report.inaccessible).toHaveLength(2);
    expect(report.inaccessible[0].reason).toBe('iframe inaccessible');

    const fields = scanFields();
    expect(fields.some((f) => f.name === 'email')).toBe(true);
    expect(getLastIframeReport()?.inaccessible).toHaveLength(2);
  });

  it('recurses into nested same-origin iframes', () => {
    document.body.innerHTML = '';
    const outer = makeFrame();
    const outerDoc = frameBody(outer, '<div><p>outer frame</p></div>');

    const inner = outerDoc.createElement('iframe');
    outerDoc.body.appendChild(inner);
    const innerDoc = frameBody(
      inner,
      `<label for="in-phone">Phone Number</label><input type="tel" id="in-phone" name="phone" />`
    );

    const roots = collectRoots();
    expect(roots).toContain(outerDoc);
    expect(roots).toContain(innerDoc);

    const fields = scanFields();
    const phone = fields.find((f) => f.name === 'phone');
    expect(phone?.label).toBe('Phone Number');
  });

  it('does not scan fields of inaccessible iframes but keeps scanning the page', () => {
    document.body.innerHTML =
      '<label for="keep">GitHub Profile</label><input id="keep" name="github_url" />';
    const blocked = makeFrame('https://locked.example/apply');
    Object.defineProperty(blocked, 'contentDocument', {
      configurable: true,
      get() {
        return null;
      },
    });

    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('github_url');
  });
});
