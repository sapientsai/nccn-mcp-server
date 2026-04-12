export type Guideline = {
  readonly title: string
  readonly url: string
  readonly detailUrl?: string
  readonly version?: string
}

export type PdfMeta = {
  readonly version?: string
  readonly sourceUrl: string
  readonly detailUrl?: string
  readonly downloadedAt: string
  readonly lastCheckedAt: string
}

export type Category = {
  readonly category: string
  readonly guidelines: ReadonlyArray<Guideline>
}

export type GuidelineIndex = {
  readonly nccn_guidelines: ReadonlyArray<Category>
}

export type CacheInfo = {
  readonly ageDays: number
  readonly exists: boolean
  readonly filePath: string
  readonly isValid: boolean
  readonly size: number
}

export type PageContent = {
  readonly internalLinks: ReadonlyArray<{
    readonly sourcePage: number
    readonly target: string
    readonly targetPage: number | undefined
  }>
  readonly pageNumber: number
  readonly text: string
}

export type DownloadResult = {
  readonly filename: string
  readonly message?: string
  readonly success: boolean
}

export type DownloadOptions = {
  readonly downloadDir?: string
  readonly maxCacheAgeDays?: number
  readonly password?: string
  readonly skipIfExists?: boolean
  readonly username?: string
  readonly detailUrl?: string
  readonly forceRefresh?: boolean
}

export const DEFAULT_CACHE_AGE_DAYS = 7
export const DEFAULT_DOWNLOAD_DIR = "./downloads"
export const DEFAULT_INDEX_FILE = "nccn_guidelines_index.yaml"

// Minimum interval between live version-check fetches against NCCN's detail page,
// per guideline. Within this window we trust the cached PDF without any network call.
export const VERSION_CHECK_THROTTLE_HOURS = 6

// Hard re-download ceiling. Even if the version string is unchanged, re-fetch
// after this many days to catch silent revisions NCCN ships without bumping the version.
export const HARD_REFRESH_DAYS = 30

export const NCCN_BASE_URL = "https://www.nccn.org"
export const NCCN_CATEGORY_COUNT = 4

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
