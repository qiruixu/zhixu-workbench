import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import type { AIConfig, AuthStyle } from '../lib/types'
import { CUSTOM_PROVIDER_ID, PROVIDERS, getProvider } from '../lib/providers'
import { draftFromProvider, saveConfig, withFetchedModels } from '../lib/aiConfigRepo'
import { fetchModels, testConnection, type TestResult } from '../lib/ai/client'
import { classifyThrown, makeError, type AIError } from '../lib/ai/errors'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'
import { Badge, Button, Field, Input, Modal, Select, Switch, Textarea } from './ui'
import { ModelPicker } from './ModelPicker'

const AUTH_LABELS: { value: AuthStyle; label: string }[] = [
  { value: 'bearer', label: 'Bearer Token（Authorization 头）' },
  { value: 'x-api-key', label: 'x-api-key 头' },
  { value: 'api-key-header', label: '自定义头名' },
  { value: 'none', label: '无需鉴权（本地模型）' },
]

export function AIConfigEditor({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  initial: AIConfig | null
  onSaved: (cfg: AIConfig, isNew: boolean) => void
}) {
  const { toast } = useApp()
  const [draft, setDraft] = useState<AIConfig>(() => draftFromProvider('deepseek'))
  const [picking, setPicking] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [manualModels, setManualModels] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testErr, setTestErr] = useState<AIError | null>(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [extraText, setExtraText] = useState('{}')

  const isNew = !initial

  useEffect(() => {
    if (!open) return
    setError('')
    setTestResult(null)
    setTestErr(null)
    setManualModels('')
    if (initial) {
      setDraft({ ...initial })
      setPicking(false)
      setExtraText(JSON.stringify(initial.extraHeaders ?? {}, null, 0))
    } else {
      setDraft(draftFromProvider('deepseek'))
      setPicking(true)
      setExtraText('{}')
    }
  }, [open, initial])

  const preset = useMemo(() => getProvider(draft.providerId), [draft.providerId])

  const chooseProvider = (id: string) => {
    if (id === draft.providerId && !picking) return
    const next = draftFromProvider(id)
    setDraft((d) => ({
      ...next,
      // 保留用户已填的密钥与自定义名称，减少重复输入
      apiKey: d.apiKey,
      name: id === CUSTOM_PROVIDER_ID ? '自定义 API' : next.name,
      persistKey: d.persistKey,
    }))
    setTestResult(null)
    setTestErr(null)
    setPicking(false)
  }

  const patch = (p: Partial<AIConfig>) => setDraft((d) => ({ ...d, ...p }))

  const effectiveKey = draft.apiKey

  const runTest = async () => {
    setTesting(true)
    setTestErr(null)
    setTestResult(null)
    try {
      const res = await testConnection(draft, effectiveKey)
      setTestResult(res)
      if (res.ok && res.models?.length) {
        setDraft((d) => withFetchedModels(d, res.models ?? [], manualModels))
      }
    } catch (e) {
      setTestErr(classifyThrown(e))
    } finally {
      setTesting(false)
    }
  }

  const refreshModels = async () => {
    if (!draft.baseUrl) {
      setTestErr(makeError('bad_url', '请先填写 Base URL'))
      return
    }
    setFetching(true)
    setTestErr(null)
    try {
      const { models } = await fetchModels(draft, effectiveKey)
      if (!models.length) {
        toast('服务商未返回模型列表，可手动填写模型名', 'info')
      } else {
        setDraft((d) => withFetchedModels(d, models, manualModels))
        toast(`已获取 ${models.length} 个模型`, 'success')
      }
    } catch (e) {
      setTestErr(e as AIError)
    } finally {
      setFetching(false)
    }
  }

  const doSave = async () => {
    setError('')
    if (!draft.name.trim()) return setError('请填写配置名称')
    if (draft.authStyle !== 'none' && !draft.apiKey.trim()) return setError('请填写 API Key')
    if (!draft.baseUrl.trim()) return setError('请填写 API Base URL')
    if (!draft.model.trim()) return setError('请选择或填写模型名称')

    let extraHeaders: Record<string, string> | undefined
    try {
      const parsed = JSON.parse(extraText || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraHeaders = parsed as Record<string, string>
      } else {
        throw new Error('bad')
      }
    } catch {
      return setError('「额外请求头」必须是合法的 JSON 对象，例如 {"X-Title":"我的应用"}')
    }

    try {
      setSaving(true)
      const finalCfg: AIConfig = {
        ...draft,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        extraHeaders,
        providerName: getProvider(draft.providerId)?.name ?? '自定义',
        // 把编辑器内的测试结果一并持久化，避免保存后卡片回到「待验证」
        lastTestResult: testResult ? (testResult.ok ? 'ok' : 'fail') : draft.lastTestResult,
        lastTestedAt: testResult ? Date.now() : draft.lastTestedAt,
      }
      await saveConfig(finalCfg)
      onSaved(finalCfg, isNew)
      toast(isNew ? 'AI 配置已添加' : 'AI 配置已更新', 'success')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const StepDot = ({ n, done }: { n: number; done: boolean }) => (
    <span
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
        done ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-muted'
      )}
    >
      {n}
    </span>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? '添加 AI 配置' : `编辑配置 · ${initial?.name}`}
      description="只需四步：选服务商 → 填 Key → 选模型 → 测试连接。API 地址等已自动填充。"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={doSave} loading={saving}>
            保存配置
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* 步骤 1 */}
        <section>
          <div className="mb-2.5 flex items-center gap-2">
            <StepDot n={1} done />
            <span className="text-[13.5px] font-semibold text-text">选择 AI 服务商</span>
            {!picking ? (
              <button
                onClick={() => setPicking(true)}
                className="ml-auto text-[12px] text-primary hover:underline"
              >
                重新选择
              </button>
            ) : null}
          </div>

          {picking ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => chooseProvider(p.id)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all',
                    draft.providerId === p.id
                      ? 'border-primary bg-primary-soft'
                      : 'border-border bg-surface hover:border-border-strong hover:bg-surface-2'
                  )}
                >
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ background: p.accent }}
                  >
                    <Sparkles size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-text">{p.name}</span>
                      {p.verified ? (
                        <Badge tone="success">
                          <BadgeCheck size={10} /> 已验证
                        </Badge>
                      ) : (
                        <Badge tone="warning">待验证</Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-faint">
                      {p.baseUrl || '需自行填写地址'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
                style={{ background: preset?.accent || '#8b5cf6' }}
              >
                <Sparkles size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text">{preset?.name || '自定义'}</div>
                <div className="truncate text-[11.5px] text-faint">{draft.baseUrl || '未填写地址'}</div>
              </div>
            </div>
          )}

          {preset?.note && !picking ? (
            <p className="mt-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-muted">
              {preset.note}
              {preset.docsUrl ? (
                <a
                  href={preset.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-primary hover:underline"
                >
                  查看文档
                </a>
              ) : null}
            </p>
          ) : null}
        </section>

        {/* 步骤 2 */}
        {!picking ? (
          <>
            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <StepDot n={2} done={!!draft.apiKey || draft.authStyle === 'none'} />
                <span className="text-[13.5px] font-semibold text-text">填写 API Key</span>
              </div>
              <Field label="API Key" required={draft.authStyle !== 'none'}>
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                  <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.apiKey}
                    onChange={(e) => patch({ apiKey: e.target.value })}
                    placeholder={draft.authStyle === 'none' ? '本地模型可留空' : '粘贴你的 API Key'}
                    className="pl-9 font-mono"
                  />
                </div>
              </Field>
              <div className="mt-3 flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-2 p-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warning" />
                  <div className="text-[12px] leading-relaxed text-muted">
                    <div className="font-medium text-text">密钥保存方式</div>
                    <div className="mt-0.5">
                      开启后，Key 保存在本机浏览器 IndexedDB；关闭则仅存于本次会话内存，刷新即失效。
                      本机存储无法做到绝对安全，请勿在公共电脑上保存密钥。
                    </div>
                  </div>
                </div>
                <Switch checked={draft.persistKey} onChange={(v) => patch({ persistKey: v })} label="持久保存" />
              </div>
            </section>

            {/* 步骤 3 */}
            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <StepDot n={3} done={!!draft.model} />
                <span className="text-[13.5px] font-semibold text-text">选择模型</span>
                <button
                  onClick={refreshModels}
                  disabled={fetching}
                  className="ml-auto inline-flex items-center gap-1 text-[12px] text-primary hover:underline disabled:opacity-50"
                >
                  {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  从服务端刷新模型列表
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="模型"
                  hint={
                    draft.models.length
                      ? `已知 ${draft.models.length} 个可选模型${draft.providerId === 'nvidia' ? '（已剔除嵌入/护栏等非对话模型）' : ''}`
                      : '点右上角「从服务端刷新模型列表」拉取可选模型'
                  }
                >
                  <ModelPicker
                    models={draft.models}
                    value={draft.model}
                    onChange={(m) => patch({ model: m })}
                    providerId={draft.providerId}
                    placeholder="点此选择模型"
                  />
                </Field>
                <Field label="补充模型名（逗号分隔，可选）" hint="用于预设未覆盖的模型">
                  <Input
                    value={manualModels}
                    onChange={(e) => {
                      setManualModels(e.target.value)
                      setDraft((d) => withFetchedModels(d, [], e.target.value))
                    }}
                    placeholder="例如：gpt-4o,my-model"
                    className="font-mono"
                  />
                </Field>
              </div>
            </section>

            {/* 步骤 4 */}
            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <StepDot n={4} done={!!testResult?.ok} />
                <span className="text-[13.5px] font-semibold text-text">测试连接</span>
              </div>
              <Button variant="outline" onClick={runTest} loading={testing} className="w-full">
                <Plug size={15} /> {testing ? '正在测试…' : '测试连接'}
              </Button>

              {testResult?.ok ? (
                <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-success/40 bg-success-soft px-3 py-2.5 text-[12.5px] text-success">
                  <BadgeCheck size={15} className="mt-0.5 shrink-0" />
                  <div>
                    连接成功（通过「{testResult.via === 'models' ? '模型列表接口' : '最小对话请求'}」验证）
                    {testResult.models?.length ? `，发现 ${testResult.models.length} 个可用模型。` : '。'}
                  </div>
                </div>
              ) : null}

              {testResult && !testResult.ok && testResult.error ? (
                <ErrorBanner error={testResult.error} />
              ) : null}
              {testErr ? <ErrorBanner error={testErr} /> : null}
            </section>

            {/* 高级 */}
            <section className="rounded-xl border border-border">
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13px] font-medium text-text"
              >
                <span className="flex items-center gap-2">
                  <ChevronDown size={15} className={cn('transition-transform', showAdvanced && 'rotate-180')} />
                  高级设置（地址、鉴权、参数）
                </span>
              </button>
              {showAdvanced ? (
                <div className="space-y-3 border-t border-border px-3.5 py-3.5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="配置名称">
                      <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                    </Field>
                    <Field label="鉴权方式">
                      <Select
                        value={draft.authStyle}
                        onChange={(e) => patch({ authStyle: e.target.value as AuthStyle })}
                      >
                        {AUTH_LABELS.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  {draft.authStyle === 'api-key-header' ? (
                    <Field label="自定义鉴权头名">
                      <Input
                        value={draft.authHeaderName ?? ''}
                        onChange={(e) => patch({ authHeaderName: e.target.value })}
                        placeholder="例如 api-key"
                      />
                    </Field>
                  ) : null}

                  <Field label="API Base URL" hint="通常以 /v1 结尾">
                    <Input
                      value={draft.baseUrl}
                      onChange={(e) => patch({ baseUrl: e.target.value })}
                      className="font-mono"
                    />
                  </Field>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="对话路径">
                      <Input
                        value={draft.chatPath}
                        onChange={(e) => patch({ chatPath: e.target.value })}
                        className="font-mono"
                      />
                    </Field>
                    <Field label="模型列表路径" hint="留空表示不请求该接口">
                      <Input
                        value={draft.modelsPath ?? ''}
                        onChange={(e) => patch({ modelsPath: e.target.value })}
                        className="font-mono"
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <Field label="temperature">
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={draft.params.temperature}
                        onChange={(e) =>
                          patch({ params: { ...draft.params, temperature: Number(e.target.value) } })
                        }
                      />
                    </Field>
                    <Field label="max_tokens">
                      <Input
                        type="number"
                        min="1"
                        value={draft.params.maxTokens}
                        onChange={(e) =>
                          patch({ params: { ...draft.params, maxTokens: Number(e.target.value) } })
                        }
                      />
                    </Field>
                    <Field label="top_p">
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={draft.params.topP}
                        onChange={(e) => patch({ params: { ...draft.params, topP: Number(e.target.value) } })}
                      />
                    </Field>
                  </div>

                  <Field label="额外请求头（JSON）" hint='例如 {"HTTP-Referer":"http://localhost","X-Title":"智序工作台"}'>
                    <Textarea
                      rows={2}
                      value={extraText}
                      onChange={(e) => setExtraText(e.target.value)}
                      className="font-mono text-[12px]"
                    />
                  </Field>

                  <Switch
                    checked={draft.stream}
                    onChange={(v) => patch({ stream: v })}
                    label="启用流式输出（推荐）"
                  />
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {error ? (
          <p className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <TriangleAlert size={14} /> {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}

export function ErrorBanner({ error }: { error: AIError }) {
  return (
    <div className="mt-2.5 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">
      <div className="flex items-center gap-1.5 font-medium">
        <TriangleAlert size={14} /> {error.title}
      </div>
      <div className="mt-1 break-words opacity-90">{error.message}</div>
      {error.hint ? <div className="mt-1 opacity-80">建议：{error.hint}</div> : null}
    </div>
  )
}

export { ArrowRight }
