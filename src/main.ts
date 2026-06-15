import './style.css';
import type { PRData, PREntry, EventType, Bucket } from './types';
import { t, getLang, setLang, locale, type Key, type Lang } from './i18n';

const data: PRData = window.PR_DATA ?? { generatedAt: '', repos: {} };

type Entry = PREntry & { repo: string };

// --- State ---------------------------------------------------------------------

// Static render: the report pins its repos (window.PR_REPOS); under `npm run dev`
// we fall back to whatever is in data.js. The checkboxes are a client-side display
// filter only (no fetching, no persistence - all shown on each load).
const knownRepos: string[] = (window.PR_REPOS ?? Object.keys(data.repos)).sort();
const selectedRepos = new Set<string>(knownRepos);

const entriesFor = (day: string): Entry[] =>
  [...selectedRepos].flatMap(repo =>
    (data.repos[repo]?.days[day] ?? []).map(p => ({ ...p, repo })));

// Day rendered is pinned by report.ts (window.PR_DAY); under `npm run dev` we
// fall back to the most recent day with activity across all repos.
const latestActiveDay = () => {
  const days = [...new Set(knownRepos.flatMap(r => Object.keys(data.repos[r]?.days ?? {})))];
  return days.sort().reverse().find(d => entriesFor(d).length)
    ?? new Date().toISOString().slice(0, 10);
};

const selected = window.PR_DAY ?? latestActiveDay();

// --- Display config ----------------------------------------------------------

const BADGE: Record<string, string> = {
  merged: 'text-green-400 bg-green-400/10',
  open: 'text-sky-400 bg-sky-400/10',
  draft: 'text-zinc-400 bg-zinc-400/10',
  closed: 'text-red-400 bg-red-400/10',
  nopush: 'text-amber-400 bg-amber-400/10',
  push: 'text-amber-400 bg-amber-400/10',
  release: 'text-violet-400 bg-violet-400/10',
  rebase: 'text-zinc-400 bg-zinc-400/15',
};

const EVENTS: Record<EventType, { dot: string; emoji: string; labelKey: Key }> = {
  merge: { dot: 'bg-green-400', emoji: '✅', labelKey: 'event.merge' },
  open: { dot: 'bg-sky-400', emoji: '🆕', labelKey: 'event.open' },
  push: { dot: 'bg-amber-400', emoji: '🔧', labelKey: 'event.push' },
  rebase: { dot: 'bg-zinc-400', emoji: '🔄', labelKey: 'event.rebase' },
};

const BUCKETS: { key: Bucket; titleKey: Key; statKey: Key; dot: string; text: string }[] = [
  { key: 'merged', titleKey: 'section.merged', statKey: 'stats.merged', dot: 'bg-green-400', text: 'text-green-400' },
  { key: 'opened', titleKey: 'section.opened', statKey: 'stats.opened', dot: 'bg-sky-400', text: 'text-sky-400' },
  { key: 'fixup', titleKey: 'section.fixup', statKey: 'stats.fixup', dot: 'bg-amber-400', text: 'text-amber-400' },
  { key: 'touched', titleKey: 'section.touched', statKey: 'stats.touched', dot: 'bg-zinc-400', text: 'text-zinc-300' },
];

// --- Helpers -------------------------------------------------------------------

const DAY_START = 9 * 60, DAY_END = 19 * 60;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const pct = (hhmm: string) =>
  Math.min(100, Math.max(0, ((toMin(hhmm) - DAY_START) / (DAY_END - DAY_START)) * 100));

const fmtLong = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(locale(), { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtShort = (day: string) => { const [, m, d] = day.split('-'); return `${d}/${m}`; };

// --- Renderers -------------------------------------------------------------------

const badge = ([variant, key]: [string, string]) =>
  `<span class="whitespace-nowrap rounded-full px-3.5 py-1 text-[13px] font-semibold ${BADGE[variant] ?? BADGE.open}">${t(key as Key)}</span>`;

// Merge result in one pill: who merged (avatar + tooltip), the "merged" label and
// its target branch together. A merge onto a non-default branch is dimmed so it
// stands out (the repo's real default branch is recorded by the generator;
// fall back to master/main when it's missing, e.g. older data.js).
const mergedInto = (base: string, repo: string, by?: string) => {
  const def = data.repos[repo]?.defaultBranch;
  const master = def ? base === def : base === 'master' || base === 'main';
  const merger = by
    ? `<img src="https://github.com/${by}.png?size=32" alt="@${by}" title="${t('merged.by', { login: by })}"
        class="-ml-1 h-4 w-4 rounded-full ring-1 ring-green-400/40">`
    : '';
  return `<span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1 text-[13px] font-semibold text-green-400 bg-green-400/10">
    ${merger}${t('badge.merged')} <span class="font-mono ${master ? 'text-green-400' : 'text-green-200/70'}">→ ${base}</span></span>`;
};

// Repo, shown as a prominent card header (not a badge) when several repos are mixed.
// The org is dimmed so the repo name itself reads first.
const repoHeader = (repo: string) => {
  const i = repo.indexOf('/');
  const org = i >= 0 ? repo.slice(0, i + 1) : '';
  const name = i >= 0 ? repo.slice(i + 1) : repo;
  return `<div class="mb-2 font-mono text-sm font-semibold text-zinc-100"><span class="text-zinc-500">${org}</span>${name}</div>`;
};

// Author of the PR, shown under the time as a bare avatar with a tooltip.
// Amber ring when it's someone else's (the action is still ours), neutral when it's ours.
const authorAvatar = (login: string, mine: boolean) =>
  `<img src="https://github.com/${login}.png?size=48" alt="@${login}"
    title="${t('author.openedBy')} @${login}"
    class="h-7 w-7 rounded-full ring-2 ${mine ? 'ring-zinc-700' : 'ring-amber-400/70'}">`;

const badgesHtml = (p: Entry) => {
  const tail = (p.badges ?? []).map(badge).join('');
  return p.bucket === 'merged'
    ? mergedInto(p.base ?? '?', p.repo, p.mergedBy) + tail
    : tail;
};

const cardHtml = (p: Entry) => `
  <div class="mb-2.5 flex items-start gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 transition-colors hover:border-sky-400">
    <div class="flex flex-col items-center gap-2">
      <span class="whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[13px] tabular-nums text-zinc-400">${p.time}</span>
      ${p.author ? authorAvatar(p.author, !!p.mine) : ''}
    </div>
    <div class="min-w-0 flex-1">
      ${selectedRepos.size > 1 ? repoHeader(p.repo) : ''}
      ${badgesHtml(p) && `<div class="mb-2 flex flex-wrap items-center gap-1.5">${badgesHtml(p)}</div>`}
      <div class="flex flex-wrap items-baseline gap-2.5">
        <a href="https://github.com/${p.repo}/pull/${p.num}" target="_blank" class="text-sm font-semibold text-sky-400 hover:underline">#${p.num}</a>
        <span class="font-mono text-[13.5px]">${p.title}</span>
      </div>
      ${p.subject ? `<div class="subject mt-2 text-[13px] text-zinc-400">${p.subject}</div>` : ''}
    </div>
  </div>`;

function statsHtml(entries: Entry[]) {
  return `<div class="mb-9 grid grid-cols-2 gap-4 sm:grid-cols-4">${BUCKETS.map(b => `
    <div class="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
      <div class="text-3xl font-bold ${b.text}">${entries.filter(p => p.bucket === b.key).length}</div>
      <div class="mt-0.5 text-[13px] text-zinc-400">${t(b.statKey)}</div>
    </div>`).join('')}</div>`;
}

function timelineHtml(entries: Entry[]) {
  const ticks = Array.from({ length: 6 }, (_, i) => {
    const min = DAY_START + i * 120;
    const hhmm = `${String(min / 60).padStart(2, '0')}:00`;
    return `<div class="absolute top-[46px] -translate-x-1/2 text-[11px] tabular-nums text-zinc-500" style="left:${pct(hhmm)}%">${hhmm}</div>`;
  }).join('');

  let lastMin = -Infinity, staggered = false;
  const dots = entries
    .filter((p): p is Entry & { event: EventType } => p.event !== null)
    .sort((a, b) => toMin(a.time) - toMin(b.time))
    .map(p => {
      staggered = toMin(p.time) - lastMin < 15 ? !staggered : false;
      lastMin = toMin(p.time);
      const ev = EVENTS[p.event];
      return `
        <div class="group absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-zinc-950 ${ev.dot}"
             style="left:${pct(p.time)}%; top:${staggered ? 14 : 30}px">
          <span class="absolute bottom-[22px] left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs group-hover:block">
            ${ev.emoji} #${p.num} - ${p.short} (${p.time})${p.author ? ` · @${p.author}` : ''}</span>
        </div>`;
    }).join('');

  const legend = Object.values(EVENTS)
    .map(ev => `<span class="flex items-center gap-1.5"><i class="inline-block h-2.5 w-2.5 rounded-full ${ev.dot}"></i> ${t(ev.labelKey)}</span>`)
    .join('');

  return `
    <div class="mb-9 rounded-xl border border-zinc-800 bg-zinc-900 px-7 pb-4 pt-6">
      <h2 class="mb-5 text-[15px] font-semibold uppercase tracking-wider text-zinc-400">${t('timeline.title')}</h2>
      <div class="relative h-[70px]">
        <div class="absolute inset-x-0 top-[38px] h-0.5 bg-zinc-800"></div>
        ${ticks}${dots}
      </div>
      <div class="mt-7 flex gap-5 text-xs text-zinc-400">${legend}</div>
    </div>`;
}

function sectionsHtml(entries: Entry[]) {
  return BUCKETS.map(b => {
    const list = entries
      .filter(p => p.bucket === b.key)
      .sort((a, b2) => b2.time.localeCompare(a.time));
    if (!list.length) return '';
    return `
      <section class="mb-9">
        <h2 class="mb-3.5 flex items-center gap-2 text-[15px] font-semibold uppercase tracking-wider text-zinc-400">
          <span class="inline-block h-2.5 w-2.5 rounded-full ${b.dot}"></span> ${t(b.titleKey)} (${list.length})
        </h2>
        ${list.map(cardHtml).join('')}
      </section>`;
  }).join('');
}

function controlsHtml() {
  // Single repo: no point showing a filter.
  const boxes = knownRepos.length > 1 ? knownRepos.map(r => `
    <label class="repo-toggle inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-[13px] transition-colors
      ${selectedRepos.has(r)
        ? 'border-sky-400/60 bg-sky-400/10 text-sky-300 hover:bg-sky-400/20'
        : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}">
      <input type="checkbox" data-repo="${r}" ${selectedRepos.has(r) ? 'checked' : ''}
        class="h-3.5 w-3.5 cursor-pointer accent-sky-400">${r}
    </label>`).join('') : '';

  const langToggle = (['fr', 'en'] as const).map(l =>
    `<button data-lang="${l}" class="cursor-pointer rounded px-2 py-1 text-xs font-semibold uppercase transition-colors
      ${getLang() === l ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}">${l}</button>`).join('');

  return `
    <div class="mb-9 flex flex-wrap items-center gap-2">
      ${boxes}
      <div class="ml-auto flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">${langToggle}</div>
    </div>`;
}

// --- Page ---------------------------------------------------------------------

const app = document.getElementById('app')!;

function render() {
  const entries = entriesFor(selected);
  const repoLabel = [...selectedRepos].sort().join(' · ') || knownRepos.join(' · ');

  const body = entries.length
    ? statsHtml(entries) + timelineHtml(entries) + sectionsHtml(entries)
    : `<p class="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-8 text-center text-zinc-400">
        ${t('empty.noActivity', { date: fmtShort(selected) })}</p>`;

  document.documentElement.lang = getLang();
  document.title = `${t('app.title')} - ${fmtLong(selected)}`;
  app.innerHTML = `
    <header class="mb-8">
      <h1 class="text-[28px] font-semibold">${t('app.title')} - <span class="text-sky-400">${fmtLong(selected)}</span></h1>
      <p class="mt-1.5 text-sm text-zinc-400">${repoLabel} · ${t('app.tz')}</p>
    </header>
    ${controlsHtml()}
    ${body}
    <footer class="mt-10 text-xs text-zinc-500">
      ${data.generatedAt
        ? t('footer.generated', { date: new Date(data.generatedAt).toLocaleString(locale(), { timeZone: 'Europe/Paris' }) })
        : t('footer.none')}
    </footer>`;
}

// Listeners are delegated on the stable #app once, so re-rendering its innerHTML
// never re-attaches them (and never leaks the old ones).
function bindControls() {
  // Repo checkboxes: client-side display filter only (toggle visibility, no fetching).
  app.addEventListener('change', e => {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-repo]');
    if (!box) return;
    if (box.checked) selectedRepos.add(box.dataset.repo!);
    else selectedRepos.delete(box.dataset.repo!);
    render();
  });

  app.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-lang]');
    if (!btn) return;
    setLang(btn.dataset.lang as Lang);
    render();
  });
}

bindControls();
render();
