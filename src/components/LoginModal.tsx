import React from 'react'
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'
import '../auth/amplify'

type Props = {
  visible: boolean
  onClose: () => void
}

export default function LoginModal({ visible, onClose }: Props) {
  if (!visible) return null

  // prevent background scroll
  React.useEffect(() => {
    document.documentElement.classList.add('modal-open')
    document.body.classList.add('modal-open')
    return () => {
      document.documentElement.classList.remove('modal-open')
      document.body.classList.remove('modal-open')
    }
  }, [])

  // Track Amplify Authenticator route/status to improve UX
  const { authStatus, route } = useAuthenticator((context) => [context.authStatus, context.route])

  // Close the modal automatically once the user is authenticated
  React.useEffect(() => {
    if (authStatus === 'authenticated') {
      onClose()
    }
  }, [authStatus, onClose])

  const titleByRoute: Record<string, string> = {
    signIn: 'Sign in',
    signUp: 'Create account',
    confirmSignUp: 'Confirm your email',
    confirmSignIn: 'Confirm sign-in',
    setupTOTP: 'Set up two‑factor auth',
    forceNewPassword: 'Update your password',
    resetPassword: 'Reset your password',
    verifyUser: 'Verify your account',
    signOut: 'Signing out…',
    idle: 'Sign in',
  }
  const headerTitle = titleByRoute[route ?? 'signIn'] ?? 'Sign in'

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
    <div className="modal" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="modal-header">
      <h2 style={{ margin: 0 }}>{headerTitle}</h2>
        </div>
        <div style={{ padding: '6px 2px 10px' }}>
          <Authenticator
            signUpAttributes={[ 'email' ]}
            components={{
              Header() { return null },
              Footer() { return null },
            }}
          />
        </div>
      </div>
    </div>
  )
}
