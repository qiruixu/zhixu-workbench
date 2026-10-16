import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
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

/**
 * 单文件版（构建时 VITE_HASH_ROUTER=1）改用 HashRouter：
 * 用 file:// 双击打开时，BrowserRouter 读到的 pathname 是磁盘路径（/D:/.../xxx.html），
 * 匹配不到任何路由，会被 `path="*"` 兜底重定向到根而白屏；HashRouter 用 #/chat 这种
 * 片段标记，在 file:// 下完全可用。
 */
const useHashRouter = import.meta.env.VITE_HASH_ROUTER === '1'

const content = (
  <AppProvider>
    <App />
  </AppProvider>
)

// 示例数据写入与本地引导配置，统一在 AppProvider 初始化时按顺序执行
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useHashRouter ? (
      <HashRouter>{content}</HashRouter>
    ) : (
      <BrowserRouter basename={basename}>{content}</BrowserRouter>
    )}
  </StrictMode>
)
