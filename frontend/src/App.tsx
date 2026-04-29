import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import MainPage from './pages/MainPage'
import SttPage from './pages/SttPage'
import LlmPage from './pages/LlmPage'
import TtsPage from './pages/TtsPage'
import RolesPage from './pages/RolesPage'
import { useHealthCheck } from './hooks/useHealthCheck'
import { useLauncherStatus } from './hooks/useLauncherStatus'

export default function App() {
  useHealthCheck(5000)
  useLauncherStatus(2500)

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<MainPage />} />
        <Route path="/stt" element={<SttPage />} />
        <Route path="/llm" element={<LlmPage />} />
        <Route path="/tts" element={<TtsPage />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
