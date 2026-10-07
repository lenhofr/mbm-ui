import React, { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './state/AppContext'
import HomeScreen from './screens/HomeScreen'
import DetailScreen from './screens/DetailScreen'
import CookScreen from './screens/CookScreen'
import { EditRecipeScreen, NewRecipeScreen } from './screens/EditorScreen'
import { ScanReviewScreen, ProcessingScreen, ScanFailedScreen } from './screens/ImportScreens'
import TabBar from './components/TabBar'
import { AddSheet, PasteSheet } from './components/AddSheets'
import { Toast } from './components/ui'
import LoginModal from './components/LoginModal'
import CompleteProfile from './components/CompleteProfile'

export type { Recipe } from './types'

function Shell() {
  const app = useApp()
  const { pathname } = useLocation()
  const showTabs = pathname === '/' || pathname === '/favorites'
  const [showProfile, setShowProfile] = useState(false)

  // Prompt to complete profile if signed in and no display name
  useEffect(() => { setShowProfile(app.auth.isAuthed && !app.displayName) }, [app.auth.isAuthed, app.displayName])

  return (
    <div className="mbm">
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/favorites" element={<HomeScreen key="fav" favoritesOnly />} />
        <Route path="/recipe/:id" element={<DetailScreen />} />
        <Route path="/recipe/:id/cook" element={<CookScreen />} />
        <Route path="/recipe/:id/edit" element={<EditRecipeScreen />} />
        <Route path="/new" element={<NewRecipeScreen />} />
        <Route path="/scan" element={<ScanReviewScreen />} />
        <Route path="/import" element={<ProcessingScreen />} />
        <Route path="/import/failed" element={<ScanFailedScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {showTabs && <TabBar onAdd={() => app.requireLogin() && app.setSheet('add')} />}
      <AddSheet />
      <PasteSheet />
      <Toast msg={app.toastMsg} />

      {app.showLogin && !app.auth.isAuthed && <LoginModal visible onClose={() => app.setShowLogin(false)} />}
      <CompleteProfile visible={showProfile} onClose={() => setShowProfile(false)} onSaved={() => app.auth.refresh()} />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  )
}
