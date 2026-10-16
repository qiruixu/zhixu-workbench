#!/usr/bin/env node
/**
 * 生成「可安全分发」的源码包。
 *
 * 会做三件事：
 *  1) 复制项目到 share/zhixu-workbench/，排除 node_modules、构建产物、.git、
 *     以及最关键的 .local/（内含明文 API Key）；
 *  2) 扫描复制结果，若发现任何疑似密钥（nvapi-… / sk-…）立即判定失败并清空提示；
 *  3) 打印分发说明。
 *
 * 用法：npm run pack:share
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_ROOT = path.join(ROOT, 'share')
const OUT = path.join(OUT_ROOT, 'zhixu-workbench')

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-app',
  'dist-app2',
  'dist-app3',
  '.local', // ← 含明文密钥，绝不能进分享包
  '.git',
  '.workbuddy',
  'share',
])
const EXCLUDE_FILES = new Set(['package-lock.json'])

const SECRET_RE = /(nvapi-[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{24,})/g

function shouldSkip(entryName, isDir) {
  if (isDir) return EXCLUDE_DIRS.has(entryName)
  return EXCLUDE_FILES.has(entryName) || entryName.endsWith('.log')
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** 扫描疑似密钥；返回 [{ file, sample }] */
function scanSecrets(dir) {
  const hits = []
  for (const file of walk(dir)) {
    let text
    try {
      text = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    if (SECRET_RE.test(text)) {
      SECRET_RE.lastIndex = 0
      const m = text.match(SECRET_RE)
      hits.push({ file: path.relative(dir, file), sample: m ? `${m[0].slice(0, 10)}…` : '?' })
    }
    SECRET_RE.lastIndex = 0
  }
  return hits
}

function main() {
  let out = OUT
  if (fs.existsSync(out)) {
    try {
      fs.rmSync(out, { recursive: true, force: true })
    } catch {
      // 某些受管环境会拦截删除操作：改为写入一个带时间戳的新目录
      out = path.join(OUT_ROOT, `zhixu-workbench-${Date.now().toString(36)}`)
      console.log('（旧输出无法清理，改为写入新目录）')
    }
  }
  console.log('打包可分发源码 →', path.relative(ROOT, out))
  fs.mkdirSync(out, { recursive: true })

  // 逐项复制：避免把目录复制进自身子目录（Node 会直接报错）
  let copied = 0
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (shouldSkip(entry.name, entry.isDirectory())) continue
    fs.cpSync(path.join(ROOT, entry.name), path.join(out, entry.name), { recursive: true })
    copied++
  }
  console.log(`已复制 ${copied} 个顶层条目`)

  // 二次确认：分享包里必须没有 .local
  const leakedDir = fs.existsSync(path.join(out, '.local'))
  const secrets = scanSecrets(out)

  if (leakedDir || secrets.length > 0) {
    console.error('\n✗ 安全检查未通过，已中止分发：')
    if (leakedDir) console.error('  · 分享包中出现了 .local/ 目录（含密钥）')
    for (const s of secrets) console.error(`  · ${s.file} 中发现疑似密钥：${s.sample}`)
    console.error('请检查后再试。')
    process.exit(1)
  }

  const files = walk(out)
  console.log(`✓ 已生成，共 ${files.length} 个文件，未检出任何密钥。\n`)
  console.log('--- 分发给他人 ---')
  console.log('1) 把 share/zhixu-workbench 压缩后发给对方（不要连 .local/ 一起发）')
  console.log('2) 对方解压后执行： npm install && npm run dev')
  console.log('3) 对方打开 http://localhost:5173，到「AI 配置」填入自己的 API Key')
  console.log('   （或按 README 5.1 用 .local/ai-config.json 免配置启动）')
  console.log('\n注意：导航数据与 API Key 都存在各自的浏览器里，互不可见。')
}

main()
