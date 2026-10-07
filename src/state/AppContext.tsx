// App-wide state: recipes + CRUD, auth, favorites, toasts, sheets and the in-flight import.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { storage } from '../lib/storage'
import { useCognitoAuth } from '../hooks/useCognitoAuth'
import { useFavorites } from '../lib/favorites'
import { recipeFromDraft } from '../lib/draft'
import { getApiBase } from '../lib/env'
import { toStoredImage, uploadImage } from '../lib/images'
import type { ExtractInput } from '../lib/extract'
import type { Draft, Recipe } from '../types'

export type SheetName = 'add' | 'paste' | null

/** What the Processing screen should extract, plus previews of scanned pages for the review "Original" viewer. */
export type ImportJob = ExtractInput & { originals?: string[] }

/** Safely decode a JWT payload without any external library. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

const LOAD_ERRORS = [
  "Something's burning in the kitchen. We're on it!",
  'A kitchen mishap! Please try again in a moment.',
]

function useAppState() {
  const auth = useCognitoAuth()
  const jwt = auth.idToken ? decodeJwtPayload(auth.idToken) : null
  const displayName = jwt?.nickname as string | undefined
  const userSub = (jwt?.sub ?? jwt?.['cognito:username']) as string | undefined

  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setRecipes((await storage.listRecipes()) || [])
    } catch (e) {
      console.error('Failed to load recipes', e)
      setLoadError(LOAD_ERRORS[Math.floor(Math.random() * LOAD_ERRORS.length)])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const { favorites, toggle: toggleFavorite } = useFavorites(userSub)

  const [toastMsg, setToastMsg] = useState<{ text: string; k: number } | null>(null)
  const toast = useCallback((text: string) => setToastMsg({ text, k: Date.now() }), [])
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 2600)
    return () => clearTimeout(t)
  }, [toastMsg])

  const [sheet, setSheet] = useState<SheetName>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [importJob, setImportJob] = useState<ImportJob | null>(null)
  /** Draft handed from an import to the /new editor. */
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null)

  /** Returns true when signed in; otherwise opens the login modal. */
  const requireLogin = useCallback(() => {
    if (auth.isAuthed) return true
    setShowLogin(true)
    return false
  }, [auth.isAuthed])

  /** Upload any new photo, then create or update. Returns the saved recipe. */
  const saveDraft = useCallback(async (d: Draft): Promise<Recipe> => {
    let image = d.image
    if (d.imageFile && getApiBase()) image = await uploadImage(d.imageFile, auth.authHeader())
    const input = recipeFromDraft(d, toStoredImage(image))
    if (d.source === 'edit' && d.id) {
      const updated = await storage.updateRecipe(d.id, input)
      setRecipes(rs => rs.map(r => (r.id === d.id ? updated : r)))
      return updated
    }
    const created = await storage.createRecipe(input)
    setRecipes(rs => [created, ...rs])
    return created
  }, [auth])

  const deleteRecipe = useCallback(async (id: string) => {
    await storage.deleteRecipe(id)
    setRecipes(rs => rs.filter(r => r.id !== id))
  }, [])

  return {
    auth, displayName, userSub,
    recipes, loading, loadError, reload,
    favorites, toggleFavorite,
    toastMsg, toast,
    sheet, setSheet,
    showLogin, setShowLogin, requireLogin,
    importJob, setImportJob,
    pendingDraft, setPendingDraft,
    saveDraft, deleteRecipe,
  }
}

export type AppState = ReturnType<typeof useAppState>

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const value = useAppState()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside AppProvider')
  return v
}

export function useRecipe(id: string | undefined): Recipe | undefined {
  const { recipes } = useApp()
  return useMemo(() => recipes.find(r => r.id === id), [recipes, id])
}
