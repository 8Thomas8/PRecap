/**
 * PRecap data generation - no AI, pure `gh` CLI + classification rules.
 *
 * Scope: our own PRs get the full treatment below. On other people's PRs we only
 * surface actions we performed - a merge we clicked, or commits / force-pushes we
 * authored on D - tagged with the PR author in the UI.
 *
 * Classification per Paris day D (priority order, one bucket per PR):
 *  - merged  : mergedAt on D (badged "modif + merge" / "rebase + merge" when the
 *              branch also got our content on D, else bare merge)
 *  - opened  : createdAt on D (our PRs only)
 *  - fixup   : created before D, not merged before D, real branch activity on D:
 *      - commit committed on D, authored on D                  -> push
 *      - commit committed on D, authored before D, + force-push -> rebase
 *      - force-push on D without commit dated D                -> rebase
 *  - touched : our PR updated on D with no push at all (label, review, comment)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PRData, PREntry } from '../src/types';

const KEEP_DAYS = 90;
const TZ = 'Europe/Paris';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [join(ROOT, 'public/data.js'), join(ROOT, 'dist/data.js')];

export interface RawPR {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  body: string | null;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  author: { login: string } | null;
  mergedBy: { login: string } | null;
}

export interface RawCommit {
  authoredDate: string;
  committedDate: string;
  authors: { login: string }[];
}

/** A force-push timeline event: when it happened and who did it. */
export interface RawForce {
  time: string;
  actor: string;
}

export interface Details {
  commits: RawCommit[];
  forcePushes: RawForce[];
}

const execFileAsync = promisify(execFile);

/** Error from a failing `gh` call, carrying stderr so we can report it cleanly. */
export class GhError extends Error {
  constructor(readonly args: string[], readonly stderr: string, readonly code: number | string | null) {
    super(`gh ${args.join(' ')} failed`);
    this.name = 'GhError';
  }
}

const gh = async (...args: string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    throw new GhError(args, e.stderr ?? '', e.code ?? null);
  }
};

/** Maps a gh failure to a short, actionable message (no stack trace). */
export function explainGhError(err: unknown, repo: string): string {
  if (!(err instanceof GhError)) return `Failed on ${repo}: ${err instanceof Error ? err.message : String(err)}`;
  if (err.code === 'ENOENT') return 'gh not found - install the GitHub CLI (https://cli.github.com), then run `gh auth login`.';
  const s = err.stderr.toLowerCase();
  if (/could not resolve to a repository|http 404|not found/.test(s))
    return `Repo not found or no access: ${repo} - check the name (owner/name) and your permissions.`;
  if (/http 401|authentication|not logged|gh auth login/.test(s))
    return 'gh not authenticated - run `gh auth login`.';
  if (/http 403|resource not accessible|forbidden|permission/.test(s))
    return `Insufficient permissions on ${repo} - your token must be able to read this repo's Pull requests.`;
  const first = err.stderr.trim().split('\n').find(Boolean);
  return `gh failed on ${repo}: ${first ?? err.message}`;
}

const parisDay = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
const parisTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const shiftDay = (day: string, delta: number) =>
  parisDay(new Date(Date.parse(`${day}T12:00:00Z`) + delta * 864e5).toISOString());
const todayParis = () => parisDay(new Date().toISOString());

/**
 * Most recent business day strictly before `from` (default: today, Paris).
 * Friday when `from` is Monday, the day before otherwise; weekends skipped.
 * Matches the `pr-recap` convention. `from` defaulted for prod, injectable for tests.
 */
export function lastBusinessDay(from: string = todayParis()): string {
  let d = shiftDay(from, -1);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = shiftDay(d, -1);
  return d;
}

// Escapes the five HTML-significant chars: < > & in text context, plus " ' so a
// value is also safe inside a double/single-quoted attribute. Everything baked
// into the report's innerHTML goes through here.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// --- Subject (Jira ticket of the PR, if any) --------------------------------

// Generic Jira issue key (e.g. PROJ-123, AB12-9) - no project/org hardcoded.
const TICKET_RE = /[A-Z][A-Z0-9]+-\d+/;
const ticketHtml = (id: string) => `<span class="ticket">${id}</span>`;

/**
 * Subject shown under a PR: its Jira ticket, or nothing. Looks for a Jira link
 * in the body first (any host, `…/browse/KEY`), then falls back to a key in the
 * branch name. No ticket anywhere → empty subject.
 */
export function subjectOf(pr: RawPR): { html: string; tickets: string[] } {
  // First Jira link of the PR body: [label](https://<host>/browse/KEY)
  const link = (pr.body ?? '').match(/\[([^\]]*)\]\(https?:\/\/[^)]*\/browse\/([A-Z][A-Z0-9]+-\d+)\)/);
  if (link) return { html: `${ticketHtml(link[2])}${esc(link[1].trim())}`, tickets: [link[2]] };

  // Fallback: a ticket key in the branch name (e.g. feature/PROJ-123-foo)
  const m = pr.headRefName.match(TICKET_RE);
  return m ? { html: ticketHtml(m[0]), tickets: [m[0]] } : { html: '', tickets: [] };
}

// --- Classification ----------------------------------------------------------

const shortOf = (pr: RawPR) => esc(pr.title.replace(/^\w+\([^)]*\)\s*:?\s*/, '').slice(0, 40));
// Badge = [variant, i18nKey]: variant drives the colour, the key is translated
// by the front at render time (see src/i18n.ts).
const stateBadge = (pr: RawPR): [string, string] => {
  // A draft PR is `state: OPEN` on GitHub; surface it as its own badge.
  const state = pr.isDraft ? 'draft' : pr.state.toLowerCase();
  return [state, `badge.state.${state}`];
};

/**
 * Did the branch get content on D? A commit committed on D is a `push`, unless
 * it was only re-applied by a same-day force-push of older work (`rebase`); a
 * bare force-push on D is also a `rebase`. Returns the matching event time.
 */
export function dayPush(day: string, commits: RawCommit[], forceTimes: string[]): { kind: 'push' | 'rebase' | null; time: string } {
  const dayCommits = commits.filter(c => parisDay(c.committedDate) === day);
  const dayForce = forceTimes.filter(f => parisDay(f) === day);
  if (dayCommits.length) {
    const last = dayCommits[dayCommits.length - 1];
    const kind = dayForce.length && parisDay(last.authoredDate) < day ? 'rebase' : 'push';
    return { kind, time: parisTime(last.committedDate) };
  }
  if (dayForce.length) return { kind: 'rebase', time: parisTime(dayForce[dayForce.length - 1]) };
  return { kind: null, time: '' };
}

/**
 * Classifies a repo's PR activity on a Paris day for user `me`.
 * Our own PRs keep the full treatment (merge/open/push/rebase/touched). For
 * other people's PRs we only surface actions we performed: a merge we clicked,
 * or commits / force-pushes we authored on D.
 */
export async function entriesFor(day: string, prList: RawPR[], details: (num: number) => Details | Promise<Details>, me: string): Promise<PREntry[]> {
  const out: PREntry[] = [];
  for (const pr of prList) {
    const mine = pr.author?.login === me;
    const created = parisDay(pr.createdAt);
    const merged = pr.mergedAt ? parisDay(pr.mergedAt) : null;
    const subject = subjectOf(pr);
    // `mine` compares raw logins; the stored author/mergedBy are display-only and
    // escaped like every other value baked into the report's HTML (defence in
    // depth - GitHub logins are charset-safe, but the escape boundary is uniform).
    const common = { num: pr.number, title: esc(pr.title), short: shortOf(pr), tickets: subject.tickets,
      author: pr.author ? esc(pr.author.login) : undefined, mine };

    // On other people's PRs, restrict commit/force-push activity to ours.
    const ours = (d: Details) => ({
      commits: mine ? d.commits : d.commits.filter(c => c.authors.some(a => a.login === me)),
      forceTimes: (mine ? d.forcePushes : d.forcePushes.filter(f => f.actor === me)).map(f => f.time),
    });

    if (merged === day && (mine || pr.mergedBy?.login === me)) {
      // Did the PR get new content on D before being merged, or was it just a
      // merge click on already-existing code? Same push/rebase detection as fixups.
      const { commits, forceTimes } = ours(await details(pr.number));
      const { kind } = dayPush(day, commits, forceTimes);
      const modifBadge: [string, string][] =
        kind === 'rebase' ? [['rebase', 'badge.rebaseMerge']]
        : kind === 'push' ? [['push', 'badge.modifMerge']]
        : [];
      out.push({ ...common, bucket: 'merged', time: parisTime(pr.mergedAt!), event: 'merge',
        base: esc(pr.baseRefName), mergedBy: pr.mergedBy ? esc(pr.mergedBy.login) : undefined, badges: modifBadge });
      continue;
    }
    // A PR merged on D by someone else can still hold a push of ours today, so
    // only skip PRs merged strictly before D.
    if (merged && merged < day) continue;

    if (created === day && mine) {
      out.push({ ...common, bucket: 'opened', time: parisTime(pr.createdAt), event: 'open',
        badges: [stateBadge(pr)], subject: subject.html });
      continue;
    }
    if (created > day || parisDay(pr.updatedAt) < day) continue;

    // Fixup candidate: pre-existing PR with possible activity on D
    const { commits, forceTimes } = ours(await details(pr.number));
    const push = dayPush(day, commits, forceTimes);
    let kind: 'push' | 'rebase' | 'nopush' | null = push.kind;
    let time = push.time;
    if (!kind && mine && parisDay(pr.updatedAt) === day) {
      // Our PR, no new content, but touched on D (label, review, comment...).
      // We don't track this for others' PRs - only their content actions of ours.
      kind = 'nopush';
      time = parisTime(pr.updatedAt);
    }
    if (!kind) continue;

    // Only a rebase carries a per-card badge. 'push' and 'nopush' don't: the
    // section header ("touched, not pushed" / fixup) already conveys them.
    const kindBadge: [string, string][] = kind === 'rebase' ? [['rebase', 'badge.rebaseEmpty']] : [];
    const releaseBadges: [string, string][] = pr.headRefName.startsWith('release/') ? [['release', 'badge.release']] : [];
    out.push({ ...common, bucket: kind === 'nopush' ? 'touched' : 'fixup', time,
      event: kind === 'nopush' ? null : kind,
      badges: [...releaseBadges, ...kindBadge, stateBadge(pr)],
      subject: subject.html });
  }
  const order = { merged: 0, opened: 1, fixup: 2, touched: 3 };
  return out.sort((a, b) => order[a.bucket] - order[b.bucket] || b.time.localeCompare(a.time));
}

// --- Fetch + persist -----------------------------------------------------------

function writeData(repos: PRData['repos']): PRData {
  const data: PRData = { generatedAt: new Date().toISOString(), repos };
  const payload = `window.PR_DATA = ${JSON.stringify(data, null, 2)};\n`;
  for (const target of TARGETS) {
    if (target.includes('dist') && !existsSync(dirname(target))) continue;
    writeFileSync(target, payload);
  }
  return data;
}

function loadData(): PRData {
  const empty: PRData = { generatedAt: '', repos: {} };
  if (!existsSync(TARGETS[0])) return empty;
  const raw = readFileSync(TARGETS[0], 'utf8');
  const parsed = JSON.parse(raw.slice(raw.indexOf('=') + 1).replace(/;\s*$/, ''));
  return parsed.repos ? { generatedAt: parsed.generatedAt ?? '', repos: parsed.repos } : empty;
}

/**
 * Fetches PR activity on a repo, classifies the given Paris days, merges them
 * into data.js (public/ + dist/ when present) and returns the full dataset.
 *
 * Captured days are frozen: a day already present in data.js is skipped unless
 * `force` is set. Replaying an old day recomputes it from the PRs' *current*
 * state - and a rebase rewrites commit dates, a later update moves `updatedAt` -
 * so a blind recompute would silently overwrite a correct past capture with a
 * degraded one. Forcing is the explicit opt-in to accept that trade-off.
 */
export async function refreshDays(days: string[], repo: string, force = false, onStep?: (label: string) => void): Promise<PRData> {
  const prev = loadData();
  const repos = prev.repos;
  const captured = repos[repo]?.days ?? {};
  const sorted = [...days].sort();
  const todo = force ? sorted : sorted.filter(d => captured[d] === undefined);

  // Nothing left to (re)compute - leave data.js untouched, return as-is.
  if (!todo.length) return prev;

  // Validate the repo up front: `gh pr list` returns [] (exit 0) on a missing or
  // inaccessible repo, so a typo would silently persist an empty repo. `gh repo
  // view` fails cleanly instead (404 / "could not resolve" / 403), before we write.
  onStep?.('checking access');
  const repoInfo = JSON.parse(await gh('repo', 'view', repo, '--json', 'nameWithOwner,defaultBranchRef'));
  // Repo's real default branch: lets the UI flag merges onto a *non-default* base
  // instead of hardcoding master/main. Falls back to 'main' if gh omits it.
  const defaultBranch: string = repoInfo.defaultBranchRef?.name ?? 'main';

  onStep?.('identity');
  const me = (await gh('api', 'user', '--jq', '.login')).trim();

  const FIELDS = 'number,title,state,isDraft,body,headRefName,baseRefName,createdAt,updatedAt,mergedAt,author,mergedBy';
  const low = shiftDay(todo[0], -1);

  // Our own PRs: padded lower bound (GitHub search dates are UTC, a Paris day can
  // start the UTC day before), no upper bound (a PR active on D can be updated since).
  onStep?.('your PRs');
  const mine: RawPR[] = JSON.parse(await gh('pr', 'list', '-R', repo, '--author', '@me', '--state', 'all',
    '--search', `updated:>=${low}`, '--json', FIELDS, '--limit', '200'));

  // Others' PRs where we may have acted (merge / push / rebase). Bounded on both
  // ends: an unbounded window would pull the whole repo when replaying old days.
  onStep?.("others' PRs");
  const high = shiftDay(todo[todo.length - 1], 3);
  const others: RawPR[] = JSON.parse(await gh('pr', 'list', '-R', repo, '--state', 'all',
    '--search', `-author:@me updated:${low}..${high}`, '--json', FIELDS, '--limit', '200'));

  const prList = [...mine, ...others];

  // Commits (with authors) + force-push events, one fetch per PR per run
  const detailCache = new Map<number, Details>();
  const details = async (num: number): Promise<Details> => {
    let cached = detailCache.get(num);
    if (!cached) {
      onStep?.(`PR #${num} details`);
      const { commits } = JSON.parse(await gh('pr', 'view', String(num), '-R', repo, '--json', 'commits'));
      let forcePushes: RawForce[] = [];
      try {
        forcePushes = (await gh('api', `repos/${repo}/issues/${num}/timeline`, '--paginate',
          '--jq', '.[] | select(.event == "head_ref_force_pushed") | {time: .created_at, actor: .actor.login}'))
          .split('\n').filter(Boolean).map(line => JSON.parse(line));
      } catch {
        // timeline can 404/410 on old PRs - treat as no force-push
      }
      (commits as RawCommit[]).sort((a, b) => a.committedDate.localeCompare(b.committedDate));
      cached = { commits, forcePushes };
      detailCache.set(num, cached);
    }
    return cached;
  };

  const daysOut = captured;
  for (const day of todo) daysOut[day] = await entriesFor(day, prList, details, me);
  repos[repo] = { days: daysOut, defaultBranch };

  // Drop days older than the retention window - but never a day we were just
  // asked to (re)compute, so `--force` on an old date still surfaces it.
  const cutoff = shiftDay(todayParis(), -KEEP_DAYS);
  const requested = new Set(todo);
  for (const repoData of Object.values(repos)) {
    for (const key of Object.keys(repoData.days)) {
      if (key < cutoff && !requested.has(key)) delete repoData.days[key];
    }
  }

  return writeData(repos);
}
