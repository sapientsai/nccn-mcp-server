export type Guideline = {
  readonly title: string
  readonly url: string
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
}

export const DEFAULT_CACHE_AGE_DAYS = 7
export const DEFAULT_DOWNLOAD_DIR = "./downloads"
export const DEFAULT_INDEX_FILE = "nccn_guidelines_index.yaml"

export const NCCN_BASE_URL = "https://www.nccn.org"
export const NCCN_CATEGORY_COUNT = 4

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
