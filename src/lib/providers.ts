/**
 * AI 服务商预设库（集中管理，便于后续维护/更新）
 *
 * ⚠️ 重要说明：
 *  - 各服务商的接口地址、模型名称会随时间变化（例如 DeepSeek 已把 deepseek-chat
 *    更名为 deepseek-flash / deepseek-v4-pro）。因此这里的预设仅作「自动填充」用途，
 *    界面始终允许用户手动编辑，并提供「动态拉取模型列表」与「测试连接」来兜底。
 *  - verified 表示「是否已在本机真实调用验证通过」。未验证的一律为 false，
 *    界面会显示「待验证」徽标，绝不谎称已兼容。
 *  - 所有列出的服务商均采用 OpenAI 兼容的 /chat/completions 协议。
 */
import type { ProviderPreset, ModelParams, ModelFilterPolicy } from './types'

const P = (temperature = 0.7, maxTokens = 2048, topP = 1): ModelParams => ({
  temperature,
  maxTokens,
  topP,
})

export const CUSTOM_PROVIDER_ID = 'custom'

/**
 * NVIDIA NIM 的「非对话模型」识别规则。
 * GET /models 返回的是全部可用模型（含嵌入/向量、安全护栏、OCR、语音、图像、排序等），
 * 直接塞进下拉框里用户根本没法选。这里按 id 的关键词剔除非对话类，剩下的才作为可选模型。
 * 规则按「宁可留一个可疑的，也不错杀一个能聊的」写，因此是黑名单而非白名单。
 */
const NVIDIA_NON_CHAT_PATTERNS = [
  'embed', 'rerank', 'whisper', 'tts', 'dall', 'stable-diffusion', 'flux', 'reward',
  'guard', 'safety', 'content-safety', 'parse', 'retriever', 'ocr', 'asr', 'vad',
  'diariz', 'seg', 'pose', 'yolo', 'detection', 'classification', 'deplot', 'diffusion',
  'imagebind', 'kosmos', 'fuyu', 'nemo-guard', 'topic-control', 'vlm-embed', 'classify',
  'embedding', 'detector', 'calibration', 'nvclip', 'muse-glimmer', 'neva-', '/vila',
  'synthetic-video', 'riva-translate', 'cosmos-reason', 'ising-calibration', 'laguna',
]

/** NVIDIA 专用：判断某个模型 id 是否是「可对话」模型 */
export function isNvidiaChatModel(id: string): boolean {
  const s = id.toLowerCase()
  return !NVIDIA_NON_CHAT_PATTERNS.some((k) => s.includes(k))
}

/** 按服务商过滤模型列表 */
export function filterModels(providerId: string, models: string[]): string[] {
  const policy: ModelFilterPolicy = getProvider(providerId)?.modelFilter ?? 'none'
  if (policy === 'chat-only' && providerId === 'nvidia') {
    return models.filter(isNvidiaChatModel)
  }
  return models
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    accent: '#4d6bfe',
    baseUrl: 'https://api.deepseek.com',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'bearer',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://api-docs.deepseek.com/',
    verified: false,
    note: '官方文档确认地址。旧模型名 deepseek-chat / deepseek-reasoner 已于 2026-07-24 弃用，请以「测试连接」拉取到的列表为准。',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    accent: '#76b900',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'bearer',
    models: [
      'deepseek-ai/deepseek-v4.1-flash',
      'deepseek-ai/deepseek-coder-6.7b-instruct',
    ],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://build.nvidia.com/',
    verified: true,
    note: '已用真实 Key 验证：GET /models 返回 200（81 个模型）。模型名为「命名空间/模型」格式（如 deepseek-ai/deepseek-v4.1-flash），Key 形如 nvapi-xxxx。列表会自动剔除嵌入/护栏/OCR/语音/图像等非对话模型。',
    modelFilter: 'chat-only',
    groupByNamespace: true,
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    accent: '#6c4df6',
    baseUrl: 'https://api.siliconflow.cn/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'bearer',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct', 'Qwen/QwQ-32B', 'THUDM/glm-4-9b-chat'],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://docs.siliconflow.cn/',
    verified: false,
    note: '聚合平台，模型名为「命名空间/模型名」格式，建议连接后动态刷新模型列表。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    accent: '#10a37f',
    baseUrl: 'https://api.openai.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'bearer',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    verified: false,
    note: '国内网络需自备代理；模型名随官方发布变化，请动态刷新或手动填写。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    accent: '#2f6bff',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    chatPath: '/chat/completions',
    authStyle: 'bearer',
    models: ['glm-4-flash', 'glm-4.7-flash', 'glm-4-plus', 'glm-5'],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://open.bigmodel.cn/dev/api',
    verified: false,
    note: '部分模型（如 glm-4-flash / glm-4.7-flash）有免费额度；是否可用请以测试连接为准。',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    accent: '#0b0b0f',
    baseUrl: 'https://api.moonshot.cn/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'bearer',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://platform.moonshot.cn/docs',
    verified: false,
    note: '长上下文见长；具体模型名以控制台及测试连接为准。',
  },
  {
    id: 'dashscope',
    name: '阿里云百炼 · 通义千问',
    accent: '#ff6a00',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'bearer',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
    verified: false,
    note: '使用「兼容模式」接入，OpenAI 协议；Key 为百炼控制台生成的 API-KEY。',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    accent: '#6467f2',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'bearer',
    models: [
      'deepseek/deepseek-chat',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-flash-1.5',
      'qwen/qwen-2.5-72b-instruct',
    ],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://openrouter.ai/docs',
    verified: false,
    note: '聚合网关，模型名为「厂商/模型」格式；一个 Key 调用多家中转模型。',
  },
  {
    id: 'volcengine',
    name: '火山引擎 · 豆包',
    accent: '#1664ff',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    chatPath: '/chat/completions',
    authStyle: 'bearer',
    models: ['doubao-pro-32k', 'doubao-lite-32k'],
    defaultParams: P(0.7, 4096),
    docsUrl: 'https://www.volcengine.com/docs/82379',
    verified: false,
    note: '需要在控制台创建「推理接入点」，模型名通常填写接入点 ID（ep-xxxx），请按控制台实际填写。',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地模型）',
    accent: '#101010',
    baseUrl: 'http://localhost:11434/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'none',
    models: ['qwen2.5', 'llama3.1', 'deepseek-r1'],
    defaultParams: P(0.7, 2048),
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    verified: false,
    note: '完全本地运行，无需 API Key（可留空）。需先在本机启动 Ollama 服务。',
  },
  {
    id: 'custom',
    name: '自定义 API',
    accent: '#8b5cf6',
    baseUrl: '',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authStyle: 'bearer',
    models: [],
    defaultParams: P(0.7, 2048),
    verified: false,
    note: '兼容 OpenAI 协议的任意服务。请填写以 /v1 结尾（或对应前缀）的 Base URL。',
  },
]

export function getProvider(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** 合并预设与已拉取模型，去重并保持稳定顺序 */
export function mergeModels(preset: string[] = [], fetched: string[] = [], manual: string = ''): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of [...manual.split(',').map((s) => s.trim()).filter(Boolean), ...fetched, ...preset]) {
    if (m && !seen.has(m)) {
      seen.add(m)
      out.push(m)
    }
  }
  return out
}
