/**
 * 智序工作台 · 本地 AI 转发后端
 *
 * 作用：
 *  1) 解决浏览器直连各 AI 服务商的跨域（CORS）问题；
 *  2) 让用户的 API Key 只经由本机进程转发到「用户自己指定的」服务商地址，
 *     不会流向任何第三方服务器；
 *  3) 生产模式下同时托管前端静态产物（dist/），实现单进程启动。
 *
 * 安全约束（务必保持）：
 *  - 仅监听 127.0.0.1，外部网络无法访问；
 *  - CORS 只放行 localhost / 127.0.0.1 来源；
 *  - 仅允许 http/https 协议；
 *  - 日志中一律不打印请求头与 API Key（统一脱敏）。
 *
 * 端口：API_PORT（默认 8787）
 */
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
// 默认托管 dist/；可用 DIST_DIR 指定其它产物目录
const DIST = path.resolve(ROOT, process.env.DIST_DIR || 'dist')
const PORT = Number(process.env.API_PORT || 8787)
const HOST = process.env.API_HOST || '127.0.0.1'
// 本地引导配置（含密钥，已在 .gitignore 中排除；只在本机 127.0.0.1 下发）
const BOOTSTRAP_FILE = process.env.BOOTSTRAP_FILE
  ? path.resolve(process.env.BOOTSTRAP_FILE)
  : path.join(ROOT, '.local', 'ai-config.json')

const app = express()
app.disable('x-powered-by')

// --- CORS：仅本机来源 ---
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
app.use(
  cors({
    origin(origin, cb) {
      // 无 Origin（curl / 同源）直接放行；有 Origin 必须是本机
      if (!origin || LOCAL_ORIGIN.test(origin)) return cb(null, true)
      return cb(null, false)
    },
    credentials: false,
  })
)

app.use(express.json({ limit: '32mb' }))

/** 请求日志脱敏：绝不打印 headers / body 中的敏感信息 */
function safeLog(...args) {
  console.log('[api]', ...args)
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'zhixu-workbench-proxy', time: new Date().toISOString() })
})

/**
 * 本地引导配置：GET /api/bootstrap
 * 读取 .local/ai-config.json（若存在）并下发给前端。
 * 这样任何浏览器首次打开时都能自动完成 AI 配置，无需手动录入。
 * 注意：该文件含明文密钥，已加入 .gitignore，且服务仅监听 127.0.0.1。
 */
app.get('/api/bootstrap', (req, res) => {
  // 只允许本机访问：防止被反向代理 / 容器转发到公网而泄露密钥
  const addr = req.socket.remoteAddress || ''
  const isLoopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  if (!isLoopback) {
    return res.status(403).json({ ok: false, reason: 'forbidden' })
  }
  try {
    if (!fs.existsSync(BOOTSTRAP_FILE)) {
      return res.json({ ok: false, reason: 'not-found' })
    }
    const raw = fs.readFileSync(BOOTSTRAP_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    // 指纹：前端据此判断是否需要重新应用（避免用户删除后又被恢复）
    const fingerprint = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)
    safeLog(`下发本地引导配置（指纹 ${fingerprint}）`)
    res.json({ ok: true, fingerprint, config: parsed })
  } catch {
    res.json({ ok: false, reason: 'invalid' })
  }
})

/* ---------------- 天气 / 地理位置（免密钥数据源） ----------------
 * 数据来源：
 *   · 地理编码 / 天气预报：Open-Meteo（无需 API Key）
 *   · 经纬度反查城市名：BigDataCloud（免费客户端接口）
 * 说明：使用「定位」时会把经纬度发送给上述第三方服务；不使用定位、改用手动选城市时可避免。
 * 这里统一放在后端转发，前端只与本机通信。
 */

const cache = new Map() // key -> { exp, data }
function cached(key, ttlMs, loader) {
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.data)
  return Promise.resolve()
    .then(loader)
    .then((data) => {
      cache.set(key, { exp: Date.now() + ttlMs, data })
      return data
    })
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  return res.json()
}

function readLatLon(req) {
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

/**
 * 把一段中文「行政后缀」去掉：南京 → 南、南京市 → 南京。
 * Open-Meteo 的地名字段很杂（有时是「南京」有时是「南京市」），
 * 统一后既方便与县/区名合并，也能避免「南京市 江苏省」这种重复。
 */
function stripAdminSuffix(s) {
  return String(s || '')
    .replace(/[市省州地区县镇乡村]$/u, '')
    .trim()
}

/** 城市搜索 */
app.get('/api/geo/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.status(400).json({ ok: false, error: '缺少 q 参数' })
  try {
    // 先按原词搜；搜不到再退化（「鼓楼区」→「鼓楼」），Open-Meteo 的区县级搜索对后缀敏感
    const run = async (term) => {
      const data = await cached(`geo:${term}`, 24 * 3600 * 1000, () =>
        getJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=8&language=zh&format=json`
        )
      )
      return data.results || []
    }
    let results = await run(q)
    if (!results.length && q.length > 1) {
      const stripped = q.replace(/[市省州地区县]$/u, '')
      if (stripped && stripped !== q) results = await run(stripped)
    }
    const out = results.map((r) => {
      const city = stripAdminSuffix(r.admin2)
      const district = stripAdminSuffix(r.name)
      // name 与上级市同名（如「南京」在 admin2=南京 之下）说明它是市级结果，不是区县
      const isCityLevel = !city || city === district
      return {
        name: isCityLevel ? district : district,
        region: isCityLevel ? stripAdminSuffix(r.admin1) : `${stripAdminSuffix(r.admin1)}·${city}`,
        country: r.country || '',
        lat: r.latitude,
        lon: r.longitude,
        /** 是否为区县级（用于界面展示「区」角标） */
        district: !isCityLevel,
      }
    })
    res.json({ ok: true, results: out })
  } catch {
    res.status(502).json({ ok: false, error: '城市搜索服务暂时不可用' })
  }
})

/** 经纬度 → 城市名（失败不算致命，前端可回退为坐标） */
app.get('/api/geo/reverse', async (req, res) => {
  const pos = readLatLon(req)
  if (!pos) return res.status(400).json({ ok: false, error: '缺少或非法的 lat/lon' })
  try {
    // localityLanguage 用 zh-Hans 才返回简体（zh 会返回「鼓樓區」这类繁体）
    const d = await cached(
      `rev:${pos.lat.toFixed(3)},${pos.lon.toFixed(3)}`,
      24 * 3600 * 1000,
      () =>
        getJson(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.lat}&longitude=${pos.lon}&localityLanguage=zh-Hans`
        )
    )
    // locality 一般是区/县级（adminLevel 6），city 是地级市（adminLevel 5）
    const district = stripAdminSuffix(d.locality)
    const city = stripAdminSuffix(d.city)
    res.json({
      ok: true,
      // name 优先取区/县，让用户看到「鼓楼」而不是「南京」
      name: district || city || stripAdminSuffix(d.principalSubdivision),
      region: city || stripAdminSuffix(d.principalSubdivision),
      country: d.countryName || '',
      district,
      city,
      lat: pos.lat,
      lon: pos.lon,
    })
  } catch {
    res.json({
      ok: false,
      name: '',
      region: '',
      country: '',
      district: '',
      city: '',
      lat: pos.lat,
      lon: pos.lon,
    })
  }
})

/** 当前天气 + 未来 7 天 */
app.get('/api/weather', async (req, res) => {
  const pos = readLatLon(req)
  if (!pos) return res.status(400).json({ ok: false, error: '缺少或非法的 lat/lon' })

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m` +
    `&hourly=temperature_2m,weather_code,precipitation_probability` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=7`

  try {
    const d = await cached(`wx:${pos.lat.toFixed(2)},${pos.lon.toFixed(2)}`, 10 * 60 * 1000, () =>
      getJson(url)
    )
    res.json({
      ok: true,
      lat: pos.lat,
      lon: pos.lon,
      timezone: d.timezone,
      current: {
        time: d.current?.time,
        temp: d.current?.temperature_2m,
        feelsLike: d.current?.apparent_temperature,
        humidity: d.current?.relative_humidity_2m,
        precipitation: d.current?.precipitation,
        windSpeed: d.current?.wind_speed_10m,
        isDay: d.current?.is_day === 1,
        code: d.current?.weather_code,
      },
      hourly: {
        time: d.hourly?.time ?? [],
        temp: d.hourly?.temperature_2m ?? [],
        code: d.hourly?.weather_code ?? [],
        pop: d.hourly?.precipitation_probability ?? [],
      },
      daily: {
        time: d.daily?.time ?? [],
        code: d.daily?.weather_code ?? [],
        max: d.daily?.temperature_2m_max ?? [],
        min: d.daily?.temperature_2m_min ?? [],
        pop: d.daily?.precipitation_probability_max ?? [],
      },
    })
  } catch {
    res.status(502).json({ ok: false, error: '天气服务暂时不可用，请稍后重试' })
  }
})

/**
 * 通用转发：POST /api/ai/request
 * body: { url, method?, headers?, body? }
 * 仅转发到调用方显式给出的 url（即用户自己配置的服务商地址）。
 */
app.post('/api/ai/request', async (req, res) => {
  const { url, method = 'POST', headers = {}, body } = req.body || {}

  let target
  try {
    target = new URL(url)
  } catch {
    return res.status(400).json({ error: { type: 'proxy', message: '目标 URL 非法' } })
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: { type: 'proxy', message: '仅支持 http/https 协议' } })
  }
  if (target.hostname === 'localhost' || target.hostname === '127.0.0.1') {
    // 允许本地模型（Ollama 等）
  }

  // 客户端断开时中止上游请求。
  // 注意：必须监听 res 的 close，而不是 req 的 close —— 后者在请求体读取完成后
  // 就会触发，会导致上游请求被立刻中止（这是一个很容易踩的坑）。
  const ac = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) ac.abort()
  })
  const timer = setTimeout(() => ac.abort(), 5 * 60 * 1000) // 5 分钟上限

  const outHeaders = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (typeof v === 'string' && k.toLowerCase() !== 'host' && k.toLowerCase() !== 'content-length') {
      outHeaders[k] = v
    }
  }

  const payload =
    body === undefined || body === null
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body)

  if (payload && !Object.keys(outHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    outHeaders['Content-Type'] = 'application/json'
  }

  safeLog(`${method} -> ${target.origin}${target.pathname}`)

  let upstream
  try {
    upstream = await fetch(target.toString(), {
      method,
      headers: outHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : payload,
      signal: ac.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    const aborted = err?.name === 'AbortError'
    return res.status(aborted ? 499 : 502).json({
      error: {
        type: aborted ? 'aborted' : 'network',
        message: aborted
          ? '请求已取消或超时'
          : `无法连接服务商地址：${err?.message || '未知网络错误'}`,
      },
    })
  }

  // 透传状态与内容类型
  res.status(upstream.status)
  const ct = upstream.headers.get('content-type')
  if (ct) res.setHeader('Content-Type', ct)
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  if (!upstream.body) {
    clearTimeout(timer)
    return res.end()
  }

  try {
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } catch {
    /* 上游中断，直接结束响应 */
  } finally {
    clearTimeout(timer)
    res.end()
  }
})

// --- 生产模式：托管前端产物 ---
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false }))
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

const server = http.createServer(app)
server.listen(PORT, HOST, () => {
  safeLog(`已启动：http://${HOST}:${PORT}`)
  if (fs.existsSync(DIST)) safeLog('已检测到 dist/，将同时托管前端页面')
  else safeLog('未检测到 dist/（开发模式由 Vite 提供前端页面）')
  safeLog(
    fs.existsSync(BOOTSTRAP_FILE)
      ? '已检测到本地引导配置 .local/ai-config.json，新浏览器打开将自动完成 AI 配置'
      : '未检测到 .local/ai-config.json（AI 配置需在页面内手动填写）'
  )
})
