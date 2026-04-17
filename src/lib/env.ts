// Shared environment variable helpers

/**
 * Returns the API base URL from Vite env (or legacy REACT_APP_ fallback).
 * Returns an empty string when running without a backend (local adapter mode).
 */
export function getApiBase(): string {
  const viteBase = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE
  const legacyBase =
    typeof process !== 'undefined'
      ? (process as NodeJS.Process & { env?: Record<string, string> }).env?.REACT_APP_API_BASE
      : undefined
  return (viteBase || legacyBase || '').trim()
}
