/**
 * 提交/上传前的密钥扫描。
 *
 * 默认以 **git 实际跟踪的文件** 为准（git ls-files），这样和 .gitignore 保持一致，
 * 不会出现「脚本以为忽略了、其实已经 add 了」的漏扫。
 * 不在 git 仓库里时退化为目录遍历。
 *
 * 用法：npm run scan:secrets
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()

/** 取「会被提交」的文件清单 */
function trackedFiles() {
  try {
    const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split('\n').filter(Boolean).map((p) => path.join(ROOT, p))
  } catch {
    return null
  }
}

/** 退化方案：按目录遍历（跳过常见忽略项） */
function walkFiles() {
  const IGNORE_DIRS = new Set([
    'node_modules', '.git', '.local', 'share', 'release', '.tmp-test', '.workbuddy',
  ])
  const IGNORE_FILE_RE = /\.(tgz|log|png|jpg|jpeg|webp|ico|woff2?|ttf|eot)$/i
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (IGNORE_DIRS.has(e.name)) continue
      if (e.isDirectory()) {
        if (/^dist/.test(e.name)) continue
        walk(path.join(d, e.name))
      } else if (!IGNORE_FILE_RE.test(e.name)) {
        out.push(path.join(d, e.name))
      }
    }
  }
  walk(ROOT)
  return out
}

const fromGit = trackedFiles()
const files = (fromGit ?? walkFiles()).filter((f) => {
  try {
    return fs.statSync(f).isFile()
  } catch {
    return false
  }
})

const PATTERNS = [
  ['NVIDIA Key', /nvapi-[A-Za-z0-9_\-]{16,}/g],
  ['OpenAI/DeepSeek Key', /\bsk-[A-Za-z0-9_\-]{20,}/g],
  ['智谱 Key', /\b[0-9a-f]{8}\.[0-9a-f]{24,}/g],
  ['Anthropic Key', /\bsk-ant-[A-Za-z0-9_\-]{20,}/g],
  ['GitHub Token', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['AWS Access Key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['私钥块', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ['JWT', /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g],
  ['Bearer 硬编码', /Bearer\s+[A-Za-z0-9_\-\.]{24,}/g],
]

const SENSITIVE_PATH_RE = /(^|[\\/])(\.local|\.env|\.pem$)|(^|[\\/])ai-config\.json$|credential/i

let hits = 0
for (const f of files) {
  const rel = path.relative(ROOT, f)
  if (SENSITIVE_PATH_RE.test(rel) && !/example\.json$/i.test(rel)) {
    hits++
    console.log('X 敏感路径  ' + rel)
    continue
  }
  let text
  try {
    const buf = fs.readFileSync(f)
    if (buf.length > 2_000_000) continue
    text = buf.toString('utf8')
  } catch {
    continue
  }
  for (const [label, re] of PATTERNS) {
    const m = text.match(re)
    if (m) {
      hits++
      const lineNo = text.slice(0, text.indexOf(m[0])).split('\n').length
      console.log('X ' + label + '  ' + rel + ':' + lineNo + '  命中 ' + m.length + ' 处')
    }
  }
}

console.log('')
console.log('---- 汇总 ----')
console.log('来源：', fromGit ? 'git ls-files（与 .gitignore 一致）' : '目录遍历（非 git 仓库）')
console.log('扫描文件数：', files.length)
console.log(hits === 0 ? 'OK 未发现密钥，可以提交' : 'X 发现 ' + hits + ' 处疑似密钥，请先处理再提交')
