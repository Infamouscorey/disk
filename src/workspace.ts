export type Theme = 'light' | 'dark'
export type ContentRating = 'SFW' | 'Limited' | 'Limitless' | 'Mature'
export type LoreEntry = { id: string; keywords: string[]; content: string; enabled: boolean }
export type MemoryFact = { id: string; content: string; pinned: boolean; createdAt: number }
export type Persona = { id: string; name: string; description: string; pronouns?: string; appearance?: string; createdAt: number; updatedAt?: number }
export type GenerationSettings = { mode: string; responseLength: string; temperature: number; topP: number; contextTokens: number }
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number }
export type Character = {
  id: string
  name: string
  title?: string
  initials: string
  tagline: string
  description: string
  personality: string
  scenario: string
  exampleDialogues: string
  greeting: string
  tags: string[]
  genre: string
  palette: 'moss' | 'rose' | 'blue' | 'gold'
  favorite: boolean
  avatarUrl?: string
  avatarIcon?: string
  pinned?: boolean
  nickname?: string
  pov?: string
  gender?: string
  rating?: ContentRating
  popularity?: number
  featured?: boolean
  loreEntries?: LoreEntry[]
  createdAt: number
  updatedAt?: number
}
export type Chat = {
  id: string
  characterId: string
  title: string
  updatedAt: number
  messages: Message[]
  personaId?: string | null
  personaOverride?: boolean
  generationSettings?: GenerationSettings
  memorySummary?: string
  memoryFacts?: MemoryFact[]
  permanentMemory?: string
}
export type LocalProfile = { displayName: string; email: string; createdAt: number }
export type Workspace = { characters: Character[]; chats: Chat[]; profile?: LocalProfile | null; personas?: Persona[]; defaultPersonaId?: string; updatedAt?: number }
export type WorkspaceRecovery = { message: string; rawData?: string }
export type WorkspaceLoadResult = { workspace: Workspace; recovery?: WorkspaceRecovery }

const STORAGE_KEY = 'novarole.workspace.v1'
const now = Date.now()

const starters: Character[] = [
  {
    id: 'elara-voss', name: 'Elara Voss', title: 'The Stargazer at the Edge of the Sky', initials: 'EV', tagline: 'Astronomer at the edge of the known sky',
    description: 'A patient, quietly funny astronomer keeping watch at a remote observatory. She believes the stars are trying to tell a story, and tonight one of them has changed its course.',
    personality: 'Thoughtful, observant, dryly humorous. Speaks with warmth and precise detail. Curious rather than presumptuous.',
    scenario: 'At a remote observatory, a star has begun pulsing in a pattern that may be a message.',
    exampleDialogues: 'Elara: I would call it coincidence if it had not repeated at the exact same moment last night.\nYou: What do you think it means?\nElara: I think we should find out before deciding what it means.',
    greeting: 'The observatory dome turns with a low, familiar hum. Elara lowers her eye from the telescope and looks over at you. "You came at the right hour. There is something in the western sky I cannot explain yet."',
    tags: ['Slow burn', 'Mystery', 'Science'], genre: 'SCI-FI', palette: 'moss', favorite: true, createdAt: now - 86400000 * 2,
  },
  {
    id: 'rowan-vale', name: 'Rowan Vale', title: 'The Keeper of the Changing Forest Road', initials: 'RV', tagline: 'Keeper of the old forest road',
    description: 'A trail keeper who knows the forest paths by sound and shadow. Rowan is guarded at first, but their sense of humor appears when the lanterns come out.',
    personality: 'Grounded, playful, protective. Uses vivid but unshowy descriptions and leaves room for your choices.',
    scenario: 'A lantern-lit forest road keeps changing, and Rowan has found you walking in circles.',
    exampleDialogues: 'Rowan: You have taken the scenic route. Twice, by the look of it.\nYou: Is there a shorter way?\nRowan: There is. Whether it is shorter today is another matter.',
    greeting: 'A lantern swings into view between the trees. Rowan tips it toward the muddy track behind you. "If you are looking for the village, you have taken the scenic route. Twice, by the look of it."',
    tags: ['Adventure', 'Folklore', 'Cozy'], genre: 'FANTASY', palette: 'gold', favorite: false, createdAt: now - 86400000,
  },
  {
    id: 'mira-sol', name: 'Mira Sol', title: 'The Mechanic on a Drifting Station', initials: 'MS', tagline: 'Mechanic on a drifting orbital station',
    description: 'A resourceful station mechanic making a home out of spare parts and late-night radio. Mira is direct, inventive, and always has one more plan.',
    personality: 'Witty, practical, energetic. Prefers concrete details, collaborative problem solving, and short bursts of humor.',
    scenario: 'A failing life-support relay on a drifting station has started transmitting from a sealed maintenance level.',
    exampleDialogues: 'Mira: I have a plan. It is mostly a list of things not to touch.\nYou: How long is the list?\nMira: It keeps getting longer while we talk.',
    greeting: 'A wrench clatters against the deck. Mira slides out from beneath the open service panel, one eyebrow raised. "Tell me you heard that too, because I am not crawling in there again alone."',
    tags: ['Space opera', 'Found family', 'Action'], genre: 'SCI-FI', palette: 'blue', favorite: false, createdAt: now - 3600000 * 8,
  },
  {
    id: 'sable-ives', name: 'Sable Ives', title: 'The Archivist of Lost Timelines', initials: 'SI', tagline: 'Archivist of things that never happened',
    description: 'An archivist cataloguing letters from timelines that never existed. Sable speaks softly, notices everything, and treats every story as a kind of evidence.',
    personality: 'Measured, empathetic, intriguing. Asks meaningful questions and remembers the small details people overlook.',
    scenario: 'Sable has found a letter from a timeline where the two of you already met.',
    exampleDialogues: 'Sable: This letter is addressed to you.\nYou: I have never seen it before.\nSable: Not in this version of events, no.',
    greeting: 'Sable turns a page in a book with no title. "I was just reading about you," they say, then pause. "Not this you. A possibility. Would you like to hear what happened?"',
    tags: ['Mystery', 'Surreal', 'Character-driven'], genre: 'MYSTERY', palette: 'rose', favorite: false, createdAt: now - 7200000,
  },
]

function seedChats(characters: Character[]): Chat[] {
  const elara = characters.find((character) => character.id === 'elara-voss') ?? characters[0]
  if (!elara) return []
  return [{
    id: 'chat-elara-first-light', characterId: elara.id, title: 'A signal in the dark', updatedAt: now,
    messages: [
      { id: 'msg-elara-hello', role: 'assistant', content: elara.greeting, createdAt: now - 60000 * 4 },
      { id: 'msg-user-hello', role: 'user', content: 'What makes you think it is a signal?', createdAt: now - 60000 * 3 },
      { id: 'msg-elara-answer', role: 'assistant', content: 'Elara taps the edge of the star chart. "It dims in a pattern. Not a regular orbit, not a passing shadow. Three short pulses, a pause, then two more. I would call it coincidence if it had not repeated at the exact same moment last night." She glances at you. "What would you call it?"', createdAt: now - 60000 * 2 },
    ],
  }]
}

export function loadWorkspace(): WorkspaceLoadResult {
  let stored: string | null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    return {
      workspace: createStarterWorkspace(),
      recovery: { message: 'NovaRole could not read this browser’s saved workspace. Your existing data has not been changed.' },
    }
  }
  if (!stored) return { workspace: createStarterWorkspace() }

  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return {
      workspace: createStarterWorkspace(),
      recovery: { message: 'The saved workspace is not valid JSON. Your original data has been preserved for recovery.', rawData: stored },
    }
  }
  if (!isWorkspace(parsed)) {
    return {
      workspace: createStarterWorkspace(),
      recovery: { message: 'The saved workspace has an unsupported or incomplete format. Your original data has been preserved for recovery.', rawData: stored },
    }
  }

  return {
    workspace: {
      ...parsed,
      characters: parsed.characters.map((character) => ({
        ...character,
        scenario: character.scenario ?? '',
        exampleDialogues: character.exampleDialogues ?? '',
        pinned: character.pinned ?? false,
        nickname: character.nickname ?? '',
        pov: character.pov ?? 'Third person',
        gender: character.gender ?? 'Unspecified',
        rating: character.rating ?? 'SFW',
        popularity: character.popularity ?? 0,
        featured: character.featured ?? false,
        loreEntries: character.loreEntries ?? [],
      })),
      chats: parsed.chats.map((chat) => ({
        ...chat,
        personaId: chat.personaId === undefined ? parsed.defaultPersonaId : chat.personaId,
        personaOverride: chat.personaOverride ?? false,
        generationSettings: {
          mode: chat.generationSettings?.mode ?? 'Standard',
          responseLength: chat.generationSettings?.responseLength ?? 'Balanced',
          temperature: chat.generationSettings?.temperature ?? 0.8,
          topP: chat.generationSettings?.topP ?? 0.9,
          contextTokens: chat.generationSettings?.contextTokens ?? 8192,
        },
        memorySummary: chat.memorySummary ?? '',
        memoryFacts: chat.memoryFacts ?? [],
        permanentMemory: chat.permanentMemory ?? '',
      })),
      personas: parsed.personas ?? [],
    },
  }
}

function createStarterWorkspace(): Workspace {
  return { characters: starters, chats: seedChats(starters) }
}

export function saveWorkspace(workspace: Workspace): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
    return true
  } catch {
    return false
  }
}

export function parseWorkspaceBackup(serialized: string): Workspace {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!isRecord(value) || value.format !== 'novarole-workspace' || value.version !== 1 || !isRecord(value.workspace)) {
    throw new Error('This file is not a supported NovaRole workspace backup.')
  }

  const workspace = value.workspace
  if (!isWorkspace(workspace)) {
    throw new Error('The backup is missing its character or conversation library.')
  }
  if (workspace.characters.length > 500 || workspace.chats.length > 1000) {
    throw new Error('This backup exceeds the supported library size.')
  }
  return workspace
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isWorkspace(value: unknown): value is Workspace {
  if (!isRecord(value) || !Array.isArray(value.characters) || !Array.isArray(value.chats)) return false
  if (value.personas !== undefined && !Array.isArray(value.personas)) return false
  const validCharacters = value.characters.every((item) =>
    isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string' &&
    typeof item.initials === 'string' && typeof item.tagline === 'string' &&
    isOptionalString(item.title) &&
    typeof item.description === 'string' && typeof item.personality === 'string' &&
    typeof item.scenario === 'string' && typeof item.exampleDialogues === 'string' &&
    typeof item.greeting === 'string' && typeof item.genre === 'string' &&
    (item.palette === 'moss' || item.palette === 'rose' || item.palette === 'blue' || item.palette === 'gold') &&
    typeof item.favorite === 'boolean' && Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === 'string') && typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt) && isOptionalString(item.avatarUrl) && isOptionalString(item.avatarIcon) &&
    isOptionalString(item.nickname) && isOptionalString(item.pov) && isOptionalString(item.gender) &&
    isOptionalNumber(item.updatedAt) &&
    (item.loreEntries === undefined || (Array.isArray(item.loreEntries) && item.loreEntries.every((entry) =>
      isRecord(entry) && typeof entry.id === 'string' && Array.isArray(entry.keywords) &&
      entry.keywords.every((keyword) => typeof keyword === 'string') && typeof entry.content === 'string' &&
      typeof entry.enabled === 'boolean'))),
  )
  const validChats = value.chats.every((item) =>
    isRecord(item) && typeof item.id === 'string' && typeof item.characterId === 'string' &&
    typeof item.title === 'string' && typeof item.updatedAt === 'number' &&
    Number.isFinite(item.updatedAt) && Array.isArray(item.messages) &&
    item.messages.every((message) => isRecord(message) && typeof message.id === 'string' &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' && typeof message.createdAt === 'number' &&
    Number.isFinite(message.createdAt)) &&
    (item.generationSettings === undefined || (isRecord(item.generationSettings) &&
    typeof item.generationSettings.mode === 'string' &&
    typeof item.generationSettings.responseLength === 'string' &&
    typeof item.generationSettings.temperature === 'number' &&
    typeof item.generationSettings.topP === 'number' &&
    typeof item.generationSettings.contextTokens === 'number')) &&
    (item.memoryFacts === undefined || (Array.isArray(item.memoryFacts) && item.memoryFacts.every((fact) =>
    isRecord(fact) && typeof fact.id === 'string' && typeof fact.content === 'string' &&
    typeof fact.pinned === 'boolean' && typeof fact.createdAt === 'number'))),
  )
  const validPersonas = value.personas === undefined || value.personas.every((item) =>
    isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string' &&
    typeof item.description === 'string' && typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt) && isOptionalString(item.pronouns) &&
    isOptionalString(item.appearance) && isOptionalNumber(item.updatedAt),
  )
  const validProfile = value.profile === undefined || value.profile === null ||
    (isRecord(value.profile) && typeof value.profile.displayName === 'string' &&
      typeof value.profile.email === 'string' && typeof value.profile.createdAt === 'number')
  const validDefaultPersona = value.defaultPersonaId === undefined || typeof value.defaultPersonaId === 'string'
  return validCharacters && validChats && validPersonas && validProfile && validDefaultPersona
}

export function mergeWorkspaces(local: Workspace, remote: Workspace): Workspace {
  const localSettingsAreNewer = (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0)
  return {
    ...remote,
    ...local,
    characters: mergeRecords(local.characters, remote.characters, (item) => item.updatedAt ?? item.createdAt, isUnmodifiedStarterCharacter),
    chats: mergeRecords(local.chats, remote.chats, (item) => item.updatedAt, isUnmodifiedStarterChat),
    personas: mergeRecords(local.personas ?? [], remote.personas ?? [], (item) => item.updatedAt ?? item.createdAt),
    profile: local.profile ?? remote.profile,
    defaultPersonaId: localSettingsAreNewer ? local.defaultPersonaId ?? remote.defaultPersonaId : remote.defaultPersonaId ?? local.defaultPersonaId,
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0) || undefined,
  }
}

function mergeRecords<T extends { id: string }>(local: T[], remote: T[], timestamp: (item: T) => number, isPlaceholder?: (item: T) => boolean): T[] {
  const records = new Map(remote.map((item) => [item.id, item]))
  for (const item of local) {
    const stored = records.get(item.id)
    if (stored && isPlaceholder?.(item)) continue
    if (!stored || timestamp(item) >= timestamp(stored)) records.set(item.id, item)
  }
  return [...records.values()]
}

function isUnmodifiedStarterCharacter(character: Character): boolean {
  return !character.updatedAt && starters.some((starter) => starter.id === character.id)
}

function isUnmodifiedStarterChat(chat: Chat): boolean {
  return chat.id === 'chat-elara-first-light' &&
    chat.messages.length === 3 &&
    chat.messages.every((message) => message.id.startsWith('msg-elara-') || message.id === 'msg-user-hello')
}

export function createChat(character: Character, personaId?: string): Chat {
  return {
    id: crypto.randomUUID(), characterId: character.id, title: 'New conversation', updatedAt: Date.now(),
    personaId, personaOverride: false,
    messages: [{ id: crypto.randomUUID(), role: 'assistant', content: character.greeting, createdAt: Date.now() }],
  }
}

export function branchChatFromMessage(chat: Chat, messageIndex: number): Chat {
  if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= chat.messages.length) {
    throw new RangeError('Choose a message in this conversation to branch from.')
  }
  const title = chat.title.trim() || 'New conversation'
  return {
    ...chat,
    id: crypto.randomUUID(),
    title: `Branch · ${title}`.slice(0, 80),
    updatedAt: Date.now(),
    messages: chat.messages.slice(0, messageIndex + 1),
  }
}

export function rewindChatToMessage(chat: Chat, messageIndex: number): Chat {
  if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= chat.messages.length) {
    throw new RangeError('Choose a message in this conversation to rewind to.')
  }
  return { ...chat, messages: chat.messages.slice(0, messageIndex + 1), updatedAt: Date.now() }
}

export function pinnedMessageMemoryEntry(message: Message, speaker: string): string {
  return `Pinned message — ${speaker}:\n${message.content.trim()}`
}

export function togglePinnedMessageMemory(chat: Chat, message: Message, speaker: string): { chat: Chat; pinned: boolean } {
  const entry = pinnedMessageMemoryEntry(message, speaker)
  const currentMemory = chat.permanentMemory ?? ''
  if (currentMemory.includes(entry)) {
    return {
      chat: { ...chat, permanentMemory: currentMemory.replace(entry, '').replace(/\n{3,}/g, '\n\n').trim(), updatedAt: Date.now() },
      pinned: false,
    }
  }
  return {
    chat: { ...chat, permanentMemory: currentMemory.trim() ? `${currentMemory.trim()}\n\n${entry}` : entry, updatedAt: Date.now() },
    pinned: true,
  }
}

export function createCharacter(input: Pick<Character, 'name' | 'tagline' | 'description' | 'personality' | 'scenario' | 'exampleDialogues' | 'greeting'> & Partial<Pick<Character, 'title' | 'nickname' | 'pov' | 'gender' | 'rating' | 'featured' | 'loreEntries' | 'tags' | 'genre' | 'palette' | 'avatarUrl' | 'avatarIcon'>>): Character {
  const palettes: Character['palette'][] = ['moss', 'rose', 'blue', 'gold']
  const initials = input.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
  return {
    ...input, id: crypto.randomUUID(), initials: initials || 'NR',
    description: input.description || input.tagline, tags: input.tags ?? ['Original'], genre: input.genre ?? 'NEW STORY',
    pov: input.pov ?? 'Third person', gender: input.gender ?? 'Unspecified', rating: input.rating ?? 'SFW',
    popularity: 0, pinned: false, nickname: input.nickname ?? '', featured: input.featured ?? false, loreEntries: input.loreEntries ?? [],
    palette: input.palette ?? palettes[Math.floor(Math.random() * palettes.length)] ?? 'moss', favorite: false, createdAt: Date.now(),
  }
}