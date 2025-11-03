import { CircleNotch } from 'phosphor-react'
import './LoadingSpinner.css'

export type LoadingSpinnerProps = {
  size?: number
  message?: string
}

export default function LoadingSpinner({ size = 48, message = 'Loading...' }: LoadingSpinnerProps) {
  return (
    <div className="loading-spinner-container">
      <div className="loading-spinner">
        <CircleNotch size={size} weight="bold" />
      </div>
      {message && <p className="loading-message">{message}</p>}
    </div>
  )
}
