import { build } from 'vite';

const watch = process.argv.includes('--watch');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'production';

async function buildTarget(target) {
  process.env.BUILD_TARGET = target;
  await build({ mode, logLevel: 'info' });
}

if (watch) {
  await Promise.all([buildTarget('app'), buildTarget('content')]);
  console.log('watching app + content bundles…');
} else {
  await buildTarget('app');
  await buildTarget('content');
  console.log('build complete');
}