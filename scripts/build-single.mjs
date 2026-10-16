#!/usr/bin/env node
/**
 * 把 `dist-single` 的构建产物内联成**单文件 HTML**（双击即用、不需要任何环境）。
 *
 * 配合 `vite.single.config.ts` 使用：`npm run build:single`
 *
 * 三个关键点（都踩过坑）：
 *  1. 打包产物必须是 IIFE，内联时要**去掉 `type="module"`**——module 语义在 `file://` 下受限，
 *     双击打开时脚本根本不会执行；
 *  2. 内联脚本要放到 **`</body>` 之前**：普通脚本在 `<head>` 里是同步执行的，那时
 *     `<div id="root">` 还没被解析出来，`createRoot` 拿到 null 会报 React error #299；
 *  3. 内联 JS 里的 `</script>` 必须转义；且改写 HTML 时**替换值要用函数形式**——
 *     字符串替换值中的 `$&`、`$'` 会被当作特殊语法解释，而打包后的 JS 里含这类 `$` 序列，
 *     会直接把代码替换坏（曾导致 `SyntaxError: Unexpected identifier 'object'`）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist-single')
const OUT = path.join(ROOT, 'zhixu-workbench.html')

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`未找到 ${DIST}/index.html，请先执行：vite build --config vite.single.config.ts`)
  process.exit(1)
}

const read = (href) => fs.readFileSync(path.join(DIST, href.replace(/^\.?\//, '')), 'utf8')

let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
let jsCount = 0
let cssCount = 0
const scripts = []

// 内联 CSS（若样式被单独输出成文件）
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  cssCount++
  return `<style>\n${read(href)}\n</style>`
})

// 摘出 JS：丢弃原属性（type="module" / crossorigin），稍后统一放到 body 末尾
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
  jsCount++
  scripts.push(read(src).replace(/<\/script>/gi, '<\\/script>'))
  return ''
})

const tags = scripts.map((code) => `<script>\n${code}\n</script>`).join('\n')
html = html.includes('</body>')
  ? html.replace('</body>', () => `${tags}\n</body>`)
  : html + tags

html = html.replace('<title>智序工作台</title>', () => '<title>智序工作台（单文件版 · 双击即用）</title>')

fs.writeFileSync(OUT, html)

const left = html.match(/<script[^>]*src=|<link[^>]*href="(?!#|data:)/g)
console.log(`内联 ${jsCount} 个脚本、${cssCount} 个样式文件（脚本置于 body 末尾）`)
console.log(`生成 ${OUT}（${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB）`)
console.log('残留外部引用：', left ? left.join(' | ') : '无')
