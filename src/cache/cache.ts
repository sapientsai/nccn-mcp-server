import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { Option } from "functype"
import { Either, None, Some, Try } from "functype"
import yaml from "js-yaml"

import type { CacheInfo, GuidelineIndex, PdfMeta } from "../types.js"
import { DEFAULT_CACHE_AGE_DAYS } from "../types.js"

const msPerDay = 86_400_000

const toEither = async <T>(p: Promise<T>): Promise<Either<Error, T>> => {
  const attempt = await Try.fromPromise<T>(p)
  return attempt.fold<Either<Error, T>>(
    (err) => Either.left<Error, T>(err instanceof Error ? err : new Error(String(err))),
    (value) => Either.right<Error, T>(value),
  )
}

export const checkCache = async (filePath: string, maxAgeDays: number = DEFAULT_CACHE_AGE_DAYS): Promise<CacheInfo> => {
  const result = await toEither(stat(filePath))
  return result.fold<CacheInfo>(
    () => ({ ageDays: Infinity, exists: false, filePath, isValid: false, size: 0 }),
    (stats) => {
      const ageDays = (Date.now() - stats.mtimeMs) / msPerDay
      return {
        ageDays,
        exists: true,
        filePath,
        isValid: ageDays < maxAgeDays && stats.size > 0,
        size: stats.size,
      }
    },
  )
}

export const readYamlIndex = async (filePath: string): Promise<Either<Error, GuidelineIndex>> => {
  const contentResult = await toEither(readFile(filePath, "utf-8"))
  return contentResult.flatMap((content) => {
    const parsed = Try<GuidelineIndex | null | undefined>(() => yaml.load(content) as GuidelineIndex | null | undefined)
    return parsed.fold<Either<Error, GuidelineIndex>>(
      (err) => Either.left<Error, GuidelineIndex>(err instanceof Error ? err : new Error(String(err))),
      (value) =>
        !value?.nccn_guidelines
          ? Either.left<Error, GuidelineIndex>(new Error("Invalid YAML: missing nccn_guidelines key"))
          : Either.right<Error, GuidelineIndex>(value),
    )
  })
}

export const writeYamlIndex = async (filePath: string, index: GuidelineIndex): Promise<Either<Error, true>> => {
  const content = yaml.dump(index, { lineWidth: -1, noRefs: true })
  const dirResult = await toEither(mkdir(dirname(filePath), { recursive: true }))
  return dirResult.foldAsync<Either<Error, true>>(
    (err) => Promise.resolve(Either.left<Error, true>(err)),
    async () => {
      const writeResult = await toEither(writeFile(filePath, content, "utf-8"))
      return writeResult.map(() => true as const)
    },
  )
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
  const result = await toEither(readFile(metaPath(pdfPath), "utf-8"))
  return result.fold(
    () => None<PdfMeta>(),
    (content) => {
      const parsed = Try<PdfMeta>(() => JSON.parse(content) as PdfMeta)
      return parsed.toOption()
    },
  )
}

export const writePdfMeta = async (pdfPath: string, meta: PdfMeta): Promise<Either<Error, true>> => {
  const result = await toEither(writeFile(metaPath(pdfPath), JSON.stringify(meta, null, 2), "utf-8"))
  return result.map(() => true as const)
}
