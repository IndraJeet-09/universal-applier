// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { scanFields } from '../../extension/src/content/semanticExtractor';
import { classifyField } from '../../extension/src/intelligence/fieldClassifier';

function loadFixture(name: string): void {
  const html = readFileSync(path.resolve(__dirname, '../fixtures', name), 'utf-8');
  document.open(); document.write(html); document.close();
  Element.prototype.getBoundingClientRect = (() => ({ x:0,y:0,top:0,left:0,right:100,bottom:20,width:100,height:20,toJSON:()=>({}) })) as never;
}

it('debug', () => {
  for (const fx of ['simple.html', 'lever-like.html', 'react-like.html', 'ambiguous-form.html']) {
    loadFixture(fx);
    console.log('=== ' + fx);
    for (const f of scanFields()) {
      const c = classifyField(f);
      console.log(`  [${f.type}] label=${JSON.stringify(f.label)} name=${JSON.stringify(f.name)} ph=${JSON.stringify(f.placeholder)} -> ${c.semanticField} @${c.confidence} (${c.method}: ${c.reason})`);
    }
  }
});
