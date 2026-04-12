import { describe, expect, it } from "vitest"

import { extractItemLinks, findGuidelineInfo, findGuidelineLink } from "../../src/scraper/index-scraper.js"

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
  it("finds the main English clinician PDF", () => {
    const html = `
      <a href="/guidelines/nccn-guidelines-navigator">NCCN Guidelines Navigator</a>
      <a href="/professionals/physician_gls/pdf/breast.pdf">NCCN Guidelines</a>
      <a href="/professionals/physician_gls/pdf/breast-arabic.pdf">Arabic</a>
    `
    const url = findGuidelineLink(html)
    expect(url).toBe("https://www.nccn.org/professionals/physician_gls/pdf/breast.pdf")
  })

  it("ignores the navbar navigator link", () => {
    const html = `
      <a href="/guidelines/nccn-guidelines-navigator">NCCN Guidelines</a>
      <a href="/professionals/physician_gls/pdf/lung.pdf">NCCN Guidelines</a>
    `
    const url = findGuidelineLink(html)
    expect(url).toBe("https://www.nccn.org/professionals/physician_gls/pdf/lung.pdf")
  })

  it("returns undefined when no PDF link found", () => {
    const html = `<a href="/about">About Us</a>`
    const url = findGuidelineLink(html)
    expect(url).toBeUndefined()
  })
})

describe("findGuidelineInfo", () => {
  it("extracts PDF url and version from sibling span", () => {
    const html = `
      <p>
        <a href="/professionals/physician_gls/pdf/breast.pdf">NCCN Guidelines</a>
        <span> Version 2.2026</span>
      </p>
    `
    const info = findGuidelineInfo(html)
    expect(info?.pdfUrl).toBe("https://www.nccn.org/professionals/physician_gls/pdf/breast.pdf")
    expect(info?.version).toBe("2.2026")
  })

  it("returns pdfUrl but undefined version when version span is missing", () => {
    const html = `<a href="/professionals/physician_gls/pdf/foo.pdf">NCCN Guidelines</a>`
    const info = findGuidelineInfo(html)
    expect(info?.pdfUrl).toBe("https://www.nccn.org/professionals/physician_gls/pdf/foo.pdf")
    expect(info?.version).toBeUndefined()
  })
})
