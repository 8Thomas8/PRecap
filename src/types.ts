export type Bucket = 'merged' | 'opened' | 'fixup' | 'touched';
export type EventType = 'merge' | 'open' | 'push' | 'rebase';

/** Accepted `owner/name` repo format, shared by the UI, server and CLI. */
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export interface PREntry {
  num: number;
  title: string;
  /** Short label for timeline tooltips (title without conventional-commit prefix). */
  short: string;
  tickets: string[];
  bucket: Bucket;
  /** Paris time HH:MM of the relevant event (merge, open, push, force-push, update). */
  time: string;
  /** Timeline event type; null = no dot on the timeline (e.g. touched without push). */
  event: EventType | null;
  /** PR author login (always set). */
  author?: string;
  /** True when the PR is ours - the rest is an action we did on someone else's. */
  mine?: boolean;
  /** Login of who clicked merge (merged bucket only). */
  mergedBy?: string;
  /** Target branch (merged bucket only). */
  base?: string;
  /** [badgeType, label] pairs (opened/fixup buckets). */
  badges?: [string, string][];
  /** Subject line HTML (Jira tickets parsed from the PR body). */
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
