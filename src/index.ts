import dotenv from "dotenv"
import yaml from "js-yaml"
import { createServer } from "somamcp"
import { z } from "zod"

import { readYamlIndex } from "./cache/cache.js"
import { downloadPdf } from "./downloader/pdf-downloader.js"
import { extractContent, formatContent } from "./reader/pdf-reader.js"
import { ensureIndex } from "./scraper/index-scraper.js"
import { DEFAULT_DOWNLOAD_DIR, DEFAULT_INDEX_FILE } from "./types.js"

dotenv.config({ override: false })

const server = createServer({
  instructions: [
    "NCCN Clinical Guidelines MCP Server.",
    "Use get_index to discover available guidelines, download_pdf to fetch them,",
    "and extract_content to read specific pages.",
    "Start with page 3 (Table of Contents) to understand the guideline structure.",
  ].join(" "),
  name: "nccn-guidelines",
  version: "1.0.0",
})

// ── Tool: get_index ───────────────────────────────────────────────────

server.addTool({
  description: "Get the NCCN guidelines index listing all available cancer treatment guidelines organized by category",
  execute: async () => {
    const result = await readYamlIndex(DEFAULT_INDEX_FILE)
    return result.fold(
      (error) => `Error loading index: ${error.message}. Try again — the index may still be loading.`,
      (index) => yaml.dump(index, { lineWidth: -1, noRefs: true }),
    )
  },
  name: "get_index",
})

// ── Tool: download_pdf ────────────────────────────────────────────────

server.addTool({
  description: "Download an NCCN guideline PDF. Use a URL from the guidelines index.",
  execute: async (args) => {
    const result = await downloadPdf(args.url, {
      downloadDir: DEFAULT_DOWNLOAD_DIR,
      password: args.password,
      username: args.username,
    })
    return result.fold(
      (error) => `Download failed: ${error.message}`,
      (dl) => `${dl.message}: ${dl.filename}`,
    )
  },
  name: "download_pdf",
  parameters: z.object({
    password: z.string().optional().describe("NCCN password (falls back to NCCN_PASSWORD env var)"),
    url: z.string().describe("PDF URL from the guidelines index"),
    username: z.string().optional().describe("NCCN login email (falls back to NCCN_USERNAME env var)"),
  }),
})

// ── Tool: extract_content ─────────────────────────────────────────────

server.addTool({
  description: [
    "Extract text from specific pages of a downloaded NCCN guideline PDF.",
    "Supports page numbers (1,3,5), ranges (1-5), and negative indexing (-1 for last page).",
  ].join(" "),
  execute: async (args) => {
    const result = await extractContent(args.pdf_path, args.pages)
    return result.fold(
      (error) => `Extraction failed: ${error.message}`,
      (pages) => formatContent(pages),
    )
  },
  name: "extract_content",
  parameters: z.object({
    pages: z.string().optional().describe("Page numbers/ranges (e.g., '1,3,5-7', '-1' for last page). Omit for all."),
    pdf_path: z.string().describe("Path to the downloaded PDF file"),
  }),
})

// ── Resource: guidelines index ────────────────────────────────────────

server.addResource({
  description: "Complete NCCN guidelines index in YAML format",
  load: async () => {
    const result = await readYamlIndex(DEFAULT_INDEX_FILE)
    return result.fold(
      () => ({ text: "Index not yet available. The server may still be loading." }),
      (index) => ({ text: yaml.dump(index, { lineWidth: -1, noRefs: true }) }),
    )
  },
  mimeType: "text/yaml",
  name: "NCCN Guidelines Index",
  uri: "nccn://guidelines-index",
})

// ── Start ─────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  // Begin index refresh in background (don't block server start)
  ensureIndex(DEFAULT_INDEX_FILE).then((result) =>
    result.fold(
      (error) => console.error(`[server] Index loading failed: ${error.message}`),
      (index) =>
        console.error(
          `[server] Index loaded: ${index.nccn_guidelines.reduce((n, c) => n + c.guidelines.length, 0)} guidelines`,
        ),
    ),
  )

  const transport = process.env.MCP_TRANSPORT ?? "stdio"
  if (transport === "httpStream") {
    const port = parseInt(process.env.MCP_PORT ?? "8000", 10)
    await server.start({ httpStream: { port }, transportType: "httpStream" })
    console.error(`[server] NCCN Guidelines MCP server running on port ${port}`)
  } else {
    await server.start({ transportType: "stdio" })
  }
}

main().catch((error) => {
  console.error(`[server] Fatal: ${error}`)
  process.exit(1)
})
