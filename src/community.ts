import type { Character, ContentRating, LocalProfile, Workspace } from './workspace'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '')
const TOKEN_KEY = 'novarole.api.access-token'

export type CommunityAccount = { id: string; email: string; handle: string; displayName: string }
export type CatalogFilters = { q?: string; genre?: string; tag?: string; pov?: string; gender?: string; rating?: string; sort?: 'recent' | 'popular' | 'featured'; limit?: number; cursor?: string }
export type CatalogPage = { characters: Character[]; nextCursor: string | null }

type AuthResponse = { user: CommunityAccount; accessToken: string }
export type AccountWorkspace = { workspace: Workspace | null; revision: number }
export class WorkspaceConflictError extends Error {}

class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
type ApiCharacter = {
  id: string
  characterId?: string
  name: string
  title?: string
  nickname?: string
  tagline?: string
  description?: string
  personality?: string
  backstory?: string
  scenario?: string
  greeting?: string
  exampleDialogues?: string
  avatarUrl?: string
  tags?: string[]
  genre?: string
  pov?: string
  gender?: string
  rating?: string
  popularity?: number | string
  createdAt?: string | number
  definition?: Record<string, unknown>
}

export async function registerAccount(input: { email: string; handle: string; displayName: string; password: string }): Promise<{ account: CommunityAccount; token: string }> {
  const response = await request<AuthResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  persistSession(response.accessToken)
  return { account: response.user, token: response.accessToken }
}

export async function loginAccount(input: { email: string; password: string }): Promise<{ account: CommunityAccount; token: string }> {
  const response = await request<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  persistSession(response.accessToken)
  return { account: response.user, token: response.accessToken }
}

export async function restoreAccount(): Promise<CommunityAccount | null> {
  const token = getSessionToken()
  if (!token) return null
  try {
    return await request<CommunityAccount>('/api/v1/auth/me', {}, token)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession()
      return null
    }
    throw error
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

export async function fetchAccountWorkspace(): Promise<AccountWorkspace> {
  return request<AccountWorkspace>('/api/v1/workspace')
}

export async function saveAccountWorkspace(workspace: Workspace, revision: number): Promise<number> {
  try {
    const result = await request<{ revision: number }>('/api/v1/workspace', {
      method: 'PUT',
      body: JSON.stringify({ workspace, revision }),
    })
    return result.revision
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new WorkspaceConflictError(error.message)
    }
    throw error
  }
}

export async function fetchCommunityCharacters(filters: CatalogFilters, signal?: AbortSignal): Promise<CatalogPage> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== 'All genres' && value !== 'All tags' && value !== 'All POVs' && value !== 'All genders' && value !== 'All ratings') {
      params.set(key, String(value))
    }
  }
  const page = await request<{ items: ApiCharacter[]; nextCursor: string | null }>(`/api/v1/characters?${params}`, { signal })
  return { characters: page.items.map(toCharacter), nextCursor: page.nextCursor }
}

export async function fetchCommunityCharacter(id: string, signal?: AbortSignal): Promise<Character> {
  const character = await request<ApiCharacter>(`/api/v1/characters/${encodeURIComponent(id)}`, { signal })
  return toCharacter(character)
}

export async function recordCommunityView(id: string, signal?: AbortSignal): Promise<void> {
  await request(`/api/v1/characters/${encodeURIComponent(id)}/view`, { method: 'POST', signal })
}

export async function publishCommunityCharacter(character: Character): Promise<{ id: string; moderationStatus: string }> {
  return request('/api/v1/characters', {
    method: 'POST',
    body: JSON.stringify({
      name: character.name,
      nickname: character.nickname,
      tagline: character.tagline,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario,
      greeting: character.greeting,
      exampleDialogues: character.exampleDialogues,
      tags: character.tags,
      genre: character.genre,
      pov: character.pov,
      gender: character.gender,
      rating: character.rating ?? 'SFW',
      visibility: 'public',
      definition: { title: character.title ?? '', loreEntries: character.loreEntries ?? [], palette: character.palette, avatarIcon: character.avatarIcon },
    }),
  })
}

export function profileFromAccount(account: CommunityAccount): LocalProfile {
  return { displayName: account.displayName, email: account.email, createdAt: Date.now() }
}

function persistSession(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

function getSessionToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) return token
  const legacyToken = sessionStorage.getItem(TOKEN_KEY)
  if (legacyToken) {
    localStorage.setItem(TOKEN_KEY, legacyToken)
    sessionStorage.removeItem(TOKEN_KEY)
    return legacyToken
  }
  return null
}

async function request<T = unknown>(path: string, init: RequestInit = {}, token = getSessionToken()): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
    throw new Error('Community service is offline. Start the NovaRole API to use online features.')
  }
  const payload = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new ApiError(payload?.error || `Community service returned ${response.status}.`, response.status)
  return payload as T
}

function toCharacter(record: ApiCharacter): Character {
  const definition = record.definition ?? {}
  const tags = record.tags?.filter((tag) => typeof tag === 'string' && tag.trim()) ?? []
  const rating = normalizeRating(record.rating)
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.parse(record.createdAt ?? '')
  const initials = record.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'NR'
  return {
    id: record.characterId ?? record.id,
    name: record.name,
    title: typeof definition.title === 'string' && definition.title.trim() ? definition.title : record.title || record.tagline || record.name,
    initials,
    tagline: record.tagline ?? '',
    description: record.description ?? '',
    personality: record.personality ?? '',
    scenario: record.scenario ?? '',
    exampleDialogues: record.exampleDialogues ?? '',
    greeting: record.greeting ?? '',
    tags,
    genre: record.genre ?? 'COMMUNITY',
    palette: isPalette(definition.palette) ? definition.palette : 'blue',
    favorite: false,
    pinned: false,
    nickname: record.nickname ?? '',
    pov: record.pov ?? 'Third person',
    gender: record.gender ?? 'Unspecified',
    rating,
    popularity: Number(record.popularity ?? 0),
    featured: definition.featured === true,
    loreEntries: normalizeLoreEntries(definition.loreEntries),
    avatarUrl: record.avatarUrl || undefined,
    avatarIcon: typeof definition.avatarIcon === 'string' ? definition.avatarIcon : undefined,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  }
}

function normalizeRating(value: string | undefined): ContentRating {
  const normalized = value?.toLowerCase()
  if (normalized === 'limited') return 'Limited'
  if (normalized === 'limitless') return 'Limitless'
  if (normalized === 'mature') return 'Mature'
  return 'SFW'
}

function isPalette(value: unknown): value is Character['palette'] {
  return value === 'moss' || value === 'rose' || value === 'blue' || value === 'gold'
}

function normalizeLoreEntries(value: unknown): NonNullable<Character['loreEntries']> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.content !== 'string' || !Array.isArray(candidate.keywords)) return []
    const keywords = candidate.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
    return [{ id: typeof candidate.id === 'string' ? candidate.id : crypto.randomUUID(), content: candidate.content, keywords, enabled: candidate.enabled !== false }]
  })
}
