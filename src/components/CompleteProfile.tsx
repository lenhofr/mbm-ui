import React from 'react'
import { getCurrentUser, updateUserAttributes } from 'aws-amplify/auth'
import '../auth/amplify'

type Props = {
  visible: boolean
  onClose: () => void
  onSaved?: () => void
}

export default function CompleteProfile({ visible, onClose, onSaved }: Props) {
  const [nickname, setNickname] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const user = await getCurrentUser()
        // no direct attributes from getCurrentUser; rely on caller to gate by missing nickname
        if (!mounted) return
        setError(null)
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message || 'Not signed in')
      }
    })()
    return () => { mounted = false }
  }, [])

  if (!visible) return null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const name = nickname.trim()
    if (!name) { setError('Please enter a display name'); return }
    setLoading(true)
    setError(null)
    try {
      await updateUserAttributes({ userAttributes: { nickname: name } })
      onSaved?.()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Complete your profile</h2>
        </div>
        <form onSubmit={save} style={{ padding: '6px 2px 10px' }}>
          <label>
            Display name
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="What should we call you?" />
          </label>
          {error && <p style={{ color: 'var(--destructive)' }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} disabled={loading}>Skip</button>
            <button type="submit" className="primary" disabled={loading}>{loading ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
