import * as cheerio from "cheerio"
import { Either } from "functype"

import { checkCache, readYamlIndex, writeYamlIndex } from "../cache/cache.js"
import type { Category, Guideline, GuidelineIndex } from "../types.js"
import { DEFAULT_CACHE_AGE_DAYS, NCCN_BASE_URL, NCCN_CATEGORY_COUNT, USER_AGENT } from "../types.js"

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const fetchPage = async (url: string, retries: number = MAX_RETRIES): Promise<Either<Error, string>> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      })
      if (!response.ok) {
        if (attempt < retries - 1) {
          await delay(RETRY_DELAY_MS)
          continue
        }
        return Either.left(new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`))
      }
      return Either.right(await response.text())
    } catch (error) {
      if (attempt < retries - 1) {
        await delay(RETRY_DELAY_MS)
        continue
      }
      return Either.left(error instanceof Error ? error : new Error(String(error)))
    }
  }
  return Either.left(new Error(`Failed to fetch ${url} after ${retries} retries`))
}

const extractItemLinks = (html: string): ReadonlyArray<{ title: string; url: string }> => {
  const $ = cheerio.load(html)
  const items: Array<{ title: string; url: string }> = []

  $("div.item-name a").each((_, el) => {
    const title = $(el).text().trim()
    const href = $(el).attr("href")
    if (title && href) {
      const url = href.startsWith("http") ? href : `${NCCN_BASE_URL}${href}`
      items.push({ title, url })
    }
  })

  return items
}

const findGuidelineLink = (html: string): string | undefined => {
  const $ = cheerio.load(html)
  let guidelineUrl: string | undefined

  $("a").each((_, el) => {
    const text = $(el).text().toLowerCase()
    if (text.includes("nccn guidelines") || text.includes("nccn guideline")) {
      const href = $(el).attr("href")
      if (href) {
        guidelineUrl = href.startsWith("http") ? href : `${NCCN_BASE_URL}${href}`
        return false // break
      }
    }
  })

  return guidelineUrl
}

const processItem = async (item: { title: string; url: string }): Promise<Guideline | undefined> => {
  const pageResult = await fetchPage(item.url)
  return pageResult.fold(
    () => undefined,
    (html) => {
      const guidelineUrl = findGuidelineLink(html)
      return guidelineUrl ? { title: item.title, url: guidelineUrl } : undefined
    },
  )
}

const scrapeCategory = async (categoryNum: number): Promise<Category | undefined> => {
  const url = `${NCCN_BASE_URL}/guidelines/category_${categoryNum}`
  const pageResult = await fetchPage(url)

  if (pageResult.isLeft()) {
    console.error(`[scraper] Failed to fetch category ${categoryNum}: ${(pageResult.value as Error).message}`)
    return undefined
  }

  const html = pageResult.value as string
  const items = extractItemLinks(html)
  if (items.length === 0) return undefined

  const results = await Promise.allSettled(items.map(processItem))
  const guidelines = results
    .filter((r): r is PromiseFulfilledResult<Guideline | undefined> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((g): g is Guideline => g !== undefined)

  if (guidelines.length === 0) return undefined

  const $ = cheerio.load(html)
  const pageTitle = $("title").text().trim()
  const categoryName = pageTitle || `Category ${categoryNum}`

  return { category: categoryName, guidelines }
}

const scrapeAllCategories = async (): Promise<Either<Error, GuidelineIndex>> => {
  const categoryNums = Array.from({ length: NCCN_CATEGORY_COUNT }, (_, i) => i + 1)
  const results = await Promise.allSettled(categoryNums.map(scrapeCategory))

  const categories = results
    .filter((r): r is PromiseFulfilledResult<Category | undefined> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((c): c is Category => c !== undefined)

  if (categories.length === 0) {
    return Either.left(new Error("Failed to scrape any NCCN categories"))
  }

  const index: GuidelineIndex = { nccn_guidelines: categories }
  return Either.right(index)
}

export const ensureIndex = async (
  outputFile: string,
  maxAgeDays: number = DEFAULT_CACHE_AGE_DAYS,
): Promise<Either<Error, GuidelineIndex>> => {
  // Check cache first
  const cache = await checkCache(outputFile, maxAgeDays)
  if (cache.isValid) {
    console.error(`[scraper] Using cached index (${cache.ageDays.toFixed(1)} days old)`)
    return readYamlIndex(outputFile)
  }

  console.error("[scraper] Scraping NCCN guidelines index...")
  const indexResult = await scrapeAllCategories()

  if (indexResult.isLeft()) {
    const error = indexResult.value as Error
    if (cache.exists) {
      console.error(`[scraper] Scraping failed, falling back to stale cache: ${error.message}`)
      return readYamlIndex(outputFile)
    }
    return Either.left(error)
  }

  const index = indexResult.value as GuidelineIndex
  const writeResult = await writeYamlIndex(outputFile, index)
  if (writeResult.isLeft()) {
    console.error(`[scraper] Warning: failed to write cache: ${(writeResult.value as Error).message}`)
  } else {
    const totalGuidelines = index.nccn_guidelines.reduce((n, c) => n + c.guidelines.length, 0)
    console.error(`[scraper] Index cached with ${totalGuidelines} guidelines`)
  }
  return Either.right(index)
}

// Exported for testing
export { extractItemLinks, findGuidelineLink }
