import React, { forwardRef } from 'react'

/**
 * Hidden file input that opens the native iOS/Android camera. Call `.click()` on the ref
 * from a tap handler (browsers only allow it during a user gesture).
 */
const CameraInput = forwardRef<HTMLInputElement, { onFile: (file: File) => void }>(function CameraInput({ onFile }, ref) {
  return (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      onChange={e => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) onFile(f)
      }}
    />
  )
})

export default CameraInput

export const toPage = (file: File) => ({ file, url: URL.createObjectURL(file) })
