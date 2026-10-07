// Per-user favorites. Stored locally (keyed by Cognito sub) until the API supports them.
import { useCallback, useEffect, useState } from 'react'

const keyFor = (sub?: string) => `mbm:favorites:${sub || 'anon'}`

function read(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function useFavorites(userSub?: string) {
  const key = keyFor(userSub)
  const [ids, setIds] = useState<string[]>(() => read(key))

  useEffect(() => { setIds(read(key)) }, [key])

  const toggle = useCallback((id: string) => {
    setIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      try { window.localStorage.setItem(key, JSON.stringify(next)) } catch {}
      return next
    })
  }, [key])

  return { favorites: new Set(ids), toggle }
}
