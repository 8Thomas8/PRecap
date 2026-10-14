export type Bucket = 'merged' | 'opened' | 'fixup' | 'touched';
export type EventType = 'merge' | 'open' | 'push' | 'rebase';

export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export interface Subject {
  key: string;
  label: string;
  depth?: number;
}

export interface PREntry {
  num: number;
  title: string;
  short: string;
  bucket: Bucket;
  time: string;
  event: EventType | null;
  author?: string;
  mine?: boolean;
  createdDay?: string;
  mergedBy?: string;
  base?: string;
  head?: string;
  badges?: [string, string][];
  description?: string;
  subjects?: Subject[];
  subject?: string;
}

export interface RepoData {
  days: Record<string, PREntry[]>;
  defaultBranch?: string;
}

export interface PRData {
  generatedAt: string;
  repos: Record<string, RepoData>;
}

declare global {
  interface Window {
    PR_DATA: PRData;
    PR_DAY?: string;
    PR_REPOS?: string[];
    PR_LANG?: 'fr' | 'en';
  }
}
