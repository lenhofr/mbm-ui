// Persisted recipe shape (DynamoDB / localStorage). Kept backward-compatible with
// existing records: ingredients are {amount, name} strings and instructions are
// plain strings. Structured quantities and step timers are derived on the client.
export type Recipe = {
  id: string
  title: string
  description?: string
  image?: string
  tags?: string[]
  ingredients?: { name: string; amount?: string }[]
  servings?: string
  cookTime?: string
  instructions?: string[]
  // Attribution fields stamped by the backend
  createdByName?: string
  updatedByName?: string
  createdBySub?: string
  updatedBySub?: string
  createdAt?: number
  updatedAt?: number
}

export type RecipeInput = Omit<Recipe, 'id'>

/** A question the AI asks about an uncertain field: [replacementText, label] pairs. */
export type Flag = { q: string; opts: [string, string][] }

export type DraftRow = { text: string; flag?: Flag; ok?: boolean }

export type DraftSource = 'scan' | 'link' | 'text' | 'screenshot' | 'manual' | 'edit'

/** Editor state shared by scan review, import review, new recipe and edit. */
export type Draft = {
  source: DraftSource
  id?: string
  sourceLabel?: string
  title: string
  description: string
  cookTime: string
  servings: number
  /** Stored image key/URL, or a data: URL preview when imageFile is set. */
  image?: string
  imageFile?: File
  tags: { t: string; ai?: boolean }[]
  ingredients: DraftRow[]
  steps: DraftRow[]
  /** Object URLs of the scanned pages, for the "Original" viewer. */
  originals?: string[]
}
