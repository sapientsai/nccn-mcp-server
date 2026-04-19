import { readFile, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { Option } from "functype"
import { Either, None, Some } from "functype"
import yaml from "js-yaml"

import type { CacheInfo, GuidelineIndex, PdfMeta } from "../types.js"
import { DEFAULT_CACHE_AGE_DAYS } from "../types.js"

const msPerDay = 86_400_000

export const checkCache = async (filePath: string, maxAgeDays: number = DEFAULT_CACHE_AGE_DAYS): Promise<CacheInfo> => {
  try {
    const stats = await stat(filePath)
    const ageDays = (Date.now() - stats.mtimeMs) / msPerDay
    return {
      ageDays,
      exists: true,
      filePath,
      isValid: ageDays < maxAgeDays && stats.size > 0,
      size: stats.size,
    }
  } catch {
    return { ageDays: Infinity, exists: false, filePath, isValid: false, size: 0 }
  }
}

export const readYamlIndex = async (filePath: string): Promise<Either<Error, GuidelineIndex>> => {
  try {
    const content = await readFile(filePath, "utf-8")
    const parsed = yaml.load(content) as GuidelineIndex
    if (!parsed?.nccn_guidelines) {
      return Either.left(new Error("Invalid YAML: missing nccn_guidelines key"))
    }
    return Either.right(parsed)
  } catch (error) {
    return Either.left(error instanceof Error ? error : new Error(String(error)))
  }
}

export const writeYamlIndex = async (filePath: string, index: GuidelineIndex): Promise<Either<Error, true>> => {
  try {
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dirname(filePath), { recursive: true })
    const content = yaml.dump(index, { lineWidth: -1, noRefs: true })
    await writeFile(filePath, content, "utf-8")
    return Either.right(true)
  } catch (error) {
    return Either.left(error instanceof Error ? error : new Error(String(error)))
  }
}

export const checkPdfCache = async (
  filePath: string,
  maxAgeDays: number = DEFAULT_CACHE_AGE_DAYS,
): Promise<Option<string>> => {
  const info = await checkCache(filePath, maxAgeDays)
  return info.isValid ? Some(filePath) : None<string>()
}

export const metaPath = (pdfPath: string): string => `${pdfPath}.meta.json`

export const readPdfMeta = async (pdfPath: string): Promise<Option<PdfMeta>> => {
  try {
    const content = await readFile(metaPath(pdfPath), "utf-8")
    return Some(JSON.parse(content) as PdfMeta)
  } catch {
    return None<PdfMeta>()
  }
}

export const writePdfMeta = async (pdfPath: string, meta: PdfMeta): Promise<Either<Error, true>> => {
  try {
    await writeFile(metaPath(pdfPath), JSON.stringify(meta, null, 2), "utf-8")
    return Either.right(true)
  } catch (error) {
    return Either.left(error instanceof Error ? error : new Error(String(error)))
  }
}
