import { describe, expect, it } from "vitest"

import { parsePages } from "../../src/reader/pdf-reader.js"

describe("parsePages", () => {
  it("parses single page number", () => {
    const result = parsePages("3", 10)
    expect(result.isRight()).toBe(true)
    result.map((pages) => expect(pages).toEqual([2])) // 0-based
  })

  it("parses comma-separated pages", () => {
    const result = parsePages("1,3,5", 10)
    result.map((pages) => expect(pages).toEqual([0, 2, 4]))
  })

  it("parses page range", () => {
    const result = parsePages("2-5", 10)
    result.map((pages) => expect(pages).toEqual([1, 2, 3, 4]))
  })

  it("parses mixed ranges and singles", () => {
    const result = parsePages("1,3,5-7", 10)
    result.map((pages) => expect(pages).toEqual([0, 2, 4, 5, 6]))
  })

  it("handles negative indexing for last page", () => {
    const result = parsePages("-1", 10)
    result.map((pages) => expect(pages).toEqual([9]))
  })

  it("handles negative indexing for second-to-last", () => {
    const result = parsePages("-2", 10)
    result.map((pages) => expect(pages).toEqual([8]))
  })

  it("clamps out-of-range pages", () => {
    const result = parsePages("15", 10)
    expect(result.isLeft()).toBe(true) // no valid pages
  })

  it("returns error for invalid input", () => {
    const result = parsePages("abc", 10)
    expect(result.isLeft()).toBe(true)
  })
})
