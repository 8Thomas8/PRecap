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
  'stats.opened': 'PR ouvertes',
  'stats.fixup': 'Fixups',
  'stats.touched': 'Touchées sans push',

  'section.merged': 'Mergées',
  'section.opened': 'Ouvertes',
  'section.fixup': 'Fixups (push / rebase)',
  'section.touched': 'Touchées sans push',

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
  'stats.opened': 'Opened PRs',
  'stats.fixup': 'Fixups',
  'stats.touched': 'Touched, no push',

  'section.merged': 'Merged',
  'section.opened': 'Opened',
  'section.fixup': 'Fixups (push / rebase)',
  'section.touched': 'Touched, not pushed',

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
