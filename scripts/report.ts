/**
 * Report CLI - PRecap's only entry point. Classifies a single day (default: last
 * business day) for the repos passed via --repos, then bakes a fully
 * self-contained report.html - bundle, CSS and data inlined - that opens straight
 * from file://, with no server.
 *
 *   tsx scripts/report.ts --repos owner/a,owner/b [YYYY-MM-DD]
 *                         [--lang fr|en] [-o out.html] [--force] [--no-build] [--no-open]
 *
 * Stateless: the repos to report are whatever --repos says (bake them into a
 * shell alias). No config file, no remembered list. The UI is a static render:
 * it shows the pinned day (window.PR_DAY) for the pinned repos (window.PR_REPOS),
 * with a client-side repo filter and a FR/EN toggle - no fetching, no settings.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, explainGhError, lastBusinessDay, refreshDays } from './lib';
import { REPO_RE } from '../src/types';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? lastBusinessDay();
const out = opt('-o') ?? join(ROOT, 'dist/report.html');

const lang = (opt('--lang') ?? 'fr').toLowerCase();
if (lang !== 'fr' && lang !== 'en') {
  console.error(`Invalid language: ${lang} - expected fr or en.`);
  process.exit(1);
}

const repos = (opt('--repos') ?? '').split(',').map(r => r.trim()).filter(Boolean);
if (!repos.length) {
  console.error('No repo: pass --repos owner/a,owner/b (easiest is to bake it into a shell alias).');
  process.exit(1);
}
const invalid = repos.filter(r => !REPO_RE.test(r));
if (invalid.length) {
  console.error(`Invalid repo(s): ${invalid.join(', ')} - expected format owner/name.`);
  process.exit(1);
}

// Build first so the inlined bundle is never stale (≈100 ms, negligible).
if (!flag('--no-build')) {
  console.log('Building…');
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
}
if (!existsSync(join(ROOT, 'dist/index.html'))) {
  console.error('dist/ missing - run a build first (drop --no-build).');
  process.exit(1);
}

// Classify each repo, with a terminal spinner; a gh failure on one repo (bad
// name, no rights, not logged in) is reported cleanly and skips just that repo.
const failed = new Map<string, string>();
for (const repo of repos) {
  const spin = createSpinner();
  spin.start(`${repo} @ ${date}`);
  try {
    await refreshDays([date], repo, flag('--force'), step => spin.text(`${repo} @ ${date} - ${step}…`));
    spin.succeed(`${repo} @ ${date}`);
  } catch (err) {
    const msg = explainGhError(err, repo);
    spin.fail(msg);
    failed.set(repo, msg);
  }
}

const shown = repos.filter(r => !failed.has(r));
if (!shown.length) {
  console.error('\nNo repo could be fetched - report not generated.');
  process.exit(1);
}

writeFileSync(out, inline(shown));
console.log(`\nReport: ${out}`);
if (failed.size) console.error(`(${failed.size} repo(s) failed, not included: ${[...failed.keys()].join(', ')})`);
if (!flag('--no-open') && !process.env.PRECAP_NO_OPEN) open(out);
process.exit(failed.size ? 1 : 0);

/**
 * Minimal terminal spinner on stderr. Animates only on a TTY; piped/CI output
 * just gets plain start/finish lines (no escape-code noise in logs).
 */
function createSpinner() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const tty = process.stderr.isTTY;
  let i = 0, label = '', timer: NodeJS.Timeout | undefined;
  const draw = () => process.stderr.write(`\r${frames[i++ % frames.length]} ${label}\x1b[K`);
  const stop = (final: string) => {
    if (timer) clearInterval(timer);
    process.stderr.write(tty ? `\r\x1b[K${final}\n\x1b[?25h` : `${final}\n`);
  };
  return {
    start(t: string) {
      label = t;
      if (!tty) return void process.stderr.write(`… ${t}\n`);
      process.stderr.write('\x1b[?25l'); // hide cursor
      timer = setInterval(draw, 80);
      draw();
    },
    text(t: string) { label = t; },
    succeed(t: string) { stop(`\x1b[32m✓\x1b[0m ${t}`); },
    fail(t: string) { stop(`\x1b[31m✗\x1b[0m ${t}`); },
  };
}

/** Inlines the hashed JS/CSS assets and data.js into a single standalone HTML. */
function inline(reportRepos: string[]): string {
  const dist = join(ROOT, 'dist');
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  // A clear error beats a cryptic `null[1]` TypeError when Vite's output shape
  // changes (code-splitting, modulepreload, a renamed/extra asset…).
  const must = (re: RegExp, what: string): string => {
    const m = html.match(re);
    if (!m) throw new Error(`Inlining failed: ${what} not found in dist/index.html - Vite's output shape may have changed.`);
    return m[1];
  };
  // Function replacer: returns the payload verbatim, so `$&`/`$1` sequences that
  // occur in minified JS/CSS aren't reinterpreted as replacement patterns.
  const replaceOnce = (s: string, re: RegExp, repl: string, what: string): string => {
    if (!re.test(s)) throw new Error(`Inlining failed: ${what} tag not found in dist/index.html - Vite's output shape may have changed.`);
    return s.replace(re, () => repl);
  };
  // `</script>` inside the inlined JS/JSON would close the tag early - neutralise
  // it case-insensitively (HTML tag matching ignores case, so `</SCRIPT` counts).
  const safe = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  const data = safe(readFileSync(join(dist, 'data.js'), 'utf8'));
  const js = safe(readFileSync(join(dist, must(/src="\.\/(assets\/[^"]+\.js)"/, 'JS bundle')), 'utf8'));
  const css = readFileSync(join(dist, must(/href="\.\/(assets\/[^"]+\.css)"/, 'CSS asset')), 'utf8');
  // Pin the day and the repo set this report is about (the UI renders only these).
  const pins = `window.PR_DAY=${JSON.stringify(date)};window.PR_REPOS=${JSON.stringify(reportRepos)};window.PR_LANG=${JSON.stringify(lang)};`;
  let result = replaceOnce(html, /<script src="\.\/data\.js"><\/script>/, `<script>${data}\n${pins}</script>`, 'data.js');
  result = replaceOnce(result, /<script type="module"[^>]*><\/script>/, `<script type="module">${js}</script>`, 'module script');
  return replaceOnce(result, /<link rel="stylesheet"[^>]*>/, `<style>${css}</style>`, 'stylesheet link');
}

/** Opens the file in the default browser (best-effort). */
function open(file: string): void {
  const url = `file://${file}`;
  // No shell: the path is passed as a discrete argv entry, so metacharacters in
  // it (e.g. `&` from `-o`) can't be interpreted as commands. On Windows the
  // opener is the cmd builtin `start`, with an empty title arg ("").
  const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  spawn(cmd as string, cmdArgs as string[], { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}
