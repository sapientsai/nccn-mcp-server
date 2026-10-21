import * as cheerio from "cheerio"
import { Either, None, Option } from "functype"

import { checkCache, readYamlIndex, writeYamlIndex } from "../cache/cache.js"
import { toError } from "../errors.js"
import type { Category, Guideline, GuidelineIndex } from "../types.js"
import { DEFAULT_CACHE_AGE_DAYS, NCCN_BASE_URL, NCCN_CATEGORY_COUNT, USER_AGENT } from "../types.js"

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const fetchText = async (url: string): Promise<Either<Error, string>> => {
  const responseResult = await Either.fromPromise(fetch(url, { headers: { "User-Agent": USER_AGENT } }), toError)
  if (responseResult.isLeft()) return Either.left<Error, string>(responseResult.value as Error)
  const response = responseResult.value as Response
  if (!response.ok) {
    return Either.left<Error, string>(new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`))
  }
  return Either.fromPromise(response.text(), toError)
}

const fetchPage = async (url: string, attemptsLeft: number = MAX_RETRIES): Promise<Either<Error, string>> => {
  const result = await fetchText(url)
  return result.foldAsync<Either<Error, string>>(
    async (err) => {
      if (attemptsLeft <= 1) return Either.left<Error, string>(err)
      await delay(RETRY_DELAY_MS)
      return fetchPage(url, attemptsLeft - 1)
    },
    (text) => Promise.resolve(Either.right<Error, string>(text)),
  )
}

const extractItemLinks = (html: string): ReadonlyArray<{ title: string; url: string }> => {
  const $ = cheerio.load(html)
  return $("div.item-name a")
    .toArray()
    .map((el) => ({ title: $(el).text().trim(), href: $(el).attr("href") ?? "" }))
    .filter(({ title, href }) => title.length > 0 && href.length > 0)
    .map(({ title, href }) => ({
      title,
      url: href.startsWith("http") ? href : `${NCCN_BASE_URL}${href}`,
    }))
}

const PDF_PATH_PATTERN = "/professionals/physician_gls/pdf/"
const VERSION_PATTERN = /Version\s+([\d.]+)/i

export type GuidelineInfo = {
  readonly pdfUrl: string
  readonly version?: string
}

const findGuidelineInfo = (html: string): Option<GuidelineInfo> => {
  const $ = cheerio.load(html)
  const match = $(`a[href*="${PDF_PATH_PATTERN}"]`)
    .toArray()
    .find((el) => {
      const href = $(el).attr("href")?.toLowerCase() ?? ""
      const text = $(el).text().trim().toLowerCase()
      return href.endsWith(".pdf") && text === "nccn guidelines"
    })
  return Option(match).map((el) => {
    const href = $(el).attr("href") ?? ""
    const pdfUrl = href.startsWith("http") ? href : `${NCCN_BASE_URL}${href}`
    const parentText = $(el).parent().text()
    const versionMatch = VERSION_PATTERN.exec(parentText)
    return { pdfUrl, version: versionMatch?.[1] }
  })
}

const findGuidelineLink = (html: string): Option<string> => findGuidelineInfo(html).map((info) => info.pdfUrl)

const processItem = async (item: { title: string; url: string }): Promise<Option<Guideline>> => {
  const pageResult = await fetchPage(item.url)
  return pageResult.fold(
    () => None<Guideline>(),
    (html) =>
      findGuidelineInfo(html).map((info) => ({
        title: item.title,
        url: info.pdfUrl,
        detailUrl: item.url,
        version: info.version,
      })),
  )
}

const scrapeCategory = async (categoryNum: number): Promise<Option<Category>> => {
  const url = `${NCCN_BASE_URL}/guidelines/category_${categoryNum}`
  const pageResult = await fetchPage(url)

  return pageResult.foldAsync<Option<Category>>(
    (err) => {
      console.error(`[scraper] Failed to fetch category ${categoryNum}: ${err.message}`)
      return Promise.resolve(None<Category>())
    },
    async (html) => {
      const items = extractItemLinks(html)
      if (items.length === 0) return None<Category>()

      const results = await Promise.allSettled(items.map(processItem))
      const guidelines = results
        .filter((r): r is PromiseFulfilledResult<Option<Guideline>> => r.status === "fulfilled")
        .flatMap((r) => r.value.toArray())

      if (guidelines.length === 0) return None<Category>()

      const $ = cheerio.load(html)
      const pageTitle = $("title").text().trim()
      const categoryName = pageTitle || `Category ${categoryNum}`
      return Option<Category>({ category: categoryName, guidelines })
    },
  )
}

const scrapeAllCategories = async (): Promise<Either<Error, GuidelineIndex>> => {
  const categoryNums = Array.from({ length: NCCN_CATEGORY_COUNT }, (_, i) => i + 1)
  const results = await Promise.allSettled(categoryNums.map(scrapeCategory))

  const categories = results
    .filter((r): r is PromiseFulfilledResult<Option<Category>> => r.status === "fulfilled")
    .flatMap((r) => r.value.toArray())

  return categories.length === 0
    ? Either.left<Error, GuidelineIndex>(new Error("Failed to scrape any NCCN categories"))
    : Either.right<Error, GuidelineIndex>({ nccn_guidelines: categories })
}

export const ensureIndex = async (
  outputFile: string,
  maxAgeDays: number = DEFAULT_CACHE_AGE_DAYS,
): Promise<Either<Error, GuidelineIndex>> => {
  const cache = await checkCache(outputFile, maxAgeDays)
  if (cache.isValid) {
    console.error(`[scraper] Using cached index (${cache.ageDays.toFixed(1)} days old)`)
    return readYamlIndex(outputFile)
  }

  console.error("[scraper] Scraping NCCN guidelines index...")
  const indexResult = await scrapeAllCategories()

  return indexResult.foldAsync<Either<Error, GuidelineIndex>>(
    async (err) => {
      if (cache.exists) {
        console.error(`[scraper] Scraping failed, falling back to stale cache: ${err.message}`)
        return readYamlIndex(outputFile)
      }
      return Either.left<Error, GuidelineIndex>(err)
    },
    async (index) => {
      const writeResult = await writeYamlIndex(outputFile, index)
      writeResult.fold(
        (err) => console.error(`[scraper] Warning: failed to write cache: ${err.message}`),
        () => {
          const totalGuidelines = index.nccn_guidelines.reduce((n, c) => n + c.guidelines.length, 0)
          console.error(`[scraper] Index cached with ${totalGuidelines} guidelines`)
        },
      )
      return Either.right<Error, GuidelineIndex>(index)
    },
  )
}

export { extractItemLinks, findGuidelineInfo, findGuidelineLink }
