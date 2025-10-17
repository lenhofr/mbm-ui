import React from 'react'
import { Authenticator } from '@aws-amplify/ui-react'
import { Hub } from 'aws-amplify/utils'
import '@aws-amplify/ui-react/styles.css'
import '../auth/amplify'

type Props = {
  visible: boolean
  onClose: () => void
}

export default function LoginModal({ visible, onClose }: Props) {
  if (!visible) return null

  // Use a global counter to manage scroll lock across multiple modals
  function lockScroll() {
    const w = window as any
    w.__modalCount = (w.__modalCount || 0) + 1
    if (w.__modalCount === 1) {
      document.documentElement.classList.add('modal-open')
      document.body.classList.add('modal-open')
    }
  }
  function unlockScroll() {
    const w = window as any
    w.__modalCount = Math.max(0, (w.__modalCount || 0) - 1)
    if (w.__modalCount === 0) {
      document.documentElement.classList.remove('modal-open')
      document.body.classList.remove('modal-open')
    }
  }
  React.useEffect(() => {
    lockScroll()
    return () => {
      unlockScroll()
    }
  }, [])

  // Auto-close the modal after a successful sign-in using Amplify Hub events
  React.useEffect(() => {
    const unsubscribe = Hub.listen('auth', (data: { payload?: { event?: string } }) => {
      if (data?.payload?.event === 'signedIn') onClose()
    })
    return unsubscribe
  }, [onClose])

  const headerTitle = 'Sign in'

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
            formFields={{
              signUp: {
                'custom:invite': {
                  label: 'Invite code',
                  placeholder: 'Enter your invite code',
                  isRequired: true,
                  order: 1,
                },
                email: { order: 2 },
                password: { order: 3 },
                confirm_password: { order: 4 },
              },
            }}
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
