/**
 * 智序工作台 · 桌面版主进程（Electron）
 *
 * 目标：让用户在本机得到一个「双击即用」的桌面应用，同时保持网页版的一切能力。
 *
 * 关键设计：
 *  1) 后端代理（server/index.mjs）作为子进程一起启动，端口固定 8787；
 *     这样 AI 转发、天气、地理接口全部照常工作，且密钥仍只留在本机。
 *  2) 窗口加载 http://127.0.0.1:8787（后端同时托管 dist/ 产物），
 *     因此网页版本地运行与桌面版走的是**同一套代码、同一份数据**。
 *  3) 退出时同步关闭子进程，避免残留 node 进程占用端口。
 */
import { app, BrowserWindow, shell, Menu } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.API_PORT || 8787)

let backend = null
let win = null

function startBackend() {
  const serverEntry = path.join(ROOT, 'server', 'index.mjs')
  if (!fs.existsSync(serverEntry)) {
    console.error('未找到 server/index.mjs，无法启动本地服务')
    return
  }
  // 生产模式下把前端产物目录指到打包后的 dist/
  const env = { ...process.env, API_PORT: String(PORT), API_HOST: '127.0.0.1' }
  if (!env.DIST_DIR) env.DIST_DIR = 'dist'
  backend = spawn(process.execPath, [serverEntry], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  backend.stdout.on('data', (d) => console.log('[api]', String(d).trim()))
  backend.stderr.on('data', (d) => console.error('[api:err]', String(d).trim()))
  backend.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error('本地服务退出，code=', code)
    backend = null
  })
}

function stopBackend() {
  if (!backend) return
  try {
    backend.kill()
  } catch {
    /* 忽略 */
  }
  backend = null
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: '智序工作台',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 本地文件导入（课表）需要读取用户拖入/选择的文件路径
      webSecurity: true,
    },
  })

  // 外部链接一律交给系统浏览器，避免应用内被导航走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  const url = `http://127.0.0.1:${PORT}`
  void win.loadURL(url)

  // 后端可能还没监听完，失败时稍后重试
  win.webContents.on('did-fail-load', () => {
    setTimeout(() => {
      if (win && !win.isDestroyed()) void win.loadURL(url)
    }, 800)
  })

  win.on('closed', () => {
    win = null
  })
}

// 简洁的菜单：保留常用项，去掉 Electron 默认的冗长菜单
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [{ role: 'quit', label: '退出' }],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于智序工作台',
          click: () => {
            void shell.openExternal('https://www.workbuddy.cn/docs/workbuddy/Overview')
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    startBackend()
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    stopBackend()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    stopBackend()
  })
}
