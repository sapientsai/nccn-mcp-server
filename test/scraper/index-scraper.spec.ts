import { describe, expect, it } from "vitest"

import { extractItemLinks, findGuidelineLink } from "../../src/scraper/index-scraper.js"

describe("extractItemLinks", () => {
  it("extracts links from item-name divs", () => {
    const html = `
      <div class="item-name"><a href="/guidelines/breast">Breast Cancer</a></div>
      <div class="item-name"><a href="/guidelines/lung">Lung Cancer</a></div>
    `
    const links = extractItemLinks(html)
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({ title: "Breast Cancer", url: "https://www.nccn.org/guidelines/breast" })
    expect(links[1]).toEqual({ title: "Lung Cancer", url: "https://www.nccn.org/guidelines/lung" })
  })

  it("handles absolute URLs", () => {
    const html = `<div class="item-name"><a href="https://example.com/test">Test</a></div>`
    const links = extractItemLinks(html)
    expect(links[0]?.url).toBe("https://example.com/test")
  })

  it("returns empty array for no matches", () => {
    const html = `<div class="other">No items here</div>`
    const links = extractItemLinks(html)
    expect(links).toHaveLength(0)
  })
})

describe("findGuidelineLink", () => {
  it("finds NCCN guidelines link", () => {
    const html = `
      <a href="/some/other">Other Link</a>
      <a href="/guidelines/pdf/breast.pdf">View NCCN Guidelines</a>
    `
    const url = findGuidelineLink(html)
    expect(url).toBe("https://www.nccn.org/guidelines/pdf/breast.pdf")
  })

  it("returns undefined when no guideline link found", () => {
    const html = `<a href="/about">About Us</a>`
    const url = findGuidelineLink(html)
    expect(url).toBeUndefined()
  })
})
