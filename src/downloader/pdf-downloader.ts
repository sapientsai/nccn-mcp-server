import { mkdir, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { Either } from "functype"

import { readPdfMeta, writePdfMeta } from "../cache/cache.js"
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

const fetchCurrentVersion = async (detailUrl: string): Promise<string | undefined> => {
  try {
    const response = await fetch(detailUrl, { headers: defaultHeaders(), redirect: "follow" })
    if (!response.ok) return undefined
    const html = await response.text()
    const match = html.match(VERSION_PATTERN)
    return match?.[1]
  } catch {
    return undefined
  }
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

const login = async (username: string, password: string, targetUrl: string): Promise<Either<Error, string[]>> => {
  try {
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
  } catch (error) {
    return Either.left(error instanceof Error ? error : new Error(String(error)))
  }
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
const decideAction = async (
  filePath: string,
  detailUrl: string | undefined,
  forceRefresh: boolean,
): Promise<{ action: "use-cache" | "download"; reason: string; currentVersion?: string }> => {
  if (forceRefresh) return { action: "download", reason: "force_refresh requested" }

  let fileExists = false
  let fileAgeDays = Infinity
  try {
    const stats = await stat(filePath)
    fileExists = stats.size > 0
    fileAgeDays = (Date.now() - stats.mtimeMs) / msPerDay
  } catch {
    // missing file
  }

  if (!fileExists) return { action: "download", reason: "no cached file" }
  if (fileAgeDays >= HARD_REFRESH_DAYS) {
    return { action: "download", reason: `cached file older than ${HARD_REFRESH_DAYS}d hard ceiling` }
  }

  const meta = await readPdfMeta(filePath)
  if (!meta.isSome()) {
    // Have a PDF but no metadata — treat as fresh enough (likely pre-feature download)
    // and let the throttle kick in on next call.
    return { action: "use-cache", reason: "no metadata (legacy cache entry)" }
  }

  const metaValue = meta.value as PdfMeta
  const hoursSinceCheck = (Date.now() - Date.parse(metaValue.lastCheckedAt)) / msPerHour
  if (hoursSinceCheck < VERSION_CHECK_THROTTLE_HOURS) {
    return { action: "use-cache", reason: `within ${VERSION_CHECK_THROTTLE_HOURS}h version-check throttle` }
  }

  if (!detailUrl) {
    // No detail URL available — we can't check live version. Trust cache until hard ceiling.
    return { action: "use-cache", reason: "no detailUrl to check live version" }
  }

  const currentVersion = await fetchCurrentVersion(detailUrl)
  if (!currentVersion) {
    // Detail page fetch failed — trust cache rather than forcing re-download on network hiccup.
    return { action: "use-cache", reason: "live version check failed, trusting cache", currentVersion: undefined }
  }

  if (metaValue.version && metaValue.version === currentVersion) {
    return { action: "use-cache", reason: `version unchanged (${currentVersion})`, currentVersion }
  }

  return {
    action: "download",
    reason: `version changed: cached=${metaValue.version ?? "unknown"} current=${currentVersion}`,
    currentVersion,
  }
}

export const downloadPdf = async (
  url: string,
  options: DownloadOptions = {},
): Promise<Either<Error, DownloadResult>> => {
  const downloadDir = options.downloadDir ?? DEFAULT_DOWNLOAD_DIR
  const skipIfExists = options.skipIfExists ?? true
  const username = options.username ?? process.env.NCCN_USERNAME
  const password = options.password ?? process.env.NCCN_PASSWORD
  const { detailUrl } = options
  const forceRefresh = options.forceRefresh ?? false

  const filename = extractFilename(url)
  const filePath = join(downloadDir, filename)

  if (skipIfExists) {
    const decision = await decideAction(filePath, detailUrl, forceRefresh)
    if (decision.action === "use-cache") {
      // Refresh lastCheckedAt if we just did a live check (regardless of outcome).
      if (decision.currentVersion !== undefined) {
        const existingMeta = await readPdfMeta(filePath)
        const nowIso = new Date().toISOString()
        const updated: PdfMeta = existingMeta.isSome()
          ? { ...(existingMeta.value as PdfMeta), lastCheckedAt: nowIso, version: decision.currentVersion }
          : {
              detailUrl,
              downloadedAt: nowIso,
              lastCheckedAt: nowIso,
              sourceUrl: url,
              version: decision.currentVersion,
            }
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
    const liveVersion = detailUrl ? await fetchCurrentVersion(detailUrl) : undefined
    const nowIso = new Date().toISOString()
    const meta: PdfMeta = {
      detailUrl,
      downloadedAt: nowIso,
      lastCheckedAt: nowIso,
      sourceUrl: url,
      version: liveVersion,
    }
    await writePdfMeta(filePath, meta)
  }

  try {
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
  } catch (error) {
    return Either.left(error instanceof Error ? error : new Error(String(error)))
  }
}
