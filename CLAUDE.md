# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

MCP (Model Context Protocol) server that provides access to NCCN (National Comprehensive Cancer Network) clinical cancer treatment guidelines. Ported from the Python [NCCN_guidelines_MCP](https://github.com/sapientsai/NCCN_guidelines_MCP) project.

Built on **somamcp** (MCP framework) + **functype** (FP patterns). Uses a non-RAG approach — reads guidelines directly from PDFs for accuracy.

## Commands

```bash
pnpm validate                  # Pre-commit: format + lint + typecheck + test + build
pnpm test                      # Run tests once
pnpm vitest run test/reader/pdf-reader.spec.ts   # Run single test file
pnpm build                     # Production build
pnpm dev                       # Watch mode
pnpm typecheck                 # Type checking only
pnpm start                     # Run the built server (stdio transport)
```

## Architecture

### Main Entry (`src/index.ts`)

Creates the MCP server via `somamcp.createServer()` and registers 3 tools + 1 resource. On startup, launches an async index refresh (non-blocking), then starts the transport.

### Modules

- **`src/scraper/index-scraper.ts`** — Scrapes NCCN website (4 category pages + each guideline detail page) using cheerio. Returns `Either<Error, GuidelineIndex>`. 7-day cache with fallback to stale cache on scrape failure.
- **`src/downloader/pdf-downloader.ts`** — Downloads PDFs with NCCN login flow. Detects login redirects, authenticates with `NCCN_USERNAME`/`NCCN_PASSWORD`, retries with auth cookies.
- **`src/reader/pdf-reader.ts`** — Extracts text from PDF pages using pdf-parse. Supports page specs like `"1,3,5-7"` and `"-1"` (last page).
- **`src/cache/cache.ts`** — File-based caching for the YAML index and PDF files. Uses functype's `Option`/`Either`.
- **`src/types.ts`** — Shared types and constants (cache durations, URLs, User-Agent).

## MCP Tools

| Tool              | Purpose                                              | Key Parameters                        |
| ----------------- | ---------------------------------------------------- | ------------------------------------- |
| `get_index`       | List all available guidelines organized by category  | (none)                                |
| `download_pdf`    | Download a guideline PDF (with auto-login if needed) | `url`, optional `username`/`password` |
| `extract_content` | Extract text from specific pages of a downloaded PDF | `pdf_path`, optional `pages`          |

**Resource**: `nccn://guidelines-index` — full YAML index.

## Environment Variables

| Var             | Purpose                                      | Required                            |
| --------------- | -------------------------------------------- | ----------------------------------- |
| `NCCN_USERNAME` | NCCN account email for PDF login             | Yes for download (optional in args) |
| `NCCN_PASSWORD` | NCCN account password                        | Yes for download (optional in args) |
| `MCP_TRANSPORT` | `stdio` (default) or `httpStream`            | No                                  |
| `MCP_PORT`      | Port for httpStream transport (default 8000) | No                                  |

## Cache Behavior

- **Index YAML**: `./nccn_guidelines_index.yaml`, 7-day default
- **PDFs**: `./downloads/*.pdf`, 7-day default
- Stale cache is used as fallback if scraping fails

## Patterns

- **Functional error handling**: `Either<Error, T>` via functype for all I/O-bound operations
- **No async inside `.fold()`**: When unwrapping Either, use `isLeft()` guard + early return instead of fold with an async callback (the return becomes `Promise<T>`, not `T`)
- **Cast narrowing**: After `isLeft()`/`isRight()` type guards, TypeScript's narrowing doesn't always propagate through Either's value union — use `as Error` / `as T` at the access site when needed
- **Zod schemas → somamcp tools**: `z.object({...}).describe()` → pass directly to `parameters` field

## Typical Agent Workflow

1. Call `get_index` → find relevant guideline URL by cancer type
2. Call `download_pdf(url)` → returns local PDF path
3. Call `extract_content(pdf_path, "3")` → read Table of Contents
4. Call `extract_content(pdf_path, "10-15")` → read specific clinical pages
5. Provide evidence-based answer with page citations

## Dependencies

- **somamcp** (file link to `../somamcp`) — MCP framework
- **functype** — Option/Either/Try
- **cheerio** — HTML parsing (replaces Python BeautifulSoup)
- **pdf-parse** — PDF text extraction (replaces Python pypdf)
- **js-yaml** — YAML read/write
- **zod** — Tool parameter schemas
- **dotenv** — .env file loading
