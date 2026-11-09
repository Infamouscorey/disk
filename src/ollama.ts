import type { Character, MemoryFact, Message, Persona } from './workspace'

const OLLAMA_URL = 'http://localhost:11434'

type OllamaModel = { name: string }
export type StreamArguments = {
  model: string
  character: Character
  messages: Message[]
  persona?: Persona
  memorySummary?: string
  memoryFacts?: MemoryFact[]
  permanentMemory?: string
  temperature: number
  topP: number
  contextTokens: number
  responseLength: string
  mode: string
  systemPrompt?: string
  signal: AbortSignal
  onToken: (token: string) => void
}

export async function getOllamaModels(): Promise<string[]> {
  const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) })
  if (!response.ok) throw new Error(`Ollama returned ${response.status}.`)
  const data = await response.json() as { models?: OllamaModel[] }
  return (data.models ?? []).map((item) => item.name).filter(Boolean)
}

export async function streamOllamaChat(args: StreamArguments): Promise<void> {
  const system = args.systemPrompt ?? buildSystemPrompt(args)
  const tokenReplacer = createUserPlaceholderReplacer(args.onToken, args.persona?.name.trim() || 'you')

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: args.model,
      stream: true,
      messages: [
        { role: 'system', content: system },
        ...args.messages.map(({ role, content }) => ({ role, content: replaceUserPlaceholder(content, args.persona?.name.trim() || 'you') })),
      ],
      options: { temperature: args.temperature, top_p: args.topP, num_ctx: args.contextTokens },
    }),
    signal: args.signal,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Ollama could not generate a reply (${response.status}).`)
  }
  if (!response.body) throw new Error('Ollama returned an empty response stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) readStreamLine(line, tokenReplacer.onToken)
      if (done) break
    }
    if (buffer.trim()) readStreamLine(buffer, tokenReplacer.onToken)
  } finally {
    tokenReplacer.flush()
  }
}

export function buildSystemPrompt(args: StreamArguments): string {
  const userName = args.persona?.name.trim() || 'you'
  const characterText = (value: string | undefined) => value ? replaceUserPlaceholder(value, userName) : ''
  const lengthInstruction = args.responseLength === 'Brief'
    ? 'Keep replies concise, usually a few sentences.'
    : args.responseLength === 'Detailed'
      ? 'Write a detailed, vivid reply while leaving room for the user to respond.'
      : 'Use a natural, balanced reply length.'
  const modeInstruction = args.mode === 'Quick replies'
    ? 'Reply briefly and directly.'
    : args.mode === 'Long-form narrative'
      ? 'Use immersive, longer-form prose with sensory details.'
      : args.mode === 'Immersive story'
        ? 'Stay immersed in the scene and let the story unfold naturally.'
        : 'Have a natural roleplay conversation.'
  const recentContext = args.messages.slice(-8).map((message) => message.content).join('\n').toLowerCase()
  const relevantLore = (args.character.loreEntries ?? [])
    .filter((entry) => entry.enabled && entry.keywords.some((keyword) => keyword.trim() && recentContext.includes(keyword.toLowerCase())))
    .map((entry) => characterText(entry.content))
  return [
    `You are roleplaying as ${args.character.name}.`,
    args.character.title && `Story title: ${characterText(args.character.title)}`,
    characterText(args.character.personality),
    `Keep narrative descriptions in ${characterText(args.character.pov ?? 'Third person').toLowerCase()} point of view.`,
    args.character.gender && args.character.gender !== 'Unspecified' && `Character gender: ${characterText(args.character.gender)}.`,
    `Character context: ${characterText(args.character.description)}`,
    args.character.scenario && `Scenario: ${characterText(args.character.scenario)}`,
    args.character.exampleDialogues && `Example dialogue:\n${characterText(args.character.exampleDialogues)}`,
    args.persona && [
      `The person you are speaking with is roleplaying as ${args.persona.name}. Address them by the name "${args.persona.name}" when using a name, or naturally as "you". Never call them "{{user}}" or refer to template placeholders.`,
      args.persona.pronouns && `Pronouns: ${args.persona.pronouns}.`,
      args.persona.appearance && `Appearance: ${characterText(args.persona.appearance)}`,
      args.persona.description && `Appearance, personality, and identity details: ${characterText(args.persona.description)}`,
      'Treat this persona as the user character. Do not speak or make decisions on the user’s behalf.',
    ].filter(Boolean).join('\n'),
    args.permanentMemory && `Permanent story memory: ${characterText(args.permanentMemory)}`,
    args.memorySummary && `Conversation memory summary: ${characterText(args.memorySummary)}`,
    args.memoryFacts?.length && `Remembered facts:\n${args.memoryFacts.map((fact) => `- ${characterText(fact.content)}`).join('\n')}`,
    relevantLore.length > 0 && `Relevant lore (only matching entries):\n${relevantLore.join('\n')}`,
    `Current approach: ${modeInstruction} ${lengthInstruction}`,
    `Never output the literal placeholder "{{user}}". Refer to the user's persona as "${userName}" or use second-person address.`,
    'Respect the user as a co-author. Do not decide the user character’s thoughts, feelings, or actions.',
  ].filter(Boolean).join('\n\n')
}

export function replaceUserPlaceholder(value: string, userName: string): string {
  return value.replace(/\{\{\s*user\s*\}\}/gi, userName)
}

export function createUserPlaceholderReplacer(onToken: (token: string) => void, userName: string) {
  let pending = ''
  return {
    onToken(token: string) {
      const combined = pending + token
      const replaced = replaceUserPlaceholder(combined, userName)
      const safeLength = Math.max(0, replaced.length - 7)
      if (safeLength) onToken(replaced.slice(0, safeLength))
      pending = replaced.slice(safeLength)
    },
    flush() {
      if (pending) onToken(replaceUserPlaceholder(pending, userName))
      pending = ''
    },
  }
}

function readStreamLine(line: string, onToken: (token: string) => void) {
  if (!line.trim()) return
  const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string }
  if (chunk.error) throw new Error(chunk.error)
  if (chunk.message?.content) onToken(chunk.message.content)
}