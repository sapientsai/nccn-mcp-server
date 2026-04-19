import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { Either, Try } from "functype"
import { PDFParse } from "pdf-parse"

import type { PageContent } from "../types.js"

const parseRange = (part: string, totalPages: number): Either<Error, ReadonlyArray<number>> => {
  const [startStr, endStr] = part.split("-")
  const start = parseInt(startStr, 10)
  const end = parseInt(endStr, 10)
  return isNaN(start) || isNaN(end)
    ? Either.left<Error, ReadonlyArray<number>>(new Error(`Invalid page range: ${part}`))
    : Either.right<Error, ReadonlyArray<number>>(
        Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i)
          .filter((n) => n >= 1 && n <= totalPages)
          .map((n) => n - 1),
      )
}

const parseSingle = (part: string, totalPages: number): Either<Error, ReadonlyArray<number>> => {
  const raw = parseInt(part, 10)
  if (isNaN(raw)) return Either.left(new Error(`Invalid page number: ${part}`))
  const pageNum = raw < 0 ? totalPages + raw + 1 : raw
  return Either.right(pageNum >= 1 && pageNum <= totalPages ? [pageNum - 1] : [])
}

const parseSegment = (part: string, totalPages: number): Either<Error, ReadonlyArray<number>> =>
  part.includes("-") && !part.startsWith("-") ? parseRange(part, totalPages) : parseSingle(part, totalPages)

/**
 * Parse page specification string into 0-based page indices.
 * Supports: "1", "1,3,5", "1-5", "1,3,5-7", "-1" (last page)
 */
export const parsePages = (pagesStr: string, totalPages: number): Either<Error, number[]> => {
  const parts = pagesStr.split(",").map((s) => s.trim())
  const collected = parts.reduce<Either<Error, ReadonlyArray<number>>>(
    (acc, part) => acc.flatMap((indices) => parseSegment(part, totalPages).map((more) => [...indices, ...more])),
    Either.right<Error, ReadonlyArray<number>>([]),
  )
  return collected.flatMap((indices) =>
    indices.length === 0
      ? Either.left<Error, number[]>(new Error(`No valid pages in range "${pagesStr}" (total pages: ${totalPages})`))
      : Either.right<Error, number[]>([...indices]),
  )
}

const withParser = async <T>(buffer: Buffer, fn: (parser: PDFParse) => Promise<T>): Promise<T> => {
  const parser = new PDFParse({ data: buffer })
  try {
    return await fn(parser)
  } finally {
    await parser.destroy()
  }
}

const toPageContent = (p: { num: number; text: string }): PageContent => ({
  internalLinks: [],
  pageNumber: p.num,
  text: p.text && p.text.trim().length > 0 ? p.text : `[Page ${p.num} - text extraction unavailable]`,
})

const extractPages = async (pdfPath: string, pages: string | undefined): Promise<PageContent[]> => {
  const buffer = await readFile(resolve(pdfPath))
  return withParser(buffer, async (parser) => {
    const info = await parser.getInfo()
    const totalPages = info.total
    const pageNumbers: number[] = pages
      ? parsePages(pages, totalPages)
          .map((idx) => idx.map((i) => i + 1))
          .orThrow()
      : Array.from({ length: totalPages }, (_, i) => i + 1)
    const result = await parser.getText({ partial: pageNumbers })
    return result.pages.map(toPageContent)
  })
}

/**
 * Extract text content from specific pages of a PDF file.
 */
export const extractContent = async (pdfPath: string, pages?: string): Promise<Either<Error, PageContent[]>> => {
  const attempt = await Try.fromPromise<PageContent[]>(extractPages(pdfPath, pages))
  return attempt.fold<Either<Error, PageContent[]>>(
    (err) => Either.left<Error, PageContent[]>(err instanceof Error ? err : new Error(String(err))),
    (contents) => Either.right<Error, PageContent[]>(contents),
  )
}

/**
 * Format extracted page contents into a readable string.
 */
export const formatContent = (pages: PageContent[]): string =>
  pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n")
