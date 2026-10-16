import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * 「单文件版」构建配置。
 *
 * 为什么单独一份配置：
 *  - 默认构建产出的是 **ES module**，module 语义在 `file://` 下受限（双击打开 html 时
 *    脚本不执行）。改为 **IIFE** 后不依赖 module，可安全内联进单个 HTML，双击即用。
 *  - 关闭代码分割（inlineDynamicImports），保证产物只有一个 JS，便于内联。
 *
 * 单文件版固定为「直连模式 + Hash 路由」，因此这里用 define 写死，
 * `npm run build:single` 在任意平台都不需要设置环境变量。
 */
export default defineConfig({
  // 产物内联后不再依赖外部路径，用相对 base 即可
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    // 无后端直连：AI/天气由浏览器直接请求服务商与公开数据源
    'import.meta.env.VITE_DIRECT': '"1"',
    // file:// 下 BrowserRouter 拿到的 pathname 是磁盘路径，必须用 HashRouter
    'import.meta.env.VITE_HASH_ROUTER': '"1"',
  },
  build: {
    outDir: 'dist-single',
    // 不自动清空目录：本机对已存在产物目录的删除有安全限制；
    // 产物文件名固定（app.js），直接覆盖即可。
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})
