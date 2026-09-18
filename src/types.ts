export type Bucket = 'merged' | 'opened' | 'fixup' | 'touched';
export type EventType = 'merge' | 'open' | 'push' | 'rebase';

/** Accepted `owner/name` repo format, shared by the UI, server and CLI. */
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** A Jira ticket linked by a PR: its key and its summary (already HTML-escaped,
 *  like every other string the generator bakes into the report). */
export interface Subject {
  key: string;
  /** Jira summary, empty when the key only came from the branch name. */
  label: string;
  /** Nesting level read from the body's markdown indentation: 0 = flush left
   *  (a US, or a standalone ticket), 1+ = listed under the line above. Absent
   *  on days captured before nesting was tracked - the UI reads it as 0. */
  depth?: number;
}

export interface PREntry {
  num: number;
  title: string;
  /** Short label for timeline tooltips (title without conventional-commit prefix). */
  short: string;
  bucket: Bucket;
  /** Paris time HH:MM of the relevant event (merge, open, push, force-push, update). */
  time: string;
  /** Timeline event type; null = no dot on the timeline (e.g. touched without push). */
  event: EventType | null;
  /** PR author login (always set). */
  author?: string;
  /** True when the PR is ours - the rest is an action we did on someone else's. */
  mine?: boolean;
  /** Paris day the PR was created (YYYY-MM-DD). Absent on days captured before
   *  this field existed - the UI degrades by hiding the age. */
  createdDay?: string;
  /** Login of who clicked merge (merged bucket only). */
  mergedBy?: string;
  /** Target branch (merged bucket only). */
  base?: string;
  /** Source branch of the PR (headRefName), shown next to the repo name. */
  head?: string;
  /** [badgeType, label] pairs (opened/fixup buckets). */
  badges?: [string, string][];
  /** Jira tickets of the PR, one subject line each (parsed from the body). */
  subjects?: Subject[];
  /** Single subject line as HTML - days captured before `subjects` existed; the
   *  UI renders it as-is, without the branch-duplicate pill stripping. */
  subject?: string;
}

export interface RepoData {
  days: Record<string, PREntry[]>;
  /** Repo's default branch; a merge onto another base is flagged in the UI. */
  defaultBranch?: string;
}

export interface PRData {
  generatedAt: string;
  repos: Record<string, RepoData>;
}

declare global {
  interface Window {
    PR_DATA: PRData;
    /** Day the report was generated for; pins the rendered day (set by report.ts). */
    PR_DAY?: string;
    /** Repos this report is about; pins which repos the UI renders (set by report.ts). */
    PR_REPOS?: string[];
    /** Language the report was generated in (CLI --lang); baseline for the UI (set by report.ts). */
    PR_LANG?: 'fr' | 'en';
  }
}
