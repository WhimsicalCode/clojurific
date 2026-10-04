// Karma adapter for a cljs.esm test bundle (an ES module) run by
// cljs.esm.karma/start. Add it to Karma's files, serve the bundle's directory
// (included: false), and name its entry module in client.args:
//
//   files: ['<this file>', {pattern: 'build/ci-test/**/*', included: false}],
//   client: {args: ['/base/build/ci-test/my.test-runner.js']},
//
// Karma calls start once the page has loaded, module scripts may not have run
// yet: cljs.esm.karma/start runs the tests in whichever order the two happen.
window.__karma__.start = function () {
  window.__karmaStarted = true;
  if (window.__karmaRun) window.__karmaRun();
};

// Karma loads included files with a cache-busting query, the test bundle's
// chunks import its entry without one: a module of its own, which would run
// the entry twice. The entry is imported by its plain URL.
const [entryUrl] = window.__karma__.config.args;
const entry = document.createElement('script');
entry.type = 'module';
entry.textContent = `import ${JSON.stringify(entryUrl)};`;
document.head.appendChild(entry);
