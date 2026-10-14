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

export interface RawForce {
  time: string;
  actor: string;
}

export interface Details {
  commits: RawCommit[];
  forcePushes: RawForce[];
}

const execFileAsync = promisify(execFile);

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

export function lastBusinessDay(from: string = todayParis()): string {
  let d = shiftDay(from, -1);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = shiftDay(d, -1);
  return d;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const SIGNED_ATTACHMENT_RE =
  /https:\/\/private-user-images\.githubusercontent\.com\/\d+\/\d+-([0-9a-f-]{36})\.\w+\?jwt=[^"\s]*/g;
export const stableAttachments = (html: string) =>
  html.replace(SIGNED_ATTACHMENT_RE, 'https://github.com/user-attachments/assets/$1');

const shortOf = (pr: RawPR) => esc(pr.title.replace(/^\w+\([^)]*\)\s*:?\s*/, '').slice(0, 40));
const stateBadge = (pr: RawPR): [string, string] => {
  const state = pr.isDraft ? 'draft' : pr.state.toLowerCase();
  return [state, `badge.state.${state}`];
};

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

export async function entriesFor(day: string, prList: RawPR[], details: (num: number) => Details | Promise<Details>, me: string,
  describe: (num: number) => Promise<string | undefined> = async () => undefined): Promise<PREntry[]> {
  const out: PREntry[] = [];
  for (const pr of prList) {
    const mine = pr.author?.login === me;
    const created = parisDay(pr.createdAt);
    const merged = pr.mergedAt ? parisDay(pr.mergedAt) : null;
    const description = async () => (pr.body?.trim() ? describe(pr.number) : undefined);
    const common = { num: pr.number, title: esc(pr.title), short: shortOf(pr),
      head: esc(pr.headRefName), author: pr.author ? esc(pr.author.login) : undefined, mine, createdDay: created };

    const ours = (d: Details) => ({
      commits: mine ? d.commits : d.commits.filter(c => c.authors.some(a => a.login === me)),
      forceTimes: (mine ? d.forcePushes : d.forcePushes.filter(f => f.actor === me)).map(f => f.time),
    });

    if (merged === day && (mine || pr.mergedBy?.login === me)) {
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
    if (merged && merged < day) continue;

    if (created === day && mine) {
      out.push({ ...common, bucket: 'opened', time: parisTime(pr.createdAt), event: 'open',
        badges: [stateBadge(pr)], description: await description() });
      continue;
    }
    if (created > day || parisDay(pr.updatedAt) < day) continue;

    const { commits, forceTimes } = ours(await details(pr.number));
    const push = dayPush(day, commits, forceTimes);
    let kind: 'push' | 'rebase' | 'nopush' | null = push.kind;
    let time = push.time;
    if (!kind && mine && parisDay(pr.updatedAt) === day) {
      kind = 'nopush';
      time = parisTime(pr.updatedAt);
    }
    if (!kind) continue;

    const kindBadge: [string, string][] = kind === 'rebase' ? [['rebase', 'badge.rebaseEmpty']] : [];
    const releaseBadges: [string, string][] = pr.headRefName.startsWith('release/') ? [['release', 'badge.release']] : [];
    out.push({ ...common, bucket: kind === 'nopush' ? 'touched' : 'fixup', time,
      event: kind === 'nopush' ? null : kind,
      badges: [...releaseBadges, ...kindBadge, stateBadge(pr)], description: await description() });
  }
  const order = { merged: 0, opened: 1, fixup: 2, touched: 3 };
  return out.sort((a, b) => order[a.bucket] - order[b.bucket] || b.time.localeCompare(a.time));
}

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

export async function refreshDays(days: string[], repo: string, force = false, onStep?: (label: string) => void): Promise<PRData> {
  const prev = loadData();
  const repos = prev.repos;
  const captured = repos[repo]?.days ?? {};
  const sorted = [...days].sort();
  const todo = force ? sorted : sorted.filter(d => captured[d] === undefined);

  if (!todo.length) return prev;

  onStep?.('checking access');
  const repoInfo = JSON.parse(await gh('repo', 'view', repo, '--json', 'nameWithOwner,defaultBranchRef'));
  const defaultBranch: string = repoInfo.defaultBranchRef?.name ?? 'main';

  onStep?.('identity');
  const me = (await gh('api', 'user', '--jq', '.login')).trim();

  const FIELDS = 'number,title,state,isDraft,body,headRefName,baseRefName,createdAt,updatedAt,mergedAt,author,mergedBy';
  const low = shiftDay(todo[0], -1);

  onStep?.('your PRs');
  const mine: RawPR[] = JSON.parse(await gh('pr', 'list', '-R', repo, '--author', '@me', '--state', 'all',
    '--search', `updated:>=${low}`, '--json', FIELDS, '--limit', '200'));

  onStep?.("others' PRs");
  const high = shiftDay(todo[todo.length - 1], 3);
  const others: RawPR[] = JSON.parse(await gh('pr', 'list', '-R', repo, '--state', 'all',
    '--search', `-author:@me updated:${low}..${high}`, '--json', FIELDS, '--limit', '200'));

  const prList = [...mine, ...others];

  const detailCache = new Map<number, Details>();
  const details = async (num: number): Promise<Details> => {
    let cached = detailCache.get(num);
    if (!cached) {
      onStep?.(`PR #${num} details`);
      const { commits } = JSON.parse(await gh('pr', 'view', String(num), '-R', repo, '--json', 'commits'));
      let forcePushes: RawForce[];
      try {
        forcePushes = (await gh('api', `repos/${repo}/issues/${num}/timeline`, '--paginate',
          '--jq', '.[] | select(.event == "head_ref_force_pushed") | {time: .created_at, actor: .actor.login}'))
          .split('\n').filter(Boolean).map(line => JSON.parse(line));
      } catch {
        forcePushes = [];
      }
      (commits as RawCommit[]).sort((a, b) => a.committedDate.localeCompare(b.committedDate));
      cached = { commits, forcePushes };
      detailCache.set(num, cached);
    }
    return cached;
  };

  const descCache = new Map<number, string | undefined>();
  const describe = async (num: number): Promise<string | undefined> => {
    if (!descCache.has(num)) {
      onStep?.(`PR #${num} description`);
      const html = await gh('api', `repos/${repo}/pulls/${num}`,
        '-H', 'Accept: application/vnd.github.html+json', '--jq', '.body_html // ""');
      descCache.set(num, stableAttachments(html.trim()) || undefined);
    }
    return descCache.get(num);
  };

  const daysOut = captured;
  for (const day of todo) daysOut[day] = await entriesFor(day, prList, details, me, describe);
  repos[repo] = { days: daysOut, defaultBranch };

  const cutoff = shiftDay(todayParis(), -KEEP_DAYS);
  const requested = new Set(todo);
  for (const repoData of Object.values(repos)) {
    for (const key of Object.keys(repoData.days)) {
      if (key < cutoff && !requested.has(key)) delete repoData.days[key];
    }
  }

  return writeData(repos);
}
