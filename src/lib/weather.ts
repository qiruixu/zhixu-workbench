/** 天气 / 定位：数据经本机后端转发到免密钥的公开数据源 */
import type { LucideIcon } from 'lucide-react'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Moon,
  Snowflake,
  Sun,
} from 'lucide-react'
import { db } from './db'
import { IS_DIRECT } from './ai/adapter'

/** 部署版直连第三方时复用：去掉行政后缀，与后端保持一致 */
function stripAdminSuffix(s: unknown): string {
  return String(s || '')
    .replace(/[市省州地区县镇乡村]$/u, '')
    .trim()
}

/** 直连第三方数据源（部署版）：直接 fetch 并解析 JSON，错误抛中文提示 */
async function directJson(url: string, fallbackMsg: string): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch {
    throw new Error(`${fallbackMsg}：网络请求失败（可能是服务商不支持浏览器跨域）`)
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`${fallbackMsg}：未返回有效的 JSON 数据`)
  }
}

export interface GeoPlace {
  name: string
  region: string
  country: string
  lat: number
  lon: number
  /** 是否为区/县级结果（搜索接口返回，用于界面角标） */
  district?: boolean
}

export interface WeatherLocation extends GeoPlace {
  source: 'geo' | 'manual'
  updatedAt: number
}

export interface WeatherNow {
  time?: string
  temp?: number
  feelsLike?: number
  humidity?: number
  precipitation?: number
  windSpeed?: number
  isDay?: boolean
  code?: number
}

export interface WeatherData {
  timezone: string
  current: WeatherNow
  hourly: { time: string[]; temp: number[]; code: number[]; pop: number[] }
  daily: { time: string[]; code: number[]; max: number[]; min: number[]; pop: number[] }
}

const WMO_TEXT: Record<number, string> = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '毛毛雨',
  53: '毛毛雨',
  55: '毛毛雨',
  56: '冻毛毛雨',
  57: '冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹',
  99: '雷阵雨伴冰雹',
}

export function weatherText(code?: number): string {
  if (code === undefined || code === null) return '未知'
  return WMO_TEXT[code] ?? '未知'
}

export function weatherVisual(code?: number, isDay = true): { text: string; Icon: LucideIcon } {
  const text = weatherText(code)
  const c = code ?? -1
  let Icon: LucideIcon = isDay ? Sun : Moon
  if (c === 0) Icon = isDay ? Sun : Moon
  else if (c === 1) Icon = isDay ? CloudSun : CloudMoon
  else if (c === 2) Icon = isDay ? CloudSun : CloudMoon
  else if (c === 3) Icon = Cloudy
  else if (c === 45 || c === 48) Icon = CloudFog
  else if (c >= 51 && c <= 57) Icon = CloudDrizzle
  else if (c >= 61 && c <= 67) Icon = CloudRain
  else if (c >= 71 && c <= 77) Icon = CloudSnow
  else if (c === 80 || c === 81 || c === 82) Icon = CloudRain
  else if (c === 85 || c === 86) Icon = Snowflake
  else if (c >= 95) Icon = CloudLightning
  return { text, Icon }
}

/* ------------------------------ 接口调用 ------------------------------ */

/**
 * 取 JSON。
 * 天气接口由本机后端转发，后端没起来时 Vite 会返回 HTML，
 * 直接 res.json() 会抛出「Unexpected token '<'」这种看不懂的错，所以这里统一转成中文提示。
 */
async function getJson(url: string, fallbackMsg: string): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('无法连接本地服务，请确认本地后端正在运行（npm run dev 或 npm start）')
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`${fallbackMsg}：本地服务没有返回有效数据，通常是后端未启动`)
  }
}

export async function searchCity(q: string): Promise<GeoPlace[]> {
  if (IS_DIRECT) {
    const run = async (term: string) => {
      const d = await directJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=8&language=zh&format=json`,
        '城市搜索失败'
      )
      return (d.results as Array<Record<string, unknown>>) || []
    }
    let results = await run(q)
    if (!results.length && q.length > 1) {
      const stripped = q.replace(/[市省州地区县]$/u, '')
      if (stripped && stripped !== q) results = await run(stripped)
    }
    return results.map((r) => {
      const city = stripAdminSuffix(r.admin2)
      const district = stripAdminSuffix(r.name)
      const isCityLevel = !city || city === district
      return {
        name: district,
        region: isCityLevel ? stripAdminSuffix(r.admin1) : `${stripAdminSuffix(r.admin1)}·${city}`,
        country: String(r.country || ''),
        lat: Number(r.latitude),
        lon: Number(r.longitude),
        district: !isCityLevel,
      } as GeoPlace
    })
  }

  const data = await getJson(`/api/geo/search?q=${encodeURIComponent(q)}`, '城市搜索失败')
  if (!data.ok) throw new Error(String(data.error || '城市搜索失败'))
  return data.results as GeoPlace[]
}

export async function reverseGeo(lat: number, lon: number): Promise<GeoPlace> {
  if (IS_DIRECT) {
    const d = await directJson(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh-Hans`,
      '反查城市失败'
    )
    const district = stripAdminSuffix(d.locality)
    const city = stripAdminSuffix(d.city)
    return {
      name: district || city || stripAdminSuffix(d.principalSubdivision),
      region: city || stripAdminSuffix(d.principalSubdivision),
      country: String(d.countryName || ''),
      lat,
      lon,
      district: Boolean(district),
    }
  }

  const data = await getJson(`/api/geo/reverse?lat=${lat}&lon=${lon}`, '反查城市失败')
  return {
    name: String(data.name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`),
    region: String(data.region || ''),
    country: String(data.country || ''),
    lat,
    lon,
    district: Boolean(data.district),
  }
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  if (IS_DIRECT) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m` +
      `&hourly=temperature_2m,weather_code,precipitation_probability` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=7`
    const d = await directJson(url, '天气获取失败') as {
      timezone?: string
      current?: Record<string, unknown>
      hourly?: Record<string, unknown>
      daily?: Record<string, unknown>
    }
    return {
      timezone: String(d.timezone || ''),
      current: {
        time: d.current?.time as string | undefined,
        temp: d.current?.temperature_2m as number | undefined,
        feelsLike: d.current?.apparent_temperature as number | undefined,
        humidity: d.current?.relative_humidity_2m as number | undefined,
        precipitation: d.current?.precipitation as number | undefined,
        windSpeed: d.current?.wind_speed_10m as number | undefined,
        isDay: d.current?.is_day === 1,
        code: d.current?.weather_code as number | undefined,
      },
      hourly: {
        time: (d.hourly?.time as string[]) ?? [],
        temp: (d.hourly?.temperature_2m as number[]) ?? [],
        code: (d.hourly?.weather_code as number[]) ?? [],
        pop: (d.hourly?.precipitation_probability as number[]) ?? [],
      },
      daily: {
        time: (d.daily?.time as string[]) ?? [],
        code: (d.daily?.weather_code as number[]) ?? [],
        max: (d.daily?.temperature_2m_max as number[]) ?? [],
        min: (d.daily?.temperature_2m_min as number[]) ?? [],
        pop: (d.daily?.precipitation_probability_max as number[]) ?? [],
      },
    }
  }

  const data = await getJson(`/api/weather?lat=${lat}&lon=${lon}`, '天气获取失败')
  if (!data.ok) throw new Error(String(data.error || '天气获取失败'))
  return data as unknown as WeatherData
}

/** 浏览器定位（需要用户授权） */
export function locate(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('当前浏览器不支持定位，请手动搜索城市'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => {
        const map: Record<number, string> = {
          1: '定位权限被拒绝，可以手动搜索城市',
          2: '暂时无法获取位置，请检查系统定位服务',
          3: '定位超时，请重试或手动搜索城市',
        }
        reject(new Error(map[err.code] ?? '定位失败，请手动搜索城市'))
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    )
  })
}

/* ------------------------------ 本地存储 ------------------------------ */

const KEY = 'weatherLocation'

export async function loadLocation(): Promise<WeatherLocation | null> {
  const row = await db.settings.get(KEY)
  return (row?.value as WeatherLocation) ?? null
}

export async function saveLocation(loc: WeatherLocation): Promise<void> {
  await db.settings.put({ key: KEY, value: loc })
}

export async function clearLocation(): Promise<void> {
  await db.settings.delete(KEY)
}

/* ------------------------------ 展示辅助 ------------------------------ */

/** 取从现在起接下来 n 小时的数据 */
export function upcomingHours(data: WeatherData, n = 6) {
  const nowIso = data.current.time?.slice(0, 13) ?? data.hourly.time[0]
  const start = Math.max(0, data.hourly.time.findIndex((t) => t.slice(0, 13) >= nowIso))
  const out: Array<{ time: string; temp?: number; code?: number; pop?: number }> = []
  for (let i = start; i < Math.min(start + n, data.hourly.time.length); i++) {
    out.push({
      time: data.hourly.time[i],
      temp: data.hourly.temp[i],
      code: data.hourly.code[i],
      pop: data.hourly.pop[i],
    })
  }
  return out
}

export function hourLabel(iso: string): string {
  const h = iso.slice(11, 13)
  return `${Number(h)}时`
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export function dayLabel(iso: string, index: number): string {
  if (index === 0) return '今天'
  if (index === 1) return '明天'
  const d = new Date(`${iso}T00:00:00`)
  return WEEK[d.getDay()] ?? iso.slice(5)
}

export function placeLabel(loc: WeatherLocation | null): string {
  if (!loc) return ''
  // name 现在可能是区/县（如「鼓楼」），region 是「江苏·南京」或「南京」这类上级，
  // 拼起来刚好是「鼓楼 · 南京」的层级展示，同时避免「南京市 江苏省」这类重复。
  const parts = [loc.name, loc.region].filter(Boolean)
  return parts.filter((p, i) => parts.indexOf(p) === i).join(' · ')
}
