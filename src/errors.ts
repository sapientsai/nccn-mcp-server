import type { ContentResult } from "somamcp/node"

export const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))

// isError lets MCP clients tell a failed call from a successful one without parsing the text
export const toolError = (text: string): ContentResult => ({ content: [{ text, type: "text" }], isError: true })
