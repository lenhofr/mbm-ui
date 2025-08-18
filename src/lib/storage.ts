// Storage abstraction for recipes. Provides a local adapter (localStorage/in-memory)
// and a RemoteAdapter stub for future HTTP-backed storage.

import type { Recipe } from '../App'
import { authHeader } from './auth'

export type Storage = {
  listRecipes: () => Promise<Recipe[]>
  getRecipe: (id: string) => Promise<Recipe | null>
  createRecipe: (r: Omit<Recipe, 'id'>) => Promise<Recipe>
  updateRecipe: (id: string, r: Omit<Recipe, 'id'>) => Promise<Recipe>
  deleteRecipe: (id: string) => Promise<void>
}

// LocalAdapter: uses localStorage if available, otherwise in-memory array.
class LocalAdapter implements Storage {
  private key = 'mbm:recipes'
  private memory: Recipe[] = []

  private load(): Recipe[] {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.key)
        if (raw) return JSON.parse(raw)
      }
    } catch (e) {
      // fall back to memory
    }
    return this.memory
  }

  private save(items: Recipe[]) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.key, JSON.stringify(items))
      } else {
        this.memory = items
      }
    } catch (e) {
      this.memory = items
    }
  }

  async listRecipes() {
    return this.load()
  }

  async getRecipe(id: string) {
    return this.load().find(r => r.id === id) ?? null
  }

  async createRecipe(r: Omit<Recipe, 'id'>) {
    const items = this.load()
    const newItem: Recipe = { id: String(Date.now()), ...r }
    items.unshift(newItem)
    this.save(items)
    return newItem
  }

  async updateRecipe(id: string, r: Omit<Recipe, 'id'>) {
    const items = this.load()
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1) throw new Error('not found')
    const updated = { ...items[idx], ...r }
    items[idx] = updated
    this.save(items)
    return updated
  }

  async deleteRecipe(id: string) {
    const items = this.load().filter(i => i.id !== id)
    this.save(items)
  }
}

// RemoteAdapter stub: future implementation will call API endpoints
class RemoteAdapter implements Storage {
  constructor(private base: string) {}

  async listRecipes() {
    const res = await fetch(`${this.base}/recipes`)
    if (!res.ok) throw new Error('network')
    return res.json()
  }

  async getRecipe(id: string) {
    const res = await fetch(`${this.base}/recipes/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error('network')
    return res.json()
  }

  async createRecipe(r: Omit<Recipe, 'id'>) {
    const res = await fetch(`${this.base}/recipes`, { method: 'POST', body: JSON.stringify(r), headers: { 'Content-Type': 'application/json', ...authHeader() } })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('POST /recipes failed', res.status, text)
      throw new Error(`network`)
    }
    return res.json()
  }

  async updateRecipe(id: string, r: Omit<Recipe, 'id'>) {
    const res = await fetch(`${this.base}/recipes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(r), headers: { 'Content-Type': 'application/json', ...authHeader() } })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('PUT /recipes/{id} failed', res.status, text)
      throw new Error('network')
    }
    return res.json()
  }

  async deleteRecipe(id: string) {
    const res = await fetch(`${this.base}/recipes/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...authHeader() } })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('DELETE /recipes/{id} failed', res.status, text)
      throw new Error('network')
    }
  }
}

// Factory: pick adapter based on environment
export function createStorage(): Storage {
  // Prefer Vite env, fall back to REACT_APP if present in non-browser contexts
  const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
  const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
  const base = (viteBase || legacyBase || '').trim()
  if (base) return new RemoteAdapter(base)
  return new LocalAdapter()
}

export const storage = createStorage()
