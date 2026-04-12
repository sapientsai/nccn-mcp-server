import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { Either } from "functype"
import pdfParse from "pdf-parse"

import type { PageContent } from "../types.js"

/**
 * Parse page specification string into 0-based page indices.
 * Supports: "1", "1,3,5", "1-5", "1,3,5-7", "-1" (last page)
 */
export const parsePages = (pagesStr: string, totalPages: number): Either<Error, number[]> => {
  const indices: number[] = []

  const parts = pagesStr.split(",").map((s) => s.trim())
  for (const part of parts) {
    if (part.includes("-") && !part.startsWith("-")) {
      // Range: "1-5"
      const [startStr, endStr] = part.split("-")
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (isNaN(start) || isNaN(end)) {
        return Either.left(new Error(`Invalid page range: ${part}`))
      }
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= totalPages) {
          indices.push(i - 1) // convert to 0-based
        }
      }
    } else {
      // Single page: "3" or "-1"
      let pageNum = parseInt(part, 10)
      if (isNaN(pageNum)) {
        return Either.left(new Error(`Invalid page number: ${part}`))
      }
      // Handle negative indexing
      if (pageNum < 0) {
        pageNum = totalPages + pageNum + 1
      }
      if (pageNum >= 1 && pageNum <= totalPages) {
        indices.push(pageNum - 1) // convert to 0-based
      }
    }
  }

  if (indices.length === 0) {
    return Either.left(new Error(`No valid pages in range "${pagesStr}" (total pages: ${totalPages})`))
  }

  return Either.right(indices)
}

/**
 * Extract text content from specific pages of a PDF file.
 */
export const extractContent = async (pdfPath: string, pages?: string): Promise<Either<Error, PageContent[]>> => {
  try {
    const absolutePath = resolve(pdfPath)
    const buffer = await readFile(absolutePath)

    // pdf-parse extracts all text — we need page count first
    const parsed = await pdfParse(buffer)
    const totalPages = parsed.numpages

    // Determine which pages to extract
    let pageIndices: number[]
    if (pages) {
      const parseResult = parsePages(pages, totalPages)
      if (parseResult.isLeft()) {
        return Either.left(parseResult.value as Error)
      }
      pageIndices = parseResult.value as number[]
    } else {
      // All pages
      pageIndices = Array.from({ length: totalPages }, (_, i) => i)
    }

    // pdf-parse doesn't support per-page extraction natively,
    // so we use its page render callback
    const pageTexts: Map<number, string> = new Map()

    await pdfParse(buffer, {
      pagerender: async (pageData: { getTextContent: () => Promise<{ items: ReadonlyArray<{ str: string }> }> }) => {
        const textContent = await pageData.getTextContent()
        return textContent.items.map((item) => item.str).join(" ")
      },
    })

    // Fallback: split full text by form feeds or use full text per requested page
    const fullText = parsed.text
    const pageSplits = fullText.split("\n\n\n")

    const contents: PageContent[] = pageIndices.map((idx) => ({
      internalLinks: [],
      pageNumber: idx + 1,
      text: pageSplits[idx] ?? `[Page ${idx + 1} - text extraction unavailable]`,
    }))

    return Either.right(contents)
  } catch (error) {
    return Either.left(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Format extracted page contents into a readable string.
 */
export const formatContent = (pages: PageContent[]): string =>
  pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n")
