import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import Workbench from './pages/Workbench'
import ChatPage from './pages/ChatPage'
import AIConfigPage from './pages/AIConfigPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Workbench />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="ai" element={<AIConfigPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
