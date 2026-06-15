/**
 * Unit tests for the pure classification logic of lib.ts (no gh, no I/O).
 * Run with: npm test  (node --import tsx --test)
 *
 * Times are asserted in Europe/Paris; June 2026 is CEST (UTC+2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectOf, dayPush, entriesFor, lastBusinessDay, type RawPR, type RawCommit, type Details } from './lib';

const ME = 'alice';
const D = '2026-06-05';

const pr = (o: Partial<RawPR> = {}): RawPR => ({
  number: 1, title: 'feat: x', state: 'OPEN', isDraft: false, body: null,
  headRefName: 'feature/x', baseRefName: 'master',
  createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-05T10:00:00Z',
  mergedAt: null, author: { login: ME }, mergedBy: null, ...o,
});

const commit = (committedDate: string, authoredDate = committedDate, login = ME): RawCommit =>
  ({ committedDate, authoredDate, authors: [{ login }] });

const noDet = (_n: number): Details => ({ commits: [], forcePushes: [] });
const det = (map: Record<number, Details>) => (n: number): Details => map[n] ?? { commits: [], forcePushes: [] };

// --- subjectOf (generic Jira, no project/org hardcoded) ----------------------

test('subjectOf: Jira link in body, any host/project', () => {
  const s = subjectOf(pr({ body: 'see [Fix login](https://acme.atlassian.net/browse/PROJ-42) ok' }));
  assert.deepEqual(s.tickets, ['PROJ-42']);
  assert.match(s.html, /PROJ-42/);
  assert.match(s.html, /Fix login/);
});

test('subjectOf: self-hosted Jira host also works', () => {
  assert.deepEqual(subjectOf(pr({ body: '[x](https://jira.acme.com/browse/AB12-9)' })).tickets, ['AB12-9']);
});

test('subjectOf: fallback to a ticket key in the branch name', () => {
  const s = subjectOf(pr({ body: null, headRefName: 'feature/PROJ-7-stuff' }));
  assert.deepEqual(s.tickets, ['PROJ-7']);
  assert.match(s.html, /PROJ-7/);
});

test('subjectOf: no ticket anywhere → empty subject', () => {
  const s = subjectOf(pr({ body: 'nothing here', headRefName: 'chore/cleanup' }));
  assert.equal(s.html, '');
  assert.deepEqual(s.tickets, []);
});

test('subjectOf: body link wins over branch key', () => {
  const s = subjectOf(pr({ body: '[a](https://x.atlassian.net/browse/AAA-1)', headRefName: 'feature/BBB-2' }));
  assert.deepEqual(s.tickets, ['AAA-1']);
});

test('subjectOf: HTML-escapes the label', () => {
  const s = subjectOf(pr({ body: '[<b>a&b</b>](https://x.atlassian.net/browse/ZZ-1)' }));
  assert.ok(!s.html.includes('<b>'));
  assert.match(s.html, /&amp;/);
});

// --- dayPush -----------------------------------------------------------------

test('dayPush: commit committed & authored on D → push (Paris time)', () => {
  const r = dayPush(D, [commit('2026-06-05T12:30:00Z')], []);
  assert.equal(r.kind, 'push');
  assert.equal(r.time, '14:30');
});

test('dayPush: committed on D, authored before, + force on D → rebase', () => {
  const r = dayPush(D, [commit('2026-06-05T09:00:00Z', '2026-06-01T09:00:00Z')], ['2026-06-05T09:05:00Z']);
  assert.equal(r.kind, 'rebase');
});

test('dayPush: committed on D, authored before, no force → push (not rebase)', () => {
  const r = dayPush(D, [commit('2026-06-05T09:00:00Z', '2026-06-01T09:00:00Z')], []);
  assert.equal(r.kind, 'push');
});

test('dayPush: only a force-push on D → rebase', () => {
  assert.equal(dayPush(D, [], ['2026-06-05T08:00:00Z']).kind, 'rebase');
});

test('dayPush: no activity on D → null', () => {
  assert.equal(dayPush(D, [commit('2026-06-04T12:00:00Z')], ['2026-06-03T12:00:00Z']).kind, null);
});

// --- entriesFor: my own PRs --------------------------------------------------

test('entriesFor: my PR merged on D, bare merge (no content)', async () => {
  const [e] = await entriesFor(D, [pr({ mergedAt: '2026-06-05T15:00:00Z', baseRefName: 'main' })], noDet, ME);
  assert.equal(e.bucket, 'merged');
  assert.equal(e.event, 'merge');
  assert.equal(e.base, 'main');
  assert.deepEqual(e.badges, []);
  assert.equal(e.author, ME);   // author shown on every card…
  assert.equal(e.mine, true);   // …`mine` is what distinguishes ours
});

test('entriesFor: my PR merged on D with content → modif+merge badge', async () => {
  const d = det({ 1: { commits: [commit('2026-06-05T10:00:00Z')], forcePushes: [] } });
  const [e] = await entriesFor(D, [pr({ mergedAt: '2026-06-05T15:00:00Z' })], d, ME);
  assert.deepEqual(e.badges, [['push', 'badge.modifMerge']]);
});

test('entriesFor: my PR opened on D', async () => {
  const [e] = await entriesFor(D, [pr({ createdAt: '2026-06-05T08:00:00Z' })], noDet, ME);
  assert.equal(e.bucket, 'opened');
  assert.equal(e.event, 'open');
});

test('entriesFor: my pre-existing PR pushed on D → fixup/push', async () => {
  const d = det({ 1: { commits: [commit('2026-06-05T11:00:00Z')], forcePushes: [] } });
  const [e] = await entriesFor(D, [pr({})], d, ME);
  assert.equal(e.bucket, 'fixup');
  assert.equal(e.event, 'push');
});

test('entriesFor: my PR touched on D without push → touched bucket, no dot', async () => {
  const [e] = await entriesFor(D, [pr({ updatedAt: '2026-06-05T16:00:00Z' })], noDet, ME);
  assert.equal(e.bucket, 'touched');
  assert.equal(e.event, null);
});

test('entriesFor: PR merged before D → excluded', async () => {
  assert.equal((await entriesFor(D, [pr({ mergedAt: '2026-06-01T10:00:00Z' })], noDet, ME)).length, 0);
});

// --- entriesFor: other people's PRs (only my actions surface) ----------------

test("entriesFor: someone else's PR I merged → merged + author chip", async () => {
  const p = pr({ author: { login: 'bob' }, mergedBy: { login: ME }, mergedAt: '2026-06-05T15:00:00Z' });
  const [e] = await entriesFor(D, [p], noDet, ME);
  assert.equal(e.bucket, 'merged');
  assert.equal(e.author, 'bob');
  assert.equal(e.mine, false);
  assert.equal(e.mergedBy, ME);
});

test("entriesFor: someone else's PR merged by someone else → excluded", async () => {
  const p = pr({ author: { login: 'bob' }, mergedBy: { login: 'carol' }, mergedAt: '2026-06-05T15:00:00Z' });
  assert.equal((await entriesFor(D, [p], noDet, ME)).length, 0);
});

test("entriesFor: someone else's PR, merged by someone else, but I pushed today → fixup", async () => {
  const p = pr({ author: { login: 'bob' }, mergedBy: { login: 'carol' }, mergedAt: '2026-06-05T15:00:00Z' });
  const d = det({ 1: { commits: [commit('2026-06-05T10:00:00Z', '2026-06-05T10:00:00Z', ME)], forcePushes: [] } });
  const [e] = await entriesFor(D, [p], d, ME);
  assert.equal(e.bucket, 'fixup');
  assert.equal(e.event, 'push');
  assert.equal(e.author, 'bob');
});

test("entriesFor: someone else's PR opened on D → not in 'opened'", async () => {
  const p = pr({ author: { login: 'bob' }, createdAt: '2026-06-05T08:00:00Z', updatedAt: '2026-06-05T08:00:00Z' });
  assert.equal((await entriesFor(D, [p], noDet, ME)).length, 0);
});

test("entriesFor: someone else's PR only touched (no push of mine) → excluded", async () => {
  const p = pr({ author: { login: 'bob' }, updatedAt: '2026-06-05T16:00:00Z' });
  assert.equal((await entriesFor(D, [p], noDet, ME)).length, 0);
});

test("entriesFor: a commit authored by someone else on their PR doesn't count as mine", async () => {
  const p = pr({ author: { login: 'bob' } });
  const d = det({ 1: { commits: [commit('2026-06-05T10:00:00Z', '2026-06-05T10:00:00Z', 'bob')], forcePushes: [] } });
  assert.equal((await entriesFor(D, [p], d, ME)).length, 0);
});

// --- entriesFor: ordering & timezone -----------------------------------------

test('entriesFor: buckets ordered merged → opened → fixup → touched', async () => {
  const prs = [
    pr({ number: 1, updatedAt: '2026-06-05T16:00:00Z' }),   // touched
    pr({ number: 2, createdAt: '2026-06-05T08:00:00Z' }),   // opened
    pr({ number: 3, mergedAt: '2026-06-05T15:00:00Z' }),    // merged
  ];
  assert.deepEqual((await entriesFor(D, prs, noDet, ME)).map(e => e.bucket), ['merged', 'opened', 'touched']);
});

test('entriesFor: Paris/UTC boundary - 22:30Z lands on the next Paris day', async () => {
  // 2026-06-05T22:30:00Z = 2026-06-06 00:30 in Paris (CEST)
  const p = pr({ createdAt: '2026-06-05T22:30:00Z', updatedAt: '2026-06-05T22:30:00Z' });
  assert.equal((await entriesFor('2026-06-06', [p], noDet, ME))[0]?.bucket, 'opened');
  assert.equal((await entriesFor('2026-06-05', [p], noDet, ME)).length, 0);
});

// --- lastBusinessDay (Friday if Monday, day before otherwise; skips weekends) -

test('lastBusinessDay: Monday → previous Friday', () => {
  assert.equal(lastBusinessDay('2026-06-15'), '2026-06-12'); // Mon → Fri
});

test('lastBusinessDay: midweek → day before', () => {
  assert.equal(lastBusinessDay('2026-06-11'), '2026-06-10'); // Thu → Wed
});

test('lastBusinessDay: Saturday → Friday', () => {
  assert.equal(lastBusinessDay('2026-06-13'), '2026-06-12');
});

test('lastBusinessDay: Sunday → Friday', () => {
  assert.equal(lastBusinessDay('2026-06-14'), '2026-06-12');
});
