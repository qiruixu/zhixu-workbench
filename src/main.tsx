import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AppProvider } from './store/AppStore'

/**
 * 路由 basename：
 * - 本地开发 / 根路径部署：BASE_URL 为 `/`，basename 取 `/`；
 * - 部署到子路径（如 GitHub Pages 的 /zhixu-workbench/）：构建时用 `--base=/zhixu-workbench/`，
 *   basename 随之取该子路径，路由才能正确匹配（否则会被 `*` 兜底重定向回根，导致 404）。
 */
const rawBase = import.meta.env.BASE_URL || '/'
const basename = rawBase === './' || rawBase === '' ? '/' : rawBase.replace(/\/+$/, '') || '/'

// 示例数据写入与本地引导配置，统一在 AppProvider 初始化时按顺序执行
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>
)
