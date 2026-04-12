## nccn-mcp-server

An MCP (Model Context Protocol) server that provides access to NCCN (National Comprehensive Cancer Network) clinical cancer treatment guidelines. Ported from the Python [NCCN_guidelines_MCP](https://github.com/sapientsai/NCCN_guidelines_MCP) project.

Built on [somamcp](https://github.com/sapientsai/somamcp) (MCP framework) and [functype](https://github.com/jordanburke/functype) (FP patterns). Uses a non-RAG approach — reads guidelines directly from PDFs for accuracy and traceability.

---

## ⚠️ Licensing Notice — Read Before Use

**NCCN content is copyrighted and its End-User License Agreement explicitly prohibits AI use without a separate written agreement with NCCN.**

The relevant EULA clause states:

> _"Except as otherwise separately and specifically agreed in writing by NCCN, users shall not use NCCN Content in connection with any development, testing, training, exploitation or support of any artificial intelligence (AI) software or other model, algorithm or technology."_

This project is provided for **personal research and evaluation only**. Do not deploy it in any commercial, clinical, or client-facing context without first obtaining an NCCN license. Contact [[email protected]](mailto:[email protected]) for licensing inquiries.

### Regulatory context

- NCCN is recognized by **CMS** (not FDA) as an authoritative compendium under Social Security Act §1861(t)(2)(B) for Medicare coverage determinations of off-label anti-cancer drug indications.
- FDA has no rule that overrides NCCN's copyright or licensing terms. The EULA restriction on AI use is a private contract term, not a regulatory question.
- For production AI integrations that need NCCN content, consider either (a) a direct NCCN license (the path [OpenEvidence took](https://www.openevidence.com/announcements/nccn-and-openevidence-collaborate-to-bring-clinical-oncology-guidelines-to-medical-ai) in Nov 2025) or (b) integrating via a licensed aggregator like OpenEvidence's API.

### No warranty

This software is provided "as is" without warranty of any kind. It does not constitute medical advice, is not a clinical decision support tool, and must not be used as the sole basis for any treatment decision.

---

## Features

- **Live index** — scrapes the NCCN site to discover all available guidelines across 4 categories (Treatment by Cancer Type, Detection/Prevention, Supportive Care, Specific Populations), ~90 guidelines total. Each entry carries the current `Version X.YYYY` string from NCCN.
- **Version-aware PDF caching** — per-file `.meta.json` sidecar tracks NCCN's live version string; re-downloads only when NCCN actually publishes a new version, with a 6h throttle on version checks and a 30-day hard refresh ceiling.
- **Authenticated PDF download** — detects NCCN's login redirect, authenticates with credentials, and retries with auth cookies.
- **Per-page text extraction** — pulls text from specific pages or ranges, supports negative indexing for last page.
- **File-based caching** — 7-day default TTL for both the YAML index and downloaded PDFs, with stale-cache fallback if scraping fails.
- **Functional error handling** — all I/O operations return `Either<Error, T>` via functype.

## MCP Tools

| Tool              | Purpose                                                                                         | Key Parameters                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `get_index`       | List all available guidelines organized by category (includes live `version` + `detailUrl`)     | (none)                                                          |
| `download_pdf`    | Download a guideline PDF with version-aware caching (auto-login, 6h throttle, 30d hard refresh) | `url`, optional `username`/`password`, optional `force_refresh` |
| `extract_content` | Extract text from specific pages of a downloaded PDF                                            | `pdf_path`, optional `pages`                                    |

### Resources

| Resource URI              | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `nccn://guidelines-index` | Full YAML index of all guidelines and categories |

### Page specification syntax (for `extract_content`)

- Single: `"3"`
- Multiple: `"1,3,5"`
- Range: `"1-5"`
- Combined: `"1,3,5-7"`
- Last page: `"-1"`
- Omit entirely to extract all pages

## Typical Agent Workflow

1. Call `get_index` — find a guideline URL by cancer type
2. Call `download_pdf(url)` — returns a local PDF path under `./downloads/`
3. Call `extract_content(pdf_path, "3")` — read the Table of Contents (page 3 is standard for NCCN guidelines)
4. Call `extract_content(pdf_path, "10-15")` — read specific clinical pages
5. Provide evidence-based answer with page citations

## Installation

```bash
pnpm install
pnpm build
```

## Configuration

### Environment variables

| Variable        | Purpose                                          | Required                                  |
| --------------- | ------------------------------------------------ | ----------------------------------------- |
| `NCCN_USERNAME` | NCCN account email for PDF login                 | Yes for downloads (or passed as tool arg) |
| `NCCN_PASSWORD` | NCCN account password                            | Yes for downloads (or passed as tool arg) |
| `MCP_TRANSPORT` | `stdio` (default) or `httpStream`                | No                                        |
| `MCP_PORT`      | Port for `httpStream` transport (default `8000`) | No                                        |

### Claude Code integration (`.mcp.json`)

```json
{
  "mcpServers": {
    "nccn-guidelines": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "NCCN_USERNAME": "${NCCN_USERNAME}",
        "NCCN_PASSWORD": "${NCCN_PASSWORD}"
      }
    }
  }
}
```

Place this at the repo root and Claude Code will prompt to approve the project-scoped server on next restart.

## Usage

### As an MCP server (stdio — default)

```bash
pnpm start
```

### HTTP stream transport

```bash
MCP_TRANSPORT=httpStream MCP_PORT=8000 pnpm start
```

## Architecture

### Entry point (`src/index.ts`)

Creates the MCP server via `somamcp.createServer()` and registers 3 tools + 1 resource. On startup, kicks off an async index refresh (non-blocking), then starts the configured transport.

### Modules

| Module                             | Responsibility                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/scraper/index-scraper.ts`     | Scrapes NCCN (4 category pages + each guideline detail page) using cheerio. Returns `Either<Error, GuidelineIndex>`. Cached 7 days.          |
| `src/downloader/pdf-downloader.ts` | Downloads PDFs with NCCN login flow. Detects login redirects, authenticates with `NCCN_USERNAME`/`NCCN_PASSWORD`, retries with auth cookies. |
| `src/reader/pdf-reader.ts`         | Extracts per-page text via `pdf-parse`'s `pagerender` callback. Supports page specs and negative indexing.                                   |
| `src/cache/cache.ts`               | File-based caching for the YAML index and PDF files. Uses functype's `Option`/`Either`.                                                      |
| `src/types.ts`                     | Shared types and constants (cache durations, URLs, User-Agent).                                                                              |

### Cache behavior

- **Index**: `./nccn_guidelines_index.yaml` (7-day TTL). Stale cache is returned as a fallback when scraping fails.
- **PDFs**: `./downloads/*.pdf` with per-file metadata sidecar `*.meta.json` tracking the live NCCN version string and last-checked timestamp.
- **Version-aware refresh policy** on `download_pdf`:
  1. `force_refresh=true` → always re-download.
  2. Cached file older than 30 days → re-download (catches silent revisions NCCN may ship without bumping the version string).
  3. Within 6 hours of last check → trust cache, no network call.
  4. Otherwise → fetch the detail page, compare `Version X.YYYY`, re-download only if changed.

## Development

```bash
pnpm validate                                    # format + lint + typecheck + test + build
pnpm test                                        # run tests once
pnpm vitest run test/reader/pdf-reader.spec.ts   # run a single test file
pnpm build                                       # production build
pnpm dev                                         # watch mode
pnpm typecheck                                   # type checking only
pnpm start                                       # run the built server (stdio transport)
```

## Project Structure

```
src/
├── cache/              # YAML + PDF caching
├── downloader/         # PDF download with NCCN auth flow
├── reader/             # Per-page PDF text extraction
├── scraper/            # NCCN website scraper
├── types.ts            # Shared types and constants
└── index.ts            # MCP server entry point
test/                   # Vitest specs mirroring src/ layout
dist/                   # Built output (ES module + types)
downloads/              # Downloaded PDFs (gitignored)
nccn_guidelines_index.yaml  # Cached index (gitignored)
```

## Dependencies

- **[somamcp](https://github.com/sapientsai/somamcp)** — MCP framework
- **[functype](https://github.com/jordanburke/functype)** — Option/Either/Try
- **[cheerio](https://cheerio.js.org/)** — HTML parsing (replaces Python BeautifulSoup)
- **[pdf-parse](https://gitlab.com/autokent/pdf-parse)** — PDF text extraction (replaces Python pypdf)
- **[js-yaml](https://github.com/nodeca/js-yaml)** — YAML read/write
- **[zod](https://zod.dev/)** — Tool parameter schemas
- **[dotenv](https://github.com/motdotla/dotenv)** — `.env` file loading

## License

MIT (for this codebase). See the **Licensing Notice** above for NCCN content usage restrictions — the MIT license on this code does **not** grant any rights to NCCN content.
