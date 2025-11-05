import React, { useState } from 'react'
import { CircleNotch } from 'phosphor-react'
import CookSpinner from './CookSpinner'
import './RecipeImage.css'

export type RecipeImageProps = {
  src?: string
  alt: string
}

export default function RecipeImage({ src, alt }: RecipeImageProps) {
  const [isLoading, setIsLoading] = useState(!!src)
  const [hasError, setHasError] = useState(false)

  if (!src || hasError) {
    return <div className="recipe-image-placeholder">No Image</div>
  }

  return (
    <>
      {isLoading && (
        <div className="recipe-image-loading">
          {/* Fun cook-themed spinner; fallback notch if needed */}
          <CookSpinner size={28} />
        </div>
      )}
      <img
        src={src}
        alt={alt}
  loading="lazy"
  decoding="async"
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false)
          setHasError(true)
        }}
        style={{ opacity: isLoading ? 0 : 1, transition: 'opacity 0.3s ease-in-out' }}
      />
    </>
  )
}
