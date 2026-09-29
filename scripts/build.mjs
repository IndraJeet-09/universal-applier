import { build } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const modeIdx = process.argv.indexOf('--mode');
const mode = modeIdx !== -1 ? process.argv[modeIdx + 1] : 'production';

async function buildTarget(target) {
  process.env.BUILD_TARGET = target;
  await build({ mode, logLevel: 'info' });
}

function copyPdfWorker() {
  const src = path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
  const dest = path.resolve('dist/pdf.worker.min.mjs');
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

if (watch) {
  await Promise.all([buildTarget('app'), buildTarget('content')]);
  copyPdfWorker();
  console.log('watching app + content bundles…');
} else {
  await buildTarget('app');
  await buildTarget('content');
  copyPdfWorker();
  console.log('build complete');
}