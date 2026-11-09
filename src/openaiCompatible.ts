import { buildSystemPrompt, createUserPlaceholderReplacer, replaceUserPlaceholder, streamOllamaChat, type StreamArguments } from './ollama'

export type AiProvider = 'ollama' | 'openai' | 'groq' | 'custom'
export type AiProviderConfig = { provider: AiProvider; apiKey: string; customBaseUrl: string }

const CONFIG_KEY = 'novarole.ai-provider.v1'
const PROVIDER_URLS: Partial<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
}

export const defaultAiProviderConfig: AiProviderConfig = {
  provider: 'ollama',
  apiKey: '',
  customBaseUrl: '',
}

export function loadAiProviderConfig(): AiProviderConfig {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null')
    if (!isRecord(stored)) return defaultAiProviderConfig
    const provider = isProvider(stored.provider) ? stored.provider : 'ollama'
    return {
      provider,
      apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
      customBaseUrl: typeof stored.customBaseUrl === 'string' ? stored.customBaseUrl : '',
    }
  } catch {
    return defaultAiProviderConfig
  }
}

export function saveAiProviderConfig(config: AiProviderConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

export function getProviderName(provider: AiProvider): string {
  if (provider === 'ollama') return 'Ollama'
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'groq') return 'Groq'
  return 'Custom API'
}

export async function getProviderModels(config: AiProviderConfig): Promise<string[]> {
  if (config.provider === 'ollama') {
    const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`Ollama returned ${response.status}.`)
    const payload = await response.json() as { models?: { name?: string }[] }
    return (payload.models ?? []).flatMap((item) => item.name ? [item.name] : [])
  }

  const response = await fetch(`${getBaseUrl(config)}/models`, {
    headers: { Authorization: `Bearer ${requireApiKey(config)}` },
    signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json().catch(() => null) as { data?: { id?: string }[]; error?: { message?: string } } | null
  if (!response.ok) throw new Error(payload?.error?.message || `Model list request failed (${response.status}).`)
  return (payload?.data ?? []).flatMap((item) => item.id ? [item.id] : []).sort((left, right) => left.localeCompare(right))
}

export async function streamProviderChat(config: AiProviderConfig, model: string, args: StreamArguments): Promise<void> {
  if (config.provider === 'ollama') {
    return streamOllamaChat({ ...args, model })
  }

  const response = await fetch(`${getBaseUrl(config)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireApiKey(config)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: args.systemPrompt ?? buildSystemPrompt(args) },
        ...args.messages.map(({ role, content }) => ({ role, content: replaceUserPlaceholder(content, args.persona?.name.trim() || 'you') })),
      ],
      temperature: args.temperature,
      top_p: args.topP,
      ...(config.provider === 'openai'
        ? { max_completion_tokens: responseTokenLimit(args.responseLength) }
        : { max_tokens: responseTokenLimit(args.responseLength) }),
    }),
    signal: args.signal,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(readProviderError(detail) || `${getProviderName(config.provider)} could not generate a reply (${response.status}).`)
  }
  if (!response.body) throw new Error(`${getProviderName(config.provider)} returned an empty response stream.`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const tokenReplacer = createUserPlaceholderReplacer(args.onToken, args.persona?.name.trim() || 'you')
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) readEventLine(line, tokenReplacer.onToken)
      if (done) break
    }
    if (buffer.trim()) readEventLine(buffer, tokenReplacer.onToken)
  } finally {
    tokenReplacer.flush()
  }
}

function getBaseUrl(config: AiProviderConfig): string {
  const rawUrl = config.provider === 'custom' ? config.customBaseUrl.trim() : PROVIDER_URLS[config.provider]
  if (!rawUrl) throw new Error('Enter a base URL for your custom API.')
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Enter a valid API base URL.')
  }
  const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHost)) {
    throw new Error('API keys can only be sent over HTTPS (HTTP is allowed for localhost).')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('The API base URL cannot contain credentials, query parameters, or a fragment.')
  }
  return parsed.toString().replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/i, '')
}

function requireApiKey(config: AiProviderConfig): string {
  if (!config.apiKey.trim()) throw new Error(`Add an API key for ${getProviderName(config.provider)} in app settings.`)
  return config.apiKey.trim()
}

function responseTokenLimit(responseLength: string): number {
  if (responseLength === 'Brief') return 256
  if (responseLength === 'Detailed') return 1024
  return 512
}

function readProviderError(detail: string): string {
  try {
    const payload: unknown = JSON.parse(detail)
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') return payload.error.message
  } catch {
    return detail.trim().slice(0, 500)
  }
  return ''
}

function readEventLine(line: string, onToken: (token: string) => void): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return
  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    throw new Error('The API returned an invalid streaming response.')
  }
  if (!isRecord(payload)) return
  if (isRecord(payload.error) && typeof payload.error.message === 'string') throw new Error(payload.error.message)
  const choices = payload.choices
  if (!Array.isArray(choices)) return
  const first = choices[0]
  if (isRecord(first) && isRecord(first.delta) && typeof first.delta.content === 'string') onToken(first.delta.content)
}

function isProvider(value: unknown): value is AiProvider {
  return value === 'ollama' || value === 'openai' || value === 'groq' || value === 'custom'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
