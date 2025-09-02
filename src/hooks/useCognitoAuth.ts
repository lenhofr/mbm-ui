import { useEffect, useState, useCallback } from 'react'
import '../auth/amplify'
import { fetchAuthSession, signIn, signOut, signUp, confirmSignUp, type SignInInput, type SignUpInput } from 'aws-amplify/auth'

export type AuthUser = {
  sub?: string
  email?: string
}

export type AuthState = {
  isAuthed: boolean
  loading: boolean
  user?: AuthUser
  error?: string
  idToken?: string
  accessToken?: string
}

export function useCognitoAuth() {
  const [state, setState] = useState<AuthState>({ isAuthed: false, loading: true })

  const refresh = useCallback(async () => {
    try {
      const session = await fetchAuthSession()
  const id = session.tokens?.idToken?.payload as any
      const email = id?.email as string | undefined
      const sub = id?.sub as string | undefined
  const idToken = session.tokens?.idToken?.toString()
  const accessToken = session.tokens?.accessToken?.toString()
  setState({ isAuthed: !!session.tokens, loading: false, user: { email, sub }, idToken, accessToken })
    } catch (e) {
      setState({ isAuthed: false, loading: false })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const doSignIn = useCallback(async (input: SignInInput) => {
    try {
      const res = await signIn(input)
      await refresh()
      return res
    } catch (e: any) {
      setState(s => ({ ...s, error: e?.message || 'Sign-in failed' }))
      throw e
    }
  }, [refresh])

  const doSignOut = useCallback(async () => {
    await signOut()
    await refresh()
  }, [refresh])

  const doSignUp = useCallback(async (input: SignUpInput) => {
    const res = await signUp(input)
    return res
  }, [])

  const doConfirmSignUp = useCallback(async (username: string, confirmationCode: string) => {
    await confirmSignUp({ username, confirmationCode })
  }, [])

  return {
    ...state,
    signIn: doSignIn,
    signOut: doSignOut,
    signUp: doSignUp,
    confirmSignUp: doConfirmSignUp,
    refresh,
    authHeader: (prefer: 'id' | 'access' = 'id') => {
      const token = prefer === 'id' ? (state.idToken || state.accessToken) : (state.accessToken || state.idToken)
      return token ? { Authorization: `Bearer ${token}` } : {}
    },
  }
}
