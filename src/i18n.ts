/**
 * Minimal i18n, no dependency. `lib.ts` emits semantic keys (e.g. badge labels,
 * PR state) into data.js; everything user-facing is translated here at render
 * time, so switching language never requires re-fetching.
 */
export type Lang = 'fr' | 'en';

// French is the reference: its keys define the contract. `en` below must cover
// exactly the same keys (enforced by the Record<Key, string> type).
const fr = {
  'app.title': 'PRecap',
  'app.tz': 'heures Europe/Paris',

  'stats.merged': 'PR mergées',
  'stats.opened': 'PR créées',
  'stats.fixup': 'PR existantes modifiées',
  'stats.touched': 'PR existantes sans code',

  'section.merged': 'Mergées',
  'section.opened': 'Nouvelles PR',
  'section.fixup': 'PR existantes — code poussé',
  'section.touched': 'PR existantes — sans modif de code',

  // Action performed on the PR that day, spelled out on each card: the point is
  // "new PR" vs "PR that already existed", which the state badge alone can't say.
  'action.created': 'nouvelle PR',
  'action.pushed': 'PR existante · code poussé',
  'action.rebased': 'PR existante · rebase sans nouveau code',
  'action.noCode': 'PR existante · sans code',

  // Age of a PR that already existed on the reported day.
  'age.yesterday': 'ouverte la veille',
  'age.days': 'ouverte {n} j plus tôt',
  'age.on': 'Ouverte le {date}',

  // Jira tickets listed under a PR, when the body links more than the card shows.
  'subject.more': '+ {n} autres tickets',

  'touched.show': 'Afficher les {n} PR touchées sans modif de code',
  'touched.hide': 'Masquer les PR touchées sans modif de code',

  'timeline.title': '⏱ Timeline de la journée',
  'event.merge': 'Merge',
  'event.open': 'Ouverture',
  'event.push': 'Push',
  'event.rebase': 'Rebase',

  'empty.noActivity': "Pas d'activité PR le {date}.",

  'footer.generated': 'Données générées le {date}',
  'footer.none': 'Aucune donnée générée',

  'author.openedBy': 'PR ouverte par',
  'merged.by': 'Mergée par @{login}',

  // Badge labels - keys stored in data.js by the generator.
  'badge.merged': 'merged',
  'badge.modifMerge': '+ code',
  'badge.rebaseMerge': 'rebase',
  'badge.rebaseEmpty': 'rebase sans contenu',
  'badge.release': 'release',
  'badge.state.open': 'open',
  'badge.state.draft': 'draft',
  'badge.state.closed': 'closed',
  'badge.state.merged': 'merged',
} as const;

export type Key = keyof typeof fr;

const en: Record<Key, string> = {
  'app.title': 'PRecap',
  'app.tz': 'Europe/Paris time',

  'stats.merged': 'Merged PRs',
  'stats.opened': 'Created PRs',
  'stats.fixup': 'Existing PRs updated',
  'stats.touched': 'Existing PRs, no code',

  'section.merged': 'Merged',
  'section.opened': 'New PRs',
  'section.fixup': 'Existing PRs — code pushed',
  'section.touched': 'Existing PRs — no code change',

  'action.created': 'new PR',
  'action.pushed': 'existing PR · code pushed',
  'action.rebased': 'existing PR · rebased, no new code',
  'action.noCode': 'existing PR · no code',

  'age.yesterday': 'opened the day before',
  'age.days': 'opened {n}d earlier',
  'age.on': 'Opened on {date}',

  'subject.more': '+ {n} more tickets',

  'touched.show': 'Show the {n} PRs touched without code change',
  'touched.hide': 'Hide PRs touched without code change',

  'timeline.title': '⏱ Day timeline',
  'event.merge': 'Merge',
  'event.open': 'Opened',
  'event.push': 'Push',
  'event.rebase': 'Rebase',

  'empty.noActivity': 'No PR activity on {date}.',

  'footer.generated': 'Data generated on {date}',
  'footer.none': 'No data generated',

  'author.openedBy': 'PR opened by',
  'merged.by': 'Merged by @{login}',

  'badge.merged': 'merged',
  'badge.modifMerge': '+ code',
  'badge.rebaseMerge': 'rebased',
  'badge.rebaseEmpty': 'rebase, no content',
  'badge.release': 'release',
  'badge.state.open': 'open',
  'badge.state.draft': 'draft',
  'badge.state.closed': 'closed',
  'badge.state.merged': 'merged',
};

const DICT: Record<Lang, Record<Key, string>> = { fr, en };

const LANG_KEY = 'precap:lang';
const browserLang = (): Lang => (navigator.language.startsWith('en') ? 'en' : 'fr');

// Baseline = the language the report was generated in (CLI --lang, pinned as
// window.PR_LANG), or the browser's under `npm run dev`. A stored value only
// exists when the viewer picked something else in the UI, and then wins.
const baseline = (): Lang => {
  const pinned = window.PR_LANG;
  return pinned === 'fr' || pinned === 'en' ? pinned : browserLang();
};

let lang: Lang = ((): Lang => {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === 'fr' || saved === 'en' ? saved : baseline();
})();

export const getLang = () => lang;
export const setLang = (l: Lang) => {
  lang = l;
  // Persist only an override that differs from the baseline; choosing the
  // baseline again clears it, so we keep following report/browser afterwards.
  if (l === baseline()) localStorage.removeItem(LANG_KEY);
  else localStorage.setItem(LANG_KEY, l);
};

/** BCP-47 locale for Intl date formatting. */
export const locale = () => (lang === 'en' ? 'en-GB' : 'fr-FR');

/** Translate a key, interpolating {placeholders} from `params`. */
export const t = (key: Key, params?: Record<string, string | number>): string => {
  let s: string = DICT[lang][key] ?? fr[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};
