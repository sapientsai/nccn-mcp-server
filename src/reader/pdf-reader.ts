import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { Either } from "functype"
import { PDFParse } from "pdf-parse"

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
  let parser: PDFParse | undefined
  try {
    const absolutePath = resolve(pdfPath)
    const buffer = await readFile(absolutePath)
    parser = new PDFParse({ data: buffer })

    const info = await parser.getInfo()
    const totalPages = info.total

    let pageNumbers: number[] // 1-based for pdf-parse v2
    if (pages) {
      const parseResult = parsePages(pages, totalPages)
      if (parseResult.isLeft()) {
        return Either.left(parseResult.value as Error)
      }
      pageNumbers = (parseResult.value as number[]).map((i) => i + 1)
    } else {
      pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    }

    const result = await parser.getText({ partial: pageNumbers })

    const contents: PageContent[] = result.pages.map((p) => ({
      internalLinks: [],
      pageNumber: p.num,
      text: p.text && p.text.trim().length > 0 ? p.text : `[Page ${p.num} - text extraction unavailable]`,
    }))

    return Either.right(contents)
  } catch (error) {
    return Either.left(error instanceof Error ? error : new Error(String(error)))
  } finally {
    await parser?.destroy()
  }
}

/**
 * Format extracted page contents into a readable string.
 */
export const formatContent = (pages: PageContent[]): string =>
  pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n")
