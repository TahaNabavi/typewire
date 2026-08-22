import { site } from "@/config/site";

/**
 * GitHub reads for the "live from the repo" band.
 *
 * Every function here returns a `{ data, stale }` pair rather than throwing:
 * the design calls for the dashboard to degrade to last-known values with a
 * `cached` chip, never to a broken grid. `stale: true` is what renders that
 * chip. Set GITHUB_TOKEN in the environment to lift the 60 req/hour
 * unauthenticated rate limit during builds.
 */

const API = "https://api.github.com";
const REPO = `${site.repo.owner}/${site.repo.name}`;

/** Revalidate hourly — repo stats are interesting, not urgent. */
const REVALIDATE = 3600;

export interface Fetched<T> {
  data: T;
  stale: boolean;
}

async function gh<T>(path: string, fallback: T, revalidate = REVALIDATE): Promise<Fetched<T>> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // A 202 is GitHub saying "computing, ask again" — caching that for an hour
      // would pin an empty chart in place long after the data exists, so the
      // caller gets to shorten the window for endpoints that answer 202.
      next: { revalidate: res202Window(path, revalidate) },
    });
    if (res.status === 202) return { data: fallback, stale: true };
    if (!res.ok) return { data: fallback, stale: true };
    return { data: (await res.json()) as T, stale: false };
  } catch {
    return { data: fallback, stale: true };
  }
}

/** The stats endpoints are the only ones that answer 202; they retry sooner. */
function res202Window(path: string, revalidate: number): number {
  return path.includes("/stats/") ? Math.min(revalidate, 60) : revalidate;
}

export interface RepoStats {
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  pushedAt: string | null;
}

const REPO_FALLBACK: RepoStats = {
  stars: 0,
  forks: 0,
  watchers: 0,
  openIssues: 0,
  pushedAt: null,
};

export async function getRepoStats(): Promise<Fetched<RepoStats>> {
  const raw = await gh<Record<string, unknown>>(`/repos/${REPO}`, {});
  if (raw.stale) return { data: REPO_FALLBACK, stale: true };
  const r = raw.data;
  return {
    data: {
      stars: Number(r.stargazers_count ?? 0),
      forks: Number(r.forks_count ?? 0),
      watchers: Number(r.subscribers_count ?? 0),
      openIssues: Number(r.open_issues_count ?? 0),
      pushedAt: typeof r.pushed_at === "string" ? r.pushed_at : null,
    },
    stale: false,
  };
}

export interface Release {
  tag: string;
  name: string;
  publishedAt: string | null;
  url: string;
  body: string;
}

export async function getLatestRelease(): Promise<Fetched<Release | null>> {
  const raw = await gh<Record<string, unknown>>(`/repos/${REPO}/releases/latest`, {});
  if (raw.stale || !raw.data.tag_name) return { data: null, stale: true };
  const r = raw.data;
  return {
    data: {
      tag: String(r.tag_name),
      name: String(r.name ?? r.tag_name),
      publishedAt: typeof r.published_at === "string" ? r.published_at : null,
      url: String(r.html_url ?? site.repo.url),
      body: String(r.body ?? ""),
    },
    stale: false,
  };
}

export interface Contributor {
  login: string;
  avatar: string;
  url: string;
  contributions: number;
}

export async function getContributors(): Promise<Fetched<Contributor[]>> {
  const raw = await gh<Array<Record<string, unknown>>>(
    `/repos/${REPO}/contributors?per_page=24`,
    [],
  );
  if (raw.stale || !Array.isArray(raw.data)) return { data: [], stale: true };
  return {
    data: raw.data.map((c) => ({
      login: String(c.login ?? ""),
      avatar: String(c.avatar_url ?? ""),
      url: String(c.html_url ?? ""),
      contributions: Number(c.contributions ?? 0),
    })),
    stale: false,
  };
}

export interface Issue {
  number: number;
  title: string;
  url: string;
  labels: string[];
}

/** Powers the "good first issues" list in the Collaborate section. */
export async function getGoodFirstIssues(limit = 4): Promise<Fetched<Issue[]>> {
  const raw = await gh<Array<Record<string, unknown>>>(
    `/repos/${REPO}/issues?state=open&labels=good%20first%20issue&per_page=${limit}`,
    [],
  );
  if (raw.stale || !Array.isArray(raw.data)) return { data: [], stale: true };
  return {
    data: raw.data.map((i) => ({
      number: Number(i.number ?? 0),
      title: String(i.title ?? ""),
      url: String(i.html_url ?? ""),
      labels: Array.isArray(i.labels)
        ? i.labels.map((l) => String((l as Record<string, unknown>).name ?? ""))
        : [],
    })),
    stale: false,
  };
}

export interface WorkflowRun {
  conclusion: string | null;
  status: string | null;
  branch: string;
  url: string;
  updatedAt: string | null;
}

/** The CI card: the cross-package integrity gate, as it last ran. */
export async function getLatestCiRun(): Promise<Fetched<WorkflowRun | null>> {
  const raw = await gh<Record<string, unknown>>(
    `/repos/${REPO}/actions/workflows/ci.yml/runs?per_page=1`,
    {},
  );
  const runs = raw.data.workflow_runs;
  if (raw.stale || !Array.isArray(runs) || runs.length === 0) return { data: null, stale: true };
  const run = runs[0] as Record<string, unknown>;
  return {
    data: {
      conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
      status: typeof run.status === "string" ? run.status : null,
      branch: String(run.head_branch ?? site.repo.branch),
      url: String(run.html_url ?? site.repo.url),
      updatedAt: typeof run.updated_at === "string" ? run.updated_at : null,
    },
    stale: false,
  };
}

export interface CommitWeek {
  /** Unix seconds for the Sunday that starts the week. */
  week: number;
  /** Commits per day, Sunday first. */
  days: number[];
  total: number;
}

/**
 * 52 weeks of commit counts — the sparkline and the heatmap read the same array.
 *
 * This endpoint is computed asynchronously by GitHub: the first request after a
 * cache eviction answers 202 with an empty body while the statistics are built.
 * That is not an error and not stale data, it is "ask again in a moment", so it
 * degrades to an empty series and the card renders its own empty state.
 */
export async function getCommitActivity(): Promise<Fetched<CommitWeek[]>> {
  const raw = await gh<Array<Record<string, unknown>>>(`/repos/${REPO}/stats/commit_activity`, []);
  if (raw.stale || !Array.isArray(raw.data) || raw.data.length === 0) {
    return { data: [], stale: raw.stale };
  }
  return {
    data: raw.data.map((w) => ({
      week: Number(w.week ?? 0),
      days: Array.isArray(w.days) ? w.days.map(Number) : new Array(7).fill(0),
      total: Number(w.total ?? 0),
    })),
    stale: false,
  };
}

export interface RunResult {
  conclusion: string | null;
  url: string;
  sha: string;
  updatedAt: string | null;
}

/**
 * The last N runs of the integrity gate, newest first — drawn as a dot field so
 * the shape of the recent history is legible at a glance rather than as one
 * green tick that says nothing about the week before.
 */
export async function getRecentCiRuns(limit = 30): Promise<Fetched<RunResult[]>> {
  const raw = await gh<Record<string, unknown>>(
    `/repos/${REPO}/actions/workflows/ci.yml/runs?per_page=${limit}`,
    {},
  );
  const runs = raw.data.workflow_runs;
  if (raw.stale || !Array.isArray(runs)) return { data: [], stale: true };
  return {
    data: (runs as Array<Record<string, unknown>>).map((run) => ({
      conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
      url: String(run.html_url ?? site.repo.url),
      sha: String(run.head_sha ?? "").slice(0, 7),
      updatedAt: typeof run.updated_at === "string" ? run.updated_at : null,
    })),
    stale: false,
  };
}
