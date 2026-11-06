// clojurific.dev: the home page and the playground (play/), bundled by Vite
// with the compiler in .. (the plugin and the Clojure CLI's classpath of
// deps.edn), see README.md.
import { defineConfig } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cljf from '../src/main/js/vite-plugin-cljs/index.js';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = 'target/cljs';

// The playground's compiler (cljf.selfhost) reads the analysis of the
// namespaces it compiles against: the build's analysis caches, copied next to
// the page as play/analysis/<ns path>.cache.json.
function analysisCaches() {
  let outDir;
  return {
    name: 'clojurific-analysis-caches',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const from = path.join(WEB, OUTPUT_DIR);
      const to = path.join(outDir, 'play', 'analysis');
      for (const file of await fs.readdir(from, { recursive: true })) {
        if (!file.endsWith('.cache.json')) continue;
        await fs.mkdir(path.dirname(path.join(to, file)), { recursive: true });
        await fs.copyFile(path.join(from, file), path.join(to, file));
      }
    },
  };
}

export default defineConfig({
  plugins: [
    cljf({
      command: ['clojure', '-M'],
      outputDir: OUTPUT_DIR,
      compilerOptions: {
        // the compiler in the page, and the namespaces registered for it
        selfHost: true,
        esmRepl: true,
      },
      // forms compiled in the page use ClojureScript's property names, and
      // may call any protocol method: neither renamed nor pruned
      prune: false,
      manifest: false,
    }),
    analysisCaches(),
  ],
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        index: path.join(WEB, 'index.html'),
        play: path.join(WEB, 'play/index.html'),
      },
    },
  },
});
