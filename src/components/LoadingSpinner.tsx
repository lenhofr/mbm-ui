import CookSpinner from './CookSpinner'
import './LoadingSpinner.css'

export type LoadingSpinnerProps = {
  size?: number
  message?: string
}

export default function LoadingSpinner({ size = 48, message = 'Loading...' }: LoadingSpinnerProps) {
  return (
    <div className="loading-spinner-container">
      <div className="loading-spinner">
        <CookSpinner size={size} />
      </div>
      {message && <p className="loading-message">{message}</p>}
    </div>
  )
}
