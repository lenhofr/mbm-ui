// Minimal Cognito Hosted UI PKCE auth for a SPA.
// Env vars (Vite):
// - VITE_COGNITO_DOMAIN: e.g., https://mbm-app-xxxx.auth.us-east-1.amazoncognito.com
// - VITE_COGNITO_CLIENT_ID
// - VITE_COGNITO_REDIRECT_URI: e.g., http://localhost:5173/

type Tokens = {
  access_token: string
  id_token?: string
  token_type: string
  expires_at: number // epoch seconds
}

const cfg = {
  domain: (import.meta as any).env.VITE_COGNITO_DOMAIN as string | undefined,
  client_id: (import.meta as any).env.VITE_COGNITO_CLIENT_ID as string | undefined,
  redirect_uri: (import.meta as any).env.VITE_COGNITO_REDIRECT_URI as string | undefined,
  scope: 'openid email profile',
}

const LS_KEY = 'mbm:auth:tokens'
const PKCE_VERIFIER_KEY = 'mbm:auth:pkce:verifier'

function randomString(len = 64) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  let result = ''
  const cryptoObj = window.crypto || (window as any).msCrypto
  const randomValues = new Uint8Array(len)
  cryptoObj.getRandomValues(randomValues)
  for (let i = 0; i < len; i++) {
    result += charset[randomValues[i] % charset.length]
  }
  return result
}

async function sha256(input: string) {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return new Uint8Array(buf)
}

function base64url(bytes: Uint8Array) {
  let str = btoa(String.fromCharCode(...bytes))
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function getTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function isAuthenticated() {
  const t = getTokens()
  const now = Math.floor(Date.now() / 1000)
  return !!t && t.expires_at > now + 30
}

export function getAccessToken(): string | null {
  const t = getTokens()
  if (!t) return null
  const now = Math.floor(Date.now() / 1000)
  if (t.expires_at <= now + 30) return null
  return t.access_token
}

export function authHeader(opts?: { prefer?: 'id' | 'access' }): Record<string, string> {
  const t = getTokens()
  if (!t) return {}
  const now = Math.floor(Date.now() / 1000)
  if (t.expires_at <= now + 30) return {}
  const prefer = opts?.prefer || 'id'
  const token = (prefer === 'id' ? t.id_token : t.access_token) || t.access_token || t.id_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function login() {
  if (!cfg.domain || !cfg.client_id || !cfg.redirect_uri) {
    console.warn('Cognito env not configured')
    return
  }
  const verifier = randomString(64)
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  const challenge = base64url(await sha256(verifier))
  const url = new URL(`${cfg.domain}/oauth2/authorize`)
  url.searchParams.set('client_id', cfg.client_id)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', cfg.redirect_uri)
  url.searchParams.set('scope', cfg.scope)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('code_challenge', challenge)
  window.location.assign(url.toString())
}

export function logout() {
  // Clear tokens and redirect to hosted UI logout (if configured)
  localStorage.removeItem(LS_KEY)
  const domain = cfg.domain
  if (domain && cfg.client_id && cfg.redirect_uri) {
    const url = new URL(`${domain}/logout`)
    url.searchParams.set('client_id', cfg.client_id)
    url.searchParams.set('logout_uri', cfg.redirect_uri)
    window.location.assign(url.toString())
  } else {
    // Soft reload to reflect logged-out state
    window.location.reload()
  }
}

export async function handleRedirectCallback(): Promise<boolean> {
  if (!cfg.domain || !cfg.client_id || !cfg.redirect_uri) return false
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) return false
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY)
  if (!verifier) return false
  try {
    const body = new URLSearchParams()
    body.set('grant_type', 'authorization_code')
    body.set('client_id', cfg.client_id)
    body.set('code_verifier', verifier)
    body.set('redirect_uri', cfg.redirect_uri)
    body.set('code', code)
    const resp = await fetch(`${cfg.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!resp.ok) throw new Error('token exchange failed')
    const data = await resp.json()
    const now = Math.floor(Date.now() / 1000)
    const tokens: Tokens = {
      access_token: data.access_token,
      id_token: data.id_token,
      token_type: data.token_type,
      expires_at: now + (data.expires_in || 3600),
    }
    localStorage.setItem(LS_KEY, JSON.stringify(tokens))
    sessionStorage.removeItem(PKCE_VERIFIER_KEY)
    // Clean URL
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('code')
    cleanUrl.searchParams.delete('state')
    window.history.replaceState({}, '', cleanUrl.toString())
    return true
  } catch (e) {
    console.warn('Auth callback failed', e)
    return false
  }
}

export async function initAuth() {
  await handleRedirectCallback()
}
