import React from 'react'
import { IconClose } from '../icons/Icons'
import { Authenticator } from '@aws-amplify/ui-react'
import { Hub } from 'aws-amplify/utils'
import '@aws-amplify/ui-react/styles.css'
import '../auth/amplify'
import { useScrollLock } from '../hooks/useScrollLock'

type Props = {
  visible: boolean
  onClose: () => void
}

export default function LoginModal({ visible, onClose }: Props) {
  useScrollLock(visible)

  if (!visible) return null

  // Auto-close the modal after a successful sign-in using Amplify Hub events
  React.useEffect(() => {
    const unsubscribe = Hub.listen('auth', (data: { payload?: { event?: string } }) => {
      if (data?.payload?.event === 'signedIn') onClose()
    })
    return unsubscribe
  }, [onClose])

  const headerTitle = 'Welcome back to the kitchen!'

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
  <div className="modal auth-modal" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>{headerTitle}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close" style={{marginLeft:'auto'}}>
            <IconClose size={18} weight="regular" />
          </button>
        </div>
        <div style={{ padding: '6px 2px 10px' }}>
          <Authenticator
            signUpAttributes={['email', 'nickname'] as any}
            formFields={{
              signUp: {
                'custom:invite': {
                  label: 'Invite code',
                  placeholder: 'Enter your invite code',
                  isRequired: true,
                  order: 1,
                },
                nickname: {
                  label: 'What should we call you in the kitchen?',
                  placeholder: 'Enter your user name',
                  isRequired: false,
                  order: 2,
                },
                email: { order: 3 },
                password: { order: 4 },
                confirm_password: { order: 5 },
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
