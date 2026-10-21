import type { Stats } from "node:fs"
import { mkdir, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { Either, None, Option, Some, Try } from "functype"

import { readPdfMeta, writePdfMeta } from "../cache/cache.js"
import { toError } from "../errors.js"
import type { DownloadOptions, DownloadResult, PdfMeta } from "../types.js"
import {
  DEFAULT_DOWNLOAD_DIR,
  HARD_REFRESH_DAYS,
  NCCN_BASE_URL,
  USER_AGENT,
  VERSION_CHECK_THROTTLE_HOURS,
} from "../types.js"

const LOGIN_URL = `${NCCN_BASE_URL}/login/Index/`
const VERSION_PATTERN = /Version\s+([\d.]+)/i
const msPerHour = 3_600_000
const msPerDay = 86_400_000

const statOption = async (filePath: string): Promise<Option<Stats>> => {
  const attempt = await Try.fromPromise<Stats>(stat(filePath))
  return attempt.fold<Option<Stats>>(
    () => None<Stats>(),
    (s) => Some(s),
  )
}

const fetchCurrentVersion = async (detailUrl: string): Promise<Option<string>> => {
  const attempt = await Try.fromPromise<Option<string>>(
    (async (): Promise<Option<string>> => {
      const response = await fetch(detailUrl, { headers: defaultHeaders(), redirect: "follow" })
      if (!response.ok) return None<string>()
      const html = await response.text()
      return Option(html.match(VERSION_PATTERN)?.[1])
    })(),
  )
  return attempt.fold<Option<string>>(
    () => None<string>(),
    (v) => v,
  )
}

const defaultHeaders = (): Record<string, string> => ({
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "User-Agent": USER_AGENT,
})

const extractFilename = (url: string): string => {
  const parsed = new URL(url)
  return basename(parsed.pathname) || "guideline.pdf"
}

const isLoginPage = (html: string): boolean =>
  html.toLowerCase().includes("login") || html.toLowerCase().includes("sign in")

const submitLogin = async (username: string, password: string, targetUrl: string): Promise<Either<Error, string[]>> => {
  // First, access the target URL to get redirected to login
  const initialResponse = await fetch(targetUrl, {
    headers: defaultHeaders(),
    redirect: "manual",
  })

  // Get cookies from the initial response
  const cookies: string[] = []
  const setCookies = initialResponse.headers.getSetCookie()
  cookies.push(...setCookies.map((c) => c.split(";")[0]))

  // Now POST to login
  const formData = new URLSearchParams({
    Password: password,
    ReturnUrl: new URL(targetUrl).pathname,
    UserName: username,
  })

  const loginResponse = await fetch(LOGIN_URL, {
    body: formData.toString(),
    headers: {
      ...defaultHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies.join("; "),
    },
    method: "POST",
    redirect: "manual",
  })

  const loginCookies = loginResponse.headers.getSetCookie()
  cookies.push(...loginCookies.map((c) => c.split(";")[0]))

  // Check if login was successful (usually a redirect)
  if (loginResponse.status >= 300 && loginResponse.status < 400) {
    return Either.right(cookies)
  }

  // Check response body for error indicators
  const body = await loginResponse.text()
  if (body.includes("Invalid") || body.includes("incorrect")) {
    return Either.left(new Error("Login failed: invalid credentials"))
  }

  return Either.right(cookies)
}

const login = async (username: string, password: string, targetUrl: string): Promise<Either<Error, string[]>> => {
  const attempt = await Either.fromPromise(submitLogin(username, password, targetUrl), toError)
  return attempt.flatMap((result) => result)
}

/**
 * Decide whether to re-use the cached PDF or re-download.
 *
 * Logic:
 *   - No cached PDF         → download
 *   - forceRefresh          → download
 *   - Older than HARD_REFRESH_DAYS → download (catches silent revisions)
 *   - Within VERSION_CHECK_THROTTLE_HOURS → trust cache, no network call
 *   - Otherwise             → fetch detail page, compare version; match=keep, mismatch=download
 */
type Decision = {
  readonly action: "use-cache" | "download"
  readonly reason: string
  readonly currentVersion: Option<string>
}

const decideAction = async (filePath: string, detailUrl: Option<string>, forceRefresh: boolean): Promise<Decision> => {
  if (forceRefresh) return { action: "download", reason: "force_refresh requested", currentVersion: None() }

  const statsOpt = await statOption(filePath)
  const { fileExists, fileAgeDays } = statsOpt.fold(
    () => ({ fileExists: false, fileAgeDays: Infinity }),
    (s) => ({ fileExists: s.size > 0, fileAgeDays: (Date.now() - s.mtimeMs) / msPerDay }),
  )

  if (!fileExists) return { action: "download", reason: "no cached file", currentVersion: None() }
  if (fileAgeDays >= HARD_REFRESH_DAYS) {
    return {
      action: "download",
      reason: `cached file older than ${HARD_REFRESH_DAYS}d hard ceiling`,
      currentVersion: None(),
    }
  }

  const meta = await readPdfMeta(filePath)
  if (!meta.isSome()) {
    // Have a PDF but no metadata — treat as fresh enough (likely pre-feature download)
    // and let the throttle kick in on next call.
    return { action: "use-cache", reason: "no metadata (legacy cache entry)", currentVersion: None() }
  }

  const metaValue = meta.value as PdfMeta
  const hoursSinceCheck = (Date.now() - Date.parse(metaValue.lastCheckedAt)) / msPerHour
  if (hoursSinceCheck < VERSION_CHECK_THROTTLE_HOURS) {
    return {
      action: "use-cache",
      reason: `within ${VERSION_CHECK_THROTTLE_HOURS}h version-check throttle`,
      currentVersion: None(),
    }
  }

  if (detailUrl.isNone()) {
    // No detail URL available — we can't check live version. Trust cache until hard ceiling.
    return { action: "use-cache", reason: "no detailUrl to check live version", currentVersion: None() }
  }

  const currentVersion = await fetchCurrentVersion(detailUrl.value as string)
  return currentVersion.fold<Decision>(
    // Detail page fetch failed — trust cache rather than forcing re-download on network hiccup.
    () => ({ action: "use-cache", reason: "live version check failed, trusting cache", currentVersion }),
    (version) =>
      metaValue.version === version
        ? { action: "use-cache", reason: `version unchanged (${version})`, currentVersion }
        : {
            action: "download",
            reason: `version changed: cached=${metaValue.version ?? "unknown"} current=${version}`,
            currentVersion,
          },
  )
}

export const downloadPdf = async (
  url: string,
  options: DownloadOptions = {},
): Promise<Either<Error, DownloadResult>> => {
  const downloadDir = options.downloadDir ?? DEFAULT_DOWNLOAD_DIR
  const skipIfExists = options.skipIfExists ?? true
  const username = options.username ?? process.env.NCCN_USERNAME
  const password = options.password ?? process.env.NCCN_PASSWORD
  const detailUrl = options.detailUrl ?? None<string>()
  const forceRefresh = options.forceRefresh ?? false

  const filename = extractFilename(url)
  const filePath = join(downloadDir, filename)

  if (skipIfExists) {
    const decision = await decideAction(filePath, detailUrl, forceRefresh)
    if (decision.action === "use-cache") {
      // Refresh lastCheckedAt if we just did a live check (regardless of outcome).
      if (decision.currentVersion.isSome()) {
        const existingMeta = await readPdfMeta(filePath)
        const nowIso = new Date().toISOString()
        const updated: PdfMeta = existingMeta.fold(
          () => ({
            detailUrl: detailUrl.orUndefined(),
            downloadedAt: nowIso,
            lastCheckedAt: nowIso,
            sourceUrl: url,
            version: decision.currentVersion.orUndefined(),
          }),
          (value) => ({ ...value, lastCheckedAt: nowIso, version: decision.currentVersion.orUndefined() }),
        )
        await writePdfMeta(filePath, updated)
      }
      const result: DownloadResult = {
        filename: filePath,
        message: `Using cached PDF (${decision.reason})`,
        success: true,
      }
      return Either.right(result)
    }
  }

  const saveMeta = async (): Promise<void> => {
    const liveVersion = await detailUrl.fold(() => Promise.resolve(None<string>()), fetchCurrentVersion)
    const nowIso = new Date().toISOString()
    const meta: PdfMeta = {
      detailUrl: detailUrl.orUndefined(),
      downloadedAt: nowIso,
      lastCheckedAt: nowIso,
      sourceUrl: url,
      version: liveVersion.orUndefined(),
    }
    await writePdfMeta(filePath, meta)
  }

  const fetchPdf = async (): Promise<Either<Error, DownloadResult>> => {
    await mkdir(downloadDir, { recursive: true })

    // Initial request
    const response = await fetch(url, { headers: defaultHeaders() })
    const contentType = response.headers.get("content-type") ?? ""

    // Check if we got a PDF
    if (contentType.includes("application/pdf")) {
      const buffer = Buffer.from(await response.arrayBuffer())
      await writeFile(filePath, buffer)
      await saveMeta()
      const result: DownloadResult = { filename: filePath, message: "Downloaded successfully", success: true }
      return Either.right(result)
    }

    // Got HTML — probably a login page
    const html = await response.text()
    if (isLoginPage(html) && username && password) {
      console.error("[downloader] Login required, attempting authentication...")
      const loginResult = await login(username, password, url)

      if (loginResult.isLeft()) {
        return Either.left(new Error(`Login failed: ${(loginResult.value as Error).message}`))
      }

      const cookies = loginResult.value as string[]
      const authResponse = await fetch(url, {
        headers: { ...defaultHeaders(), Cookie: cookies.join("; ") },
      })

      const authContentType = authResponse.headers.get("content-type") ?? ""
      if (!authContentType.includes("application/pdf")) {
        return Either.left(new Error("Failed to download PDF after login — unexpected content type"))
      }

      const buffer = Buffer.from(await authResponse.arrayBuffer())
      await writeFile(filePath, buffer)
      await saveMeta()
      const result: DownloadResult = { filename: filePath, message: "Downloaded after login", success: true }
      return Either.right(result)
    }

    if (!username || !password) {
      return Either.left(new Error("Login required but NCCN_USERNAME/NCCN_PASSWORD not set"))
    }

    return Either.left(new Error(`Unexpected response: content-type=${contentType}`))
  }

  const attempt = await Either.fromPromise(fetchPdf(), toError)
  return attempt.flatMap((result) => result)
}
