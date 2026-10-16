import { useEffect, useMemo, useState } from 'react'
import { iconCandidates, initialOf, cn } from '../lib/utils'

/** 网站图标：依次尝试候选地址；全部失败则退回「首字头像」，永不出现裂图 */
export function SiteIcon({
  url,
  iconUrl,
  title,
  size = 36,
  radius = 10,
  className,
}: {
  url: string
  iconUrl?: string
  title: string
  size?: number
  radius?: number
  className?: string
}) {
  const candidates = useMemo(() => iconCandidates({ url, iconUrl }), [url, iconUrl])
  const [idx, setIdx] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setIdx(0)
    setFailed(false)
  }, [url, iconUrl])

  const src = candidates[idx]
  const showImg = !failed && !!src

  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360

  return (
    <div
      className={cn('flex shrink-0 items-center justify-center overflow-hidden bg-surface-2', className)}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {showImg ? (
        <img
          src={src}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            if (idx < candidates.length - 1) setIdx(idx + 1)
            else setFailed(true)
          }}
          style={{ width: size * 0.62, height: size * 0.62, objectFit: 'contain' }}
        />
      ) : (
        <span
          className="font-semibold text-white"
          style={{
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size * 0.42,
            background: `linear-gradient(135deg, hsl(${h} 68% 55%), hsl(${(h + 40) % 360} 68% 45%))`,
          }}
        >
          {initialOf(title)}
        </span>
      )}
    </div>
  )
}
