/**
 * Fetches GitHub releases for a repository.
 * Used for the profile menu "What's new" changelog and for update notifications.
 */

const GITHUB_RELEASES_API = 'https://api.github.com/repos/alexwohlbruck/parchment/releases'

export interface GitHubRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string
  prerelease: boolean
}

export interface GitHubReleaseSummary {
  tagName: string
  title: string
  body: string | null
  url: string
  publishedAt: string
}

function toSummary(release: GitHubRelease): GitHubReleaseSummary {
  return {
    tagName: release.tag_name,
    title: release.name || release.tag_name,
    body: release.body,
    url: release.html_url,
    publishedAt: release.published_at,
  }
}

/**
 * Fetch the latest stable release from GitHub.
 * Returns null on network error or if no releases.
 */
export async function fetchLatestRelease(): Promise<GitHubReleaseSummary | null> {
  try {
    const res = await fetch(`${GITHUB_RELEASES_API}/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as GitHubRelease
    return toSummary(data)
  } catch {
    return null
  }
}

/**
 * Fetch recent releases (for changelog list).
 * Excludes prereleases by default.
 */
export async function fetchReleases(options?: {
  perPage?: number
  includePrerelease?: boolean
}): Promise<GitHubReleaseSummary[]> {
  try {
    const params = new URLSearchParams({
      per_page: String(options?.perPage ?? 10),
    })
    const res = await fetch(`${GITHUB_RELEASES_API}?${params}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as GitHubRelease[]
    const list = (options?.includePrerelease ? data : data.filter(r => !r.prerelease))
      .slice(0, options?.perPage ?? 10)
    return list.map(toSummary)
  } catch {
    return []
  }
}
