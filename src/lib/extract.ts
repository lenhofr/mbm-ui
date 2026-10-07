// Client for the AI recipe extraction endpoint.
import { getApiBase } from './env'
import { compressForExtract } from './images'
import type { ExtractResult } from './draft'

export type ExtractInput =
  | { kind: 'scan' | 'screenshot'; files: Blob[] }
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string }

export class UnreadableError extends Error {}

export async function extractRecipe(
  input: ExtractInput,
  authHeaders: Record<string, string | undefined>,
  opts: { knownTags?: string[]; signal?: AbortSignal } = {},
): Promise<ExtractResult> {
  const { knownTags = [], signal } = opts
  let body: object
  if (input.kind === 'link') body = { type: 'url', url: input.url, knownTags }
  else if (input.kind === 'text') body = { type: 'text', text: input.text, knownTags }
  else body = { type: 'image', source: input.kind, images: await Promise.all(input.files.map(f => compressForExtract(f))), knownTags }

  const res = await fetch(`${getApiBase()}/ai/extract-recipe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders as Record<string, string>) },
    body: JSON.stringify(body),
    signal,
  })
  const result = (await res.json().catch(() => ({}))) as ExtractResult & { message?: string }
  if (!res.ok) throw new Error(result?.error || result?.message || `HTTP ${res.status}`)
  if (result.readable === false) throw new UnreadableError(result.error || 'unreadable')
  if (result.error) throw new Error(result.error)
  return result
}

export type PasteKind = { kind: 'link' | 'text'; label: string; detail: string }

export function detectPaste(value: string): PasteKind | null {
  const s = value.trim()
  if (!s) return null
  if (/^https?:\/\/\S+$/i.test(s)) {
    try { return { kind: 'link', label: 'Link', detail: new URL(s).hostname.replace(/^www\./, '') } } catch {}
  }
  const words = s.split(/\s+/).length
  return { kind: 'text', label: 'Recipe text', detail: `${words} ${words === 1 ? 'word' : 'words'}` }
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
