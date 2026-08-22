/**
 * npm reads.
 *
 * The point of this module: the site must never hardcode a published version.
 * `data/packages.ts` carries a fallback for offline builds; the number a
 * visitor sees comes from the registry.
 */

const REGISTRY = "https://registry.npmjs.org";
const DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week";
const REVALIDATE = 3600;

export interface NpmVersion {
  version: string | null;
  publishedAt: string | null;
  stale: boolean;
}

export async function getLatestVersion(pkg: string): Promise<NpmVersion> {
  try {
    const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg)}/latest`, {
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return { version: null, publishedAt: null, stale: true };
    const json = (await res.json()) as Record<string, unknown>;
    return {
      version: typeof json.version === "string" ? json.version : null,
      publishedAt: null,
      stale: false,
    };
  } catch {
    return { version: null, publishedAt: null, stale: true };
  }
}

export interface WeeklyDownloads {
  pkg: string;
  downloads: number | null;
  stale: boolean;
}

export async function getWeeklyDownloads(pkg: string): Promise<WeeklyDownloads> {
  try {
    const res = await fetch(`${DOWNLOADS}/${encodeURIComponent(pkg)}`, {
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return { pkg, downloads: null, stale: true };
    const json = (await res.json()) as { downloads?: number };
    return { pkg, downloads: typeof json.downloads === "number" ? json.downloads : null, stale: false };
  } catch {
    return { pkg, downloads: null, stale: true };
  }
}

export async function getWeeklyDownloadsFor(pkgs: string[]): Promise<WeeklyDownloads[]> {
  return Promise.all(pkgs.map(getWeeklyDownloads));
}
