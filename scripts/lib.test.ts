import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayPush, entriesFor, stableAttachments, lastBusinessDay, type RawPR, type RawCommit, type Details } from './lib';

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

const descSpy = () => {
  const calls: number[] = [];
  return { calls, fn: async (n: number) => { calls.push(n); return `<p>#${n}</p>`; } };
};

test('description: opened, fixup and touched cards carry it, merged does not', async () => {
  const spy = descSpy();
  const list = [
    pr({ number: 1, body: 'x', mergedAt: '2026-06-05T15:00:00Z' }),
    pr({ number: 2, body: 'x', createdAt: '2026-06-05T08:00:00Z' }),
    pr({ number: 3, body: 'x' }),
    pr({ number: 4, body: 'x' }),
  ];
  const d = det({ 3: { commits: [commit('2026-06-05T12:00:00Z')], forcePushes: [] } });
  const out = await entriesFor(D, list, d, ME, spy.fn);
  const byNum = Object.fromEntries(out.map(e => [e.num, e]));
  assert.equal(byNum[1].description, undefined);
  assert.equal(byNum[2].description, '<p>#2</p>');
  assert.equal(byNum[3].bucket, 'fixup');
  assert.equal(byNum[3].description, '<p>#3</p>');
  assert.equal(byNum[4].bucket, 'touched');
  assert.equal(byNum[4].description, '<p>#4</p>');
  assert.deepEqual(spy.calls.sort(), [2, 3, 4]);
});

test('description: a blank or null body is never fetched', async () => {
  const spy = descSpy();
  const out = await entriesFor(D, [
    pr({ number: 1, body: null, createdAt: '2026-06-05T08:00:00Z' }),
    pr({ number: 2, body: '  \n ', createdAt: '2026-06-05T09:00:00Z' }),
  ], noDet, ME, spy.fn);
  assert.equal(out.length, 2);
  assert.ok(out.every(e => e.description === undefined));
  assert.deepEqual(spy.calls, []);
});

test('stableAttachments: signed attachment URLs become stable ones', () => {
  const uuid = '36b555b6-b4ac-46c3-8cb8-56fb574b7c89';
  const signed = `https://private-user-images.githubusercontent.com/47394200/672994887-${uuid}.gif?jwt=eyJ.a-b_c`;
  const html = `<a href="${signed}"><img src="${signed}" alt="x"></a>`;
  const stable = `https://github.com/user-attachments/assets/${uuid}`;
  assert.equal(stableAttachments(html), `<a href="${stable}"><img src="${stable}" alt="x"></a>`);
  assert.equal(stableAttachments('<img src="https://example.com/a.png">'), '<img src="https://example.com/a.png">');
});

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

test('entriesFor: my PR merged on D, bare merge (no content)', async () => {
  const [e] = await entriesFor(D, [pr({ mergedAt: '2026-06-05T15:00:00Z', baseRefName: 'main' })], noDet, ME);
  assert.equal(e.bucket, 'merged');
  assert.equal(e.event, 'merge');
  assert.equal(e.base, 'main');
  assert.deepEqual(e.badges, []);
  assert.equal(e.author, ME);
  assert.equal(e.mine, true);
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

test('entriesFor: source branch (headRefName) surfaced on the entry', async () => {
  const [e] = await entriesFor(D, [pr({ headRefName: 'feature/foo', mergedAt: '2026-06-05T15:00:00Z' })], noDet, ME);
  assert.equal(e.head, 'feature/foo');
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

test('entriesFor: createdDay records the Paris creation day, not the reported day', async () => {
  const d = det({ 1: { commits: [commit('2026-06-05T11:00:00Z')], forcePushes: [] } });
  const [e] = await entriesFor(D, [pr({ createdAt: '2026-06-02T22:30:00Z' })], d, ME);
  assert.equal(e.createdDay, '2026-06-03');
});

test('entriesFor: PR merged before D → excluded', async () => {
  assert.equal((await entriesFor(D, [pr({ mergedAt: '2026-06-01T10:00:00Z' })], noDet, ME)).length, 0);
});

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

test('entriesFor: buckets ordered merged → opened → fixup → touched', async () => {
  const prs = [
    pr({ number: 1, updatedAt: '2026-06-05T16:00:00Z' }),
    pr({ number: 2, createdAt: '2026-06-05T08:00:00Z' }),
    pr({ number: 3, mergedAt: '2026-06-05T15:00:00Z' }),
  ];
  assert.deepEqual((await entriesFor(D, prs, noDet, ME)).map(e => e.bucket), ['merged', 'opened', 'touched']);
});

test('entriesFor: Paris/UTC boundary - 22:30Z lands on the next Paris day', async () => {
  const p = pr({ createdAt: '2026-06-05T22:30:00Z', updatedAt: '2026-06-05T22:30:00Z' });
  assert.equal((await entriesFor('2026-06-06', [p], noDet, ME))[0]?.bucket, 'opened');
  assert.equal((await entriesFor('2026-06-05', [p], noDet, ME)).length, 0);
});

test('lastBusinessDay: Monday → previous Friday', () => {
  assert.equal(lastBusinessDay('2026-06-15'), '2026-06-12');
});

test('lastBusinessDay: midweek → day before', () => {
  assert.equal(lastBusinessDay('2026-06-11'), '2026-06-10');
});

test('lastBusinessDay: Saturday → Friday', () => {
  assert.equal(lastBusinessDay('2026-06-13'), '2026-06-12');
});

test('lastBusinessDay: Sunday → Friday', () => {
  assert.equal(lastBusinessDay('2026-06-14'), '2026-06-12');
});
