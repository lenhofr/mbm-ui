import React, { useEffect } from 'react'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from '../state/AppContext'
import { AddSheet } from '../components/AddSheets'
import { ScanReviewScreen } from './ImportScreens'

// Signed in, so "Read recipe" isn't stopped by the login prompt.
vi.mock('../hooks/useCognitoAuth', () => ({
  useCognitoAuth: () => ({
    isAuthed: true, loading: false, user: { sub: 'u1' }, authHeader: () => ({}),
    signIn: vi.fn(), signOut: vi.fn(), signUp: vi.fn(), confirmSignUp: vi.fn(), refresh: vi.fn(),
  }),
}))

function ImportStub() {
  const app = useApp()
  useEffect(() => { app.setScanPages([]) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  return <div>processing {app.importJob?.kind} {app.importJob?.kind === 'scan' ? app.importJob.files.length : 0}</div>
}

function OpenAdd() {
  const app = useApp()
  useEffect(() => { app.setSheet('add') }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  return <div>home</div>
}

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

describe('scan flow', () => {
  beforeAll(() => {
    let n = 0
    URL.createObjectURL = () => `blob:test-${n++}`
  })

  it('Scan opens the camera directly, then the review screen can add the back and retake', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProvider>
          <Routes>
            <Route path="/" element={<OpenAdd />} />
            <Route path="/scan" element={<ScanReviewScreen />} />
            <Route path="/import" element={<ImportStub />} />
          </Routes>
          <AddSheet />
        </AppProvider>
      </MemoryRouter>,
    )
    expect(screen.queryByText(/Found one in Safari/)).not.toBeInTheDocument()
    await screen.findByText('Scan a recipe card')
    const camera = () => container.querySelector('input[capture]') as HTMLInputElement
    fireEvent.change(camera(), { target: { files: [photo('front.jpg')] } })

    expect(await screen.findByText('Front of card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /add back of card/i }))
    fireEvent.change(camera(), { target: { files: [photo('back.jpg')] } })
    expect(screen.getByText('Front and back')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add back of card/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /retake back/i }))
    fireEvent.change(camera(), { target: { files: [photo('back2.jpg')] } })
    expect(screen.getAllByRole('img')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /read recipe/i }))
    expect(await screen.findByText('processing scan 2')).toBeInTheDocument()
    expect(screen.queryByText('home')).not.toBeInTheDocument()
  })
})
