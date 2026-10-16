import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Droplets,
  LocateFixed,
  MapPin,
  RefreshCw,
  Search,
  Thermometer,
  Wind,
  X,
} from 'lucide-react'
import { db } from '../lib/db'
import type { GeoPlace, WeatherData, WeatherLocation } from '../lib/weather'
import {
  clearLocation,
  dayLabel,
  fetchWeather,
  hourLabel,
  loadLocation,
  locate,
  placeLabel,
  reverseGeo,
  saveLocation,
  searchCity,
  upcomingHours,
  weatherVisual,
} from '../lib/weather'
import { cn, timeAgo } from '../lib/utils'
import { useApp } from '../store/ctx'
import { IconButton, Spinner } from './ui'

export function WeatherCard() {
  const { toast } = useApp()

  const locRow = useLiveQuery(() => db.settings.get('weatherLocation'), [], undefined)
  const location = (locRow?.value as WeatherLocation | undefined) ?? null

  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<'none' | 'search'>('none')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoPlace[]>([])
  const [searching, setSearching] = useState(false)

  const load = useCallback(
    async (loc: WeatherLocation) => {
      setLoading(true)
      setError('')
      try {
        const d = await fetchWeather(loc.lat, loc.lon)
        setData(d)
      } catch (e) {
        setError(e instanceof Error ? e.message : '天气获取失败')
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (location) void load(location)
    else setData(null)
  }, [location, load])

  const useMyLocation = async () => {
    setError('')
    setPanel('none')
    try {
      const { lat, lon } = await locate()
      const place = await reverseGeo(lat, lon)
      const next: WeatherLocation = { ...place, source: 'geo', updatedAt: Date.now() }
      await saveLocation(next)
      toast(`已定位到 ${place.name || '当前位置'}`, 'success')
    } catch (e) {
      setError(e instanceof Error ? e.message : '定位失败')
      setPanel('search')
    }
  }

  const pickCity = async (p: GeoPlace) => {
    const next: WeatherLocation = { ...p, source: 'manual', updatedAt: Date.now() }
    await saveLocation(next)
    setPanel('none')
    setQuery('')
    setResults([])
    toast(`已切换到 ${p.name}`, 'success')
  }

  const doSearch = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError('')
    try {
      const list = await searchCity(q)
      setResults(list)
      if (list.length === 0) setError('没有找到匹配的城市，换个关键词试试')
    } catch (e) {
      setError(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const now = data ? weatherVisual(data.current.code, data.current.isDay) : null
  const hours = useMemo(() => (data ? upcomingHours(data, 6) : []), [data])
  const days = useMemo(() => {
    if (!data) return []
    return data.daily.time.slice(0, 4).map((t, i) => ({
      date: t,
      label: dayLabel(t, i),
      code: data.daily.code[i],
      max: data.daily.max[i],
      min: data.daily.min[i],
      pop: data.daily.pop[i],
    }))
  }, [data])

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-surface p-4">
      {/* 头部 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MapPin size={16} className="shrink-0 text-primary" />
          <span className="text-[14px] font-semibold text-text">天气</span>
          {location ? (
            <span className="truncate text-[12px] text-muted">{placeLabel(location)}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {location ? (
            <>
              <IconButton title="刷新" onClick={() => void load(location)}>
                {loading ? <Spinner className="h-4 w-4" /> : <RefreshCw size={15} />}
              </IconButton>
              <IconButton
                title="更换城市"
                onClick={() => setPanel((p) => (p === 'search' ? 'none' : 'search'))}
              >
                <Search size={15} />
              </IconButton>
            </>
          ) : null}
        </div>
      </div>

      {/* 未定位 */}
      {!location ? (
        <div className="flex flex-1 flex-col justify-center rounded-xl border border-dashed border-border-strong px-4 py-6 text-center">
          {panel === 'none' ? (
            <>
              <Thermometer size={24} className="mx-auto text-faint" />
              <p className="mt-2.5 text-[13.5px] font-medium text-text">还没设置位置</p>
              <p className="mx-auto mt-1 max-w-[240px] text-[12px] leading-relaxed text-muted">
                允许定位即可显示你所在位置的天气；也可以直接搜索城市。
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => void useMyLocation()}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-fg hover:bg-primary-hover"
                >
                  <LocateFixed size={13} /> 使用我的位置
                </button>
                <button
                  onClick={() => setPanel('search')}
                  className="rounded-xl border border-border-strong bg-surface px-3 py-1.5 text-[12.5px] text-text hover:bg-surface-2"
                >
                  搜索城市
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* 已定位 */}
      {location ? (
        <div className="flex-1">
          {loading && !data ? (
            <div className="flex h-full min-h-[140px] items-center justify-center">
              <Spinner />
            </div>
          ) : error && !data ? (
            <p className="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">
              {error}
            </p>
          ) : data && now ? (
            <>
              <div className="flex items-center gap-3.5">
                <now.Icon size={44} className="shrink-0 text-primary" strokeWidth={1.6} />
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[30px] font-semibold leading-none tabular-nums text-text">
                      {data.current.temp !== undefined ? Math.round(data.current.temp) : '--'}
                    </span>
                    <span className="text-[15px] text-muted">°C</span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-muted">
                    {now.text}
                    {data.current.feelsLike !== undefined
                      ? ` · 体感 ${Math.round(data.current.feelsLike)}°`
                      : ''}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                {data.current.humidity !== undefined ? (
                  <span className="flex items-center gap-1">
                    <Droplets size={11} /> 湿度 {data.current.humidity}%
                  </span>
                ) : null}
                {data.current.windSpeed !== undefined ? (
                  <span className="flex items-center gap-1">
                    <Wind size={11} /> {data.current.windSpeed} km/h
                  </span>
                ) : null}
              </div>

              {/* 未来几小时 */}
              {hours.length ? (
                <div className="mt-3 grid grid-cols-6 gap-1 rounded-xl border border-border bg-surface-2 px-1.5 py-2">
                  {hours.map((h) => {
                    const v = weatherVisual(h.code, true)
                    return (
                      <div key={h.time} className="flex flex-col items-center gap-0.5">
                        <span className="text-[10.5px] text-faint">{hourLabel(h.time)}</span>
                        <v.Icon size={14} className="text-muted" />
                        <span className="text-[11px] tabular-nums text-text">
                          {h.temp !== undefined ? `${Math.round(h.temp)}°` : '--'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : null}

              {/* 未来几天 */}
              <div className="mt-2.5 space-y-1">
                {days.slice(1).map((d) => {
                  const v = weatherVisual(d.code, true)
                  return (
                    <div key={d.date} className="flex items-center gap-2 px-0.5 text-[12px]">
                      <span className="w-9 shrink-0 text-muted">{d.label}</span>
                      <v.Icon size={14} className="shrink-0 text-muted" />
                      <span className="flex-1 truncate text-muted">{v.text}</span>
                      {typeof d.pop === 'number' && d.pop >= 30 ? (
                        <span className="shrink-0 text-[11px] text-primary">{d.pop}%</span>
                      ) : null}
                      <span className="shrink-0 tabular-nums text-text">
                        {Math.round(d.max)}° / {Math.round(d.min)}°
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
                <span className="text-[10.5px] leading-relaxed text-faint">
                  数据来自 Open-Meteo · {timeAgo(location.updatedAt)}定位
                </span>
                <button
                  onClick={() => void clearLocation()}
                  className="shrink-0 text-[11px] text-faint hover:text-danger"
                >
                  清除定位
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* 城市搜索面板 */}
      {panel === 'search' ? (
        <div className="mt-3 rounded-xl border border-border bg-surface-2 p-2.5">
          <div className="flex items-center gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
              placeholder="输入城市名，如 南京"
              className="h-8 flex-1 rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-text outline-none focus:border-primary"
              autoFocus
            />
            <button
              onClick={() => void doSearch()}
              disabled={searching}
              className="flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-[12px] text-primary-fg disabled:opacity-50"
            >
              {searching ? <Spinner className="h-3 w-3" /> : <Search size={12} />} 搜索
            </button>
            <IconButton title="关闭" onClick={() => setPanel('none')}>
              <X size={15} />
            </IconButton>
          </div>

          {results.length ? (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {results.map((p, i) => (
                <button
                  key={`${p.lat}-${p.lon}-${i}`}
                  onClick={() => void pickCity(p)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-3"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-text">
                      {p.name}
                      {p.region ? ` · ${p.region}` : ''}
                    </span>
                    {p.district ? (
                      <span className="shrink-0 rounded border border-primary/40 px-1 py-0.5 text-[9.5px] leading-none text-primary">
                        区/县
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-faint">{p.country}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-2">
            {location ? (
              <button
                onClick={() => void useMyLocation()}
                className="flex items-center gap-1 text-[11.5px] text-primary hover:underline"
              >
                <LocateFixed size={12} /> 用我的位置
              </button>
            ) : (
              <span />
            )}
            <span className="text-[10.5px] leading-relaxed text-faint">
              定位会把坐标发送给 Open-Meteo / BigDataCloud
            </span>
          </div>

          {error ? (
            <p className={cn('mt-2 rounded-lg border border-danger/40 bg-danger-soft px-2.5 py-1.5 text-[11.5px] text-danger')}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
