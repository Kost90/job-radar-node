import { rm, stat } from 'node:fs/promises';
import { analyzeMetafile, build } from 'esbuild';

const BUDGET_KB = 1024;

await rm('dist', { recursive: true, force: true });

const result = await build({
  entryPoints: ['src/handler.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  minify: true,
  sourcemap: true,
  sourcesContent: false,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // prefer ESM builds (dist-es) over CommonJS (dist-cjs): esbuild can tree-shake them
  mainFields: ['module', 'main'],
  legalComments: 'none',
  metafile: true,
  // some CommonJS dependencies call require(); give them one inside the ESM bundle
  banner: {
    js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
  },
});

if (process.env.ANALYZE) console.log(await analyzeMetafile(result.metafile));

const kb = (await stat('dist/index.mjs')).size / 1024;
console.log(`dist/index.mjs: ${kb.toFixed(1)} KB (budget ${BUDGET_KB} KB)`);
if (kb > BUDGET_KB) {
  console.error('Bundle is over budget. Run ANALYZE=1 npm run build to see what grew.');
  process.exit(1);
}
