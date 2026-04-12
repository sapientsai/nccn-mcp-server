import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { checkCache, readYamlIndex, writeYamlIndex } from "../../src/cache/cache.js"
import type { GuidelineIndex } from "../../src/types.js"

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-cache")
const TEST_YAML = join(TEST_DIR, "test-index.yaml")

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
})

afterAll(async () => {
  await rm(TEST_DIR, { force: true, recursive: true })
})

describe("checkCache", () => {
  it("reports non-existent file as invalid", async () => {
    const info = await checkCache(join(TEST_DIR, "nonexistent.yaml"))
    expect(info.exists).toBe(false)
    expect(info.isValid).toBe(false)
  })

  it("reports fresh file as valid", async () => {
    await writeFile(TEST_YAML, "test content", "utf-8")
    const info = await checkCache(TEST_YAML, 7)
    expect(info.exists).toBe(true)
    expect(info.isValid).toBe(true)
    expect(info.ageDays).toBeLessThan(1)
  })
})

describe("readYamlIndex / writeYamlIndex", () => {
  it("round-trips a guideline index", async () => {
    const index: GuidelineIndex = {
      nccn_guidelines: [
        {
          category: "Test Category",
          guidelines: [{ title: "Test Guideline", url: "https://example.com/test.pdf" }],
        },
      ],
    }

    const writeResult = await writeYamlIndex(TEST_YAML, index)
    expect(writeResult.isRight()).toBe(true)

    const readResult = await readYamlIndex(TEST_YAML)
    expect(readResult.isRight()).toBe(true)
    readResult.map((loaded) => {
      expect(loaded.nccn_guidelines).toHaveLength(1)
      expect(loaded.nccn_guidelines[0]?.category).toBe("Test Category")
    })
  })

  it("returns Left for invalid YAML", async () => {
    await writeFile(TEST_YAML, "not: valid: yaml: [", "utf-8")
    const result = await readYamlIndex(TEST_YAML)
    expect(result.isLeft()).toBe(true)
  })
})
