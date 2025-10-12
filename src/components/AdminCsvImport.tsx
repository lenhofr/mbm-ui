import React, { useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import type { Recipe } from '../App'
import { storage } from '../lib/storage'
import { useCognitoAuth } from '../hooks/useCognitoAuth'

// Simple, admin-only CSV importer. Parses small CSVs (<= ~1MB) client-side and creates recipes via storage.
// Assumes an authenticated admin (e.g., Cognito group). We only gate via a claim check in the UI.
// CSV columns:
// title, description, tags, servings, cookTime, ingredients, instructions
// - tags: comma-separated (e.g., "pasta, dinner")
// - ingredients: one per line separated by \n inside the cell; each line like "1 cup flour" or just a name
// - instructions: one step per line separated by \n inside the cell
// Empty cells are allowed.

function parseTags(v?: string): string[] | undefined {
  if (!v) return undefined
  const t = v.split(/[,;]/).map(s => s.trim()).filter(Boolean)
  return t.length ? t : undefined
}

function parseIngredients(v?: string): { name: string; amount?: string }[] | undefined {
  if (!v) return undefined
  const lines = v.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const items = lines.map(line => {
    // naive split: take first 1-2 tokens as amount if they contain digits or fractions, rest as name
    const m = line.match(/^(\d+[\d\/\s\.-]*\w*\s+)?(.+)$/)
    if (m) {
      const amount = m[1]?.trim()
      const name = m[2]?.trim() || line
      return amount ? { name, amount } : { name }
    }
    return { name: line }
  })
  return items.length ? items : undefined
}

function parseInstructions(v?: string): string[] | undefined {
  if (!v) return undefined
  const steps = v.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  return steps.length ? steps : undefined
}

export default function AdminCsvImport({ onImported }: { onImported?: (count: number) => void }) {
  const auth = useCognitoAuth()
  const isAdmin = useMemo(() => {
    try {
      // crude group check from ID token
      const raw = (auth as any).idToken as string | undefined
      if (!raw) return false
      const payload = JSON.parse(atob(raw.split('.')[1] || ''))
      const groups: string[] = payload['cognito:groups'] || []
      return groups.includes('Admin')
    } catch {
      return false
    }
  }, [auth])

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)

  function append(msg: string) { setLog(l => [...l, msg]) }

  async function handleFile(file: File) {
    setBusy(true)
    setLog([])
    append(`Reading ${file.name}...`)

    const text = await file.text()
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' })
    if (parsed.errors?.length) {
      append(`Parse errors: ${parsed.errors.length}`)
      parsed.errors.slice(0, 5).forEach(e => append(`${e.row ?? '?'}: ${e.message}`))
    }

    const rows = (parsed.data as any[]).filter(Boolean)
    append(`Rows: ${rows.length}`)

    let success = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const payload: Omit<Recipe, 'id'> = {
        title: String(r.title || '').trim(),
        description: r.description ? String(r.description).trim() : undefined,
        tags: parseTags(r.tags),
        servings: r.servings ? String(r.servings) : undefined,
        cookTime: r.cookTime ? String(r.cookTime) : undefined,
        ingredients: parseIngredients(r.ingredients),
        instructions: parseInstructions(r.instructions),
      }
      if (!payload.title) { append(`Row ${i+2}: missing title`); continue }
      try {
        await storage.createRecipe(payload)
        success++
      } catch (e: any) {
        append(`Row ${i+2}: failed (${e?.message || 'error'})`)
      }
    }

    append(`Imported ${success}/${rows.length}`)
    setBusy(false)
    onImported?.(success)
  }

  if (!auth.isAuthed || !isAdmin) return null

  return (
    <div className="admin-import">
      <div className="admin-import__card">
        <h3>Admin: CSV Import</h3>
        <p>Upload a small CSV (≤ 1MB) with columns: title, description, tags, servings, cookTime, ingredients, instructions.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }} />
        <div className="admin-import__log">
          {log.map((l, i) => <div key={i} className="log-line">{l}</div>)}
        </div>
      </div>
    </div>
  )
}
