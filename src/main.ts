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

// A PR we only got a comment / label / review on isn't our activity: `updatedAt`
// moves when *anyone* touches the PR, so an old PR resurfaces in the recap
// without us having done anything. Collapsed by default, one click away.
let showTouched = false;
const NOISE: Bucket = 'touched';

const REBASES_KEY = 'precap:showRebases';
let showRebases = localStorage.getItem(REBASES_KEY) === '1';

const collapsed = new Set<Bucket>();

// --- Display config ----------------------------------------------------------

const PILL = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';

const BADGE: Record<string, string> = {
  merged: 'text-green-400 bg-green-400/10',
  open: 'text-sky-400 bg-sky-400/10',
  draft: 'text-neutral-400 bg-neutral-400/10',
  closed: 'text-red-400 bg-red-400/10',
  nopush: 'text-amber-400 bg-amber-400/10',
  push: 'text-amber-400 bg-amber-400/10',
  release: 'text-violet-400 bg-violet-400/10',
  rebase: 'text-neutral-400 bg-neutral-400/15',
};

const EVENTS: Record<EventType, { dot: string; labelKey: Key }> = {
  merge: { dot: 'bg-green-400', labelKey: 'event.merge' },
  open: { dot: 'bg-sky-400', labelKey: 'event.open' },
  push: { dot: 'bg-amber-400', labelKey: 'event.push' },
  rebase: { dot: 'bg-neutral-400', labelKey: 'event.rebase' },
};

const BUCKETS: { key: Bucket; titleKey: Key; statKey: Key; text: string; accent: string; edge: string }[] = [
  { key: 'merged', titleKey: 'section.merged', statKey: 'stats.merged', text: 'text-green-400', accent: 'bg-green-400', edge: 'border-l-green-400' },
  { key: 'opened', titleKey: 'section.opened', statKey: 'stats.opened', text: 'text-sky-400', accent: 'bg-sky-400', edge: 'border-l-sky-400' },
  { key: 'fixup', titleKey: 'section.fixup', statKey: 'stats.fixup', text: 'text-amber-400', accent: 'bg-amber-400', edge: 'border-l-amber-400' },
  { key: 'touched', titleKey: 'section.touched', statKey: 'stats.touched', text: 'text-neutral-300', accent: 'bg-neutral-600', edge: 'border-l-neutral-600' },
];
const bucketOf = (key: Bucket) => BUCKETS.find(b => b.key === key)!;

// --- Helpers -------------------------------------------------------------------

const DAY_START = 9 * 60, DAY_END = 19 * 60;
const HOURS = (DAY_END - DAY_START) / 60;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const pct = (hhmm: string) =>
  Math.min(100, Math.max(0, ((toMin(hhmm) - DAY_START) / (DAY_END - DAY_START)) * 100));

const fmtLong = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (day: string) => { const [, m, d] = day.split('-'); return `${d}/${m}`; };
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);

// --- Renderers -------------------------------------------------------------------

const badge = ([variant, key]: [string, string]) =>
  `<span class="${PILL} ${BADGE[variant] ?? BADGE.open}">${t(key as Key)}</span>`;

// Merge result in one pill: who merged (avatar + tooltip), the "merged" label and
// its target branch together. A merge onto a non-default branch is dimmed so it
// stands out (the repo's real default branch is recorded by the generator;
// fall back to master/main when it's missing, e.g. older data.js).
const mergedInto = (base: string, repo: string, by?: string) => {
  const def = data.repos[repo]?.defaultBranch;
  const master = def ? base === def : base === 'master' || base === 'main';
  const merger = by
    ? `<img src="https://github.com/${by}.png?size=32" alt="@${by}" title="${t('merged.by', { login: by })}"
        onerror="this.remove()" class="relative z-10 -ml-1 h-4 w-4 rounded-full ring-1 ring-green-400/40">`
    : '';
  return `<span class="${PILL} text-green-400 bg-green-400/10 ring-1 ring-inset ring-green-400/20">
    ${merger}${t('badge.merged')} <span class="font-mono ${master ? 'text-green-400' : 'text-green-200/70'}">→ ${base}</span></span>`;
};

// GitHub's git-branch octicon, sized to sit on the card header line.
const branchIcon =
  `<svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 fill-current opacity-70" aria-hidden="true"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"></path></svg>`;

// Card header: the repo (org dimmed, only when several repos are mixed) and the
// PR's source branch next to it. Whichever part is absent is simply skipped, and
// an empty header renders nothing - the merged bucket passes no branch, as it is
// deleted on merge and the "merged -> base" pill already names one.
const cardHeader = (repo: string, head?: string) => {
  const i = repo.indexOf('/');
  const org = i >= 0 ? repo.slice(0, i + 1) : '';
  const name = i >= 0 ? repo.slice(i + 1) : repo;
  const repoEl = selectedRepos.size > 1
    ? `<span class="text-neutral-300"><span class="text-neutral-500">${org}</span>${name}</span>`
    : '';
  const branchEl = head
    ? `<span class="relative z-10 inline-flex min-w-0 max-w-full items-center gap-1 text-violet-300/80" title="${head}">${branchIcon}<span class="truncate">${head}</span></span>`
    : '';
  return repoEl || branchEl
    ? `<div class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs">${repoEl}${branchEl}</div>`
    : '';
};

// Author of the PR, shown under the time as a bare avatar with a tooltip.
// Amber ring when it's someone else's (the action is still ours), neutral when it's ours.
const authorAvatar = (login: string, mine: boolean) =>
  `<span title="${t('author.openedBy')} @${login}"
    class="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-neutral-800 text-[11px] font-semibold uppercase text-neutral-400 ring-2 ${mine ? 'ring-neutral-700' : 'ring-amber-400/70'}">
    <span aria-hidden="true" class="col-start-1 row-start-1">${login[0]}</span>
    <span class="sr-only">@${login}</span>
    <img src="https://github.com/${login}.png?size=48" alt="" onerror="this.remove()" class="col-start-1 row-start-1 h-6 w-6">
  </span>`;

const actionPill = (p: Entry) => p.event === 'rebase'
  ? `<span class="${PILL} text-neutral-300 bg-neutral-400/10 ring-1 ring-inset ring-neutral-400/20">${t('action.rebased')}</span>`
  : '';

const agePill = (p: Entry) => {
  // Absent on days captured before `createdDay` existed; same-day PRs are listed
  // under "new PRs", so only an older one gets aged here.
  if (!p.createdDay || p.createdDay >= selected) return '';
  const n = daysBetween(p.createdDay, selected);
  const label = n === 1 ? t('age.yesterday') : t('age.days', { n });
  return `<span title="${t('age.on', { date: fmtShort(p.createdDay) })}"
    class="relative z-10 whitespace-nowrap px-1 first:pl-0 text-xs text-neutral-400">${label}</span>`;
};

const badgesHtml = (p: Entry) => {
  // Outside the merged bucket the action pill already states the rebase, so the
  // generator's own rebase badge would only repeat it.
  const tail = (p.badges ?? [])
    .filter(([variant]) => p.bucket === 'merged' || (variant !== 'rebase' && variant !== 'open'))
    .map(badge).join('');
  return p.bucket === 'merged'
    ? mergedInto(p.base ?? '?', p.repo, p.mergedBy) + agePill(p) + tail
    : actionPill(p) + agePill(p) + tail;
};

// A PR body often links the parent US *and* its sub-tasks; all of them get a
// line. Past this many the card would drown the rest of its content (release PRs
// list a whole sprint), so the tail is collapsed into a count.
const MAX_SUBJECTS = 2;

// Indent per nesting level, as literal classes so Tailwind's scanner sees them.
// Deeper than this reads as noise on a card, so it flattens.
const SUBJECT_PAD = ['', 'pl-5', 'pl-9'];

// One line per Jira ticket, each led by its key - with several of them the pill
// is what tells the lines apart, so it stays even when the branch above repeats
// it. Only a summary-less line adds nothing over that branch, and it goes (this
// is the `feature/KEY-…` fallback, a bare key we already show). A ticket with
// sub-tasks under it is the day's context rather than its work, so it steps back
// and they get the contrast. Days captured before `subjects` existed carry a
// single pre-rendered HTML line.
const subjectHtml = (p: Entry, head?: string) => {
  if (!p.subjects) return p.subject
    ? `<div class="subject mt-2.5 text-[13px] text-neutral-400">${p.subject}</div>`
    : '';

  const kept = p.subjects.filter(s => s.label || !head?.includes(s.key));
  if (!kept.length) return '';

  // Parenthood is resolved over the whole list, before the cap trims it, so a
  // US whose tasks fall past the cut is still rendered as a US.
  const lines = kept.map((s, i) => {
    const depth = s.depth ?? 0;
    const isParent = (kept[i + 1]?.depth ?? 0) > depth;
    const cls = `${SUBJECT_PAD[Math.min(depth, SUBJECT_PAD.length - 1)]}${isParent ? ' text-neutral-500' : ''}`;
    return `<div class="${cls}"><span class="ticket">${s.key}</span>${s.label}</div>`;
  });

  const shown = lines.slice(0, MAX_SUBJECTS);
  if (lines.length > MAX_SUBJECTS)
    shown.push(`<div class="text-neutral-500">${t('subject.more', { n: lines.length - MAX_SUBJECTS })}</div>`);
  return `<div class="subject mt-2.5 space-y-1 border-t border-neutral-800 pt-2.5 text-[13px] text-neutral-400">${shown.join('')}</div>`;
};

const cardHtml = (p: Entry) => {
  // The branch the card shows, resolved once: the merged bucket deliberately has
  // none, and the subject needs to know what the header already stated.
  const head = p.bucket === 'merged' ? undefined : p.head;
  const badges = badgesHtml(p);
  return `
  <div class="group relative flex items-start gap-3 rounded-lg border border-l-2 border-neutral-800 ${bucketOf(p.bucket).edge} bg-neutral-900/50 shadow-sm shadow-black/40 px-4 py-3 transition-colors hover:border-y-neutral-700 hover:border-r-neutral-700 hover:bg-neutral-900 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-green-400/60">
    ${p.author ? `<span class="relative z-10 shrink-0">${authorAvatar(p.author, !!p.mine)}</span>` : ''}
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-x-2">
        <a href="https://github.com/${p.repo}/pull/${p.num}" target="_blank" aria-label="#${p.num} ${p.title}" class="text-sm font-medium tabular-nums text-neutral-400 after:absolute after:inset-0 focus-visible:outline-none group-hover:text-green-400">#${p.num}</a>
        <span class="pr-title min-w-0 flex-1 truncate text-[15px] font-medium text-neutral-100">${p.title}</span>
        <span aria-hidden="true" class="title-tip absolute bottom-full left-3 w-max max-w-[calc(100%-1.5rem)] z-20 mb-2 rounded-md bg-neutral-100 px-2.5 py-1.5 text-[13px] font-medium text-neutral-900 shadow-xl shadow-black/60 after:absolute after:left-12 after:top-full after:border-[5px] after:border-transparent after:border-t-neutral-100">${p.title}</span>
        <span class="shrink-0 text-xs tabular-nums text-neutral-400">${p.time}</span>
      </div>
      ${cardHeader(p.repo, head)}
      ${badges && `<div class="mt-2 flex flex-wrap items-center gap-1.5">${badges}</div>`}
      ${subjectHtml(p, head)}
    </div>
  </div>`;
};

function statsHtml(entries: Entry[]) {
  return `<div class="mb-4 grid divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900/50 shadow-sm shadow-black/40 sm:grid-cols-3 sm:divide-x sm:divide-y-0">${BUCKETS.filter(b => b.key !== NOISE).map(b => `
    <div class="flex items-baseline gap-2.5 px-5 py-3">
      <span class="text-2xl font-semibold tabular-nums tracking-tight ${b.text}">${entries.filter(p => p.bucket === b.key).length}</span>
      <span class="text-[13px] text-neutral-400">${t(b.statKey)}</span>
    </div>`).join('')}</div>`;
}

function timelineHtml(entries: Entry[]) {
  const ticks = Array.from({ length: HOURS + 1 }, (_, i) => {
    const hhmm = `${String(DAY_START / 60 + i).padStart(2, '0')}:00`;
    return `
      <div class="absolute inset-y-0 w-px bg-neutral-800/70" style="left:${pct(hhmm)}%"></div>
      ${i % 2 ? '' : `<div class="absolute top-full mt-1.5 -translate-x-1/2 text-[11px] tabular-nums text-neutral-500" style="left:${pct(hhmm)}%">${hhmm}</div>`}`;
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
        <div class="group absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-neutral-950 transition-transform hover:scale-125 motion-reduce:transition-none ${ev.dot}"
             style="left:${pct(p.time)}%; top:${staggered ? 20 : 50}%">
          <span class="tooltip absolute bottom-5 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 shadow-lg shadow-black/50 group-hover:block">
            <i class="mr-1 inline-block h-2 w-2 rounded-full ${ev.dot}"></i>#${p.num} - ${p.short} (${p.time})${p.author ? ` · @${p.author}` : ''}</span>
        </div>`;
    }).join('');

  const legend = Object.values(EVENTS)
    .map(ev => `<span class="flex items-center gap-1.5"><i class="inline-block h-2 w-2 rounded-full ${ev.dot}"></i> ${t(ev.labelKey)}</span>`)
    .join('');

  return `
    <div class="mb-10 rounded-lg border border-neutral-800 bg-neutral-900/50 shadow-sm shadow-black/40 px-6 pb-8 pt-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-neutral-400">${t('timeline.title')}</h2>
        <div class="flex gap-4 text-xs text-neutral-400">${legend}</div>
      </div>
      <div class="relative h-12">
        <div class="absolute inset-x-0 top-1/2 h-px bg-neutral-700"></div>
        ${ticks}${dots}
      </div>
    </div>`;
}

function sectionsHtml(entries: Entry[]) {
  return BUCKETS.filter(b => b.key !== NOISE || showTouched).map(b => {
    const all = entries.filter(p => p.bucket === b.key);
    const rebases = b.key === 'fixup' ? all.filter(p => p.event === 'rebase').length : 0;
    const list = all
      .filter(p => showRebases || b.key !== 'fixup' || p.event !== 'rebase')
      .sort((a, b2) => b2.time.localeCompare(a.time));
    if (!all.length) return '';
    // The body clips only while folded or folding: unfolded, the title tooltips
    // must be free to overflow above the first row of cards.
    const folded = collapsed.has(b.key);
    return `
      <section class="mb-10 data-collapsed:mb-6" ${folded ? 'data-collapsed' : ''}>
        <div class="mb-3 flex items-center gap-4">
          <h2 class="min-w-0 flex-1">
            <button data-toggle-section="${b.key}" aria-expanded="${!folded}"
              class="flex w-full cursor-pointer items-center gap-2 rounded text-xs font-semibold uppercase tracking-wider ${b.text} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60">
              <i class="h-1.5 w-1.5 rounded-full ${b.accent}"></i>${t(b.titleKey)}
              <span class="rounded-full bg-neutral-800 px-1.5 py-px tabular-nums text-neutral-400">${list.length}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true" class="h-4 w-4 fill-current text-neutral-500 transition-transform duration-200 in-data-collapsed:-rotate-90 motion-reduce:transition-none"><path d="M12.78 5.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 1.06-1.06L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 0Z"></path></svg>
            </button>
          </h2>
          ${rebases ? `<button data-toggle-rebases role="switch" aria-checked="${showRebases}"
            class="inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded text-xs text-neutral-400 transition-colors hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60">
            ${t('rebases.toggle', { n: rebases })}
            <span class="relative h-4 w-7 shrink-0 rounded-full transition-colors ${showRebases ? 'bg-green-400' : 'bg-neutral-700'}">
              <span class="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${showRebases ? 'translate-x-3' : ''}"></span>
            </span></button>` : ''}
        </div>
        <div class="grid grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out in-data-collapsed:grid-rows-[0fr]">
          <div data-section-body class="min-h-0 ${folded ? 'overflow-hidden' : ''}" ${folded ? 'inert' : ''}>
            <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">${list.map(cardHtml).join('')}</div>
          </div>
        </div>
      </section>`;
  }).join('');
}

function touchedToggleHtml(entries: Entry[]) {
  const n = entries.filter(p => p.bucket === NOISE).length;
  if (!n) return '';
  return `<button data-toggle-touched
    class="mb-10 cursor-pointer rounded text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60 text-neutral-500 underline decoration-dotted underline-offset-4 transition-colors hover:text-neutral-300">
    ${showTouched ? t('touched.hide') : t('touched.show', { n })}</button>`;
}

function controlsHtml() {
  // Single repo: no point showing a filter.
  const boxes = knownRepos.length > 1 ? knownRepos.map(r => `
    <label class="repo-toggle inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs transition-colors
      ${selectedRepos.has(r)
        ? 'border-green-400/40 bg-green-400/10 text-green-300 hover:bg-green-400/15'
        : 'border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'}">
      <input type="checkbox" data-repo="${r}" ${selectedRepos.has(r) ? 'checked' : ''}
        class="h-3.5 w-3.5 cursor-pointer accent-green-400">${r}
    </label>`).join('') : '';

  const langToggle = (['fr', 'en'] as const).map(l =>
    `<button data-lang="${l}" aria-pressed="${getLang() === l}" class="cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60
      ${getLang() === l ? 'bg-neutral-800 text-white shadow-sm shadow-black/50' : 'text-neutral-500 hover:text-neutral-200'}">${l}</button>`).join('');

  return {
    lang: `<div role="group" aria-label="${t('app.lang')}" class="flex shrink-0 items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1 shadow-sm shadow-black/40">${langToggle}</div>`,
    repos: boxes && `<div class="mb-6 flex flex-wrap items-center gap-2">${boxes}</div>`,
  };
}

// --- Page ---------------------------------------------------------------------

const app = document.getElementById('app')!;

function render() {
  const entries = entriesFor(selected);
  const repoLabel = [...selectedRepos].sort().join(' · ') || knownRepos.join(' · ');

  const body = entries.some(p => p.bucket !== NOISE)
    ? statsHtml(entries) + timelineHtml(entries) + sectionsHtml(entries) + touchedToggleHtml(entries)
    : `<p class="mb-5 rounded-lg border border-neutral-800 bg-neutral-900/50 shadow-sm shadow-black/40 px-5 py-10 text-center text-neutral-400">
        ${t('empty.noActivity', { date: fmtShort(selected) })}</p>
       ${touchedToggleHtml(entries)}${showTouched ? sectionsHtml(entries) : ''}`;

  document.documentElement.lang = getLang();
  document.title = `${t('app.title')} — ${fmtLong(selected)}`;
  const controls = controlsHtml();
  app.innerHTML = `
    <header class="mb-8 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-green-400"><span class="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_8px] shadow-green-400"></span>${t('app.title')}</div>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight first-letter:uppercase">${fmtLong(selected)}</h1>
        <p class="mt-1.5 text-sm text-neutral-400">${repoLabel} · ${t('app.tz')}</p>
      </div>
      ${controls.lang}
    </header>
    ${controls.repos}
    ${body}
    <footer class="mt-12 border-t border-neutral-800 pt-5 text-xs text-neutral-400">
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

  const markClipped = (e: Event) => {
    const title = (e.target as HTMLElement).closest('.group')?.querySelector<HTMLElement>('.pr-title');
    title?.toggleAttribute('data-clipped', title.scrollWidth > title.clientWidth);
  };
  app.addEventListener('mouseover', markClipped);
  app.addEventListener('focusin', markClipped);

  app.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const fold = target.closest<HTMLElement>('[data-toggle-section]');
    if (fold) {
      const key = fold.dataset.toggleSection as Bucket;
      const section = fold.closest('section')!;
      const body = section.querySelector<HTMLElement>('[data-section-body]')!;
      const wrap = body.parentElement!;
      if (collapsed.delete(key))
        wrap.ontransitionend = e => { if (e.target === wrap && !collapsed.has(key)) body.classList.remove('overflow-hidden'); };
      else {
        collapsed.add(key);
        body.classList.add('overflow-hidden');
      }
      body.inert = collapsed.has(key);
      section.toggleAttribute('data-collapsed', collapsed.has(key));
      fold.setAttribute('aria-expanded', String(!collapsed.has(key)));
      return;
    }
    if (target.closest('[data-toggle-touched]')) {
      showTouched = !showTouched;
      return render();
    }
    if (target.closest('[data-toggle-rebases]')) {
      showRebases = !showRebases;
      if (showRebases) localStorage.setItem(REBASES_KEY, '1');
      else localStorage.removeItem(REBASES_KEY);
      return render();
    }
    const btn = target.closest<HTMLButtonElement>('[data-lang]');
    if (!btn) return;
    setLang(btn.dataset.lang as Lang);
    render();
  });
}

bindControls();
render();
