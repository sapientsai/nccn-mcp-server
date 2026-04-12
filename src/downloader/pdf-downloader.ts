import { mkdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { Either } from "functype"

import { checkPdfCache } from "../cache/cache.js"
import type { DownloadOptions, DownloadResult } from "../types.js"
import { DEFAULT_CACHE_AGE_DAYS, DEFAULT_DOWNLOAD_DIR, NCCN_BASE_URL, USER_AGENT } from "../types.js"

const LOGIN_URL = `${NCCN_BASE_URL}/login/Index/`

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

export const downloadPdf = async (
  url: string,
  options: DownloadOptions = {},
): Promise<Either<Error, DownloadResult>> => {
  const downloadDir = options.downloadDir ?? DEFAULT_DOWNLOAD_DIR
  const maxAge = options.maxCacheAgeDays ?? DEFAULT_CACHE_AGE_DAYS
  const skipIfExists = options.skipIfExists ?? true
  const username = options.username ?? process.env.NCCN_USERNAME
  const password = options.password ?? process.env.NCCN_PASSWORD

  const filename = extractFilename(url)
  const filePath = join(downloadDir, filename)

  // Check cache
  if (skipIfExists) {
    const cached = await checkPdfCache(filePath, maxAge)
    if (cached.isSome()) {
      const result: DownloadResult = { filename: filePath, message: "Using cached PDF", success: true }
      return Either.right(result)
    }
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
