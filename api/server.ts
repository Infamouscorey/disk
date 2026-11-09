import 'dotenv/config'
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { Pool } from 'pg'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; handle: string; role: string }
    user: { sub: string; email: string; handle: string; role: string }
  }
}

const scrypt = promisify(scryptCallback)
const host = process.env.API_HOST ?? '127.0.0.1'
const port = Number(process.env.API_PORT ?? 3001)
const databaseUrl = process.env.DATABASE_URL
const jwtSecret = process.env.JWT_SECRET
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean)

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid TCP port.')

const database = new Pool({ connectionString: databaseUrl, max: 20, idleTimeoutMillis: 30_000 })
const app = Fastify({ logger: true, bodyLimit: 1_000_000 })

await app.register(cors, { origin: allowedOrigins, credentials: true })
await app.register(rateLimit, { max: 120, timeWindow: '15 minutes' })
await app.register(jwt, { secret: jwtSecret, sign: { expiresIn: '30d' } })

app.setErrorHandler((error, request, reply) => {
  if (typeof error === 'object' && error !== null && 'validation' in error && error.validation) {
    return reply.code(400).send({ error: 'Invalid request.', details: error.validation })
  }
  request.log.error(error)
  return reply.code(500).send({ error: 'The request could not be completed.' })
})

type RegisterBody = { email: string; handle: string; displayName: string; password: string }
type LoginBody = { email: string; password: string }
type WorkspaceBody = { workspace: unknown; revision: number }
type CharacterBody = {
  name: string
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
  rating?: 'SFW' | 'Limited' | 'Limitless' | 'Mature'
  visibility?: 'private' | 'unlisted' | 'public'
  definition?: Record<string, unknown>
}
type CatalogQuery = { q?: string; genre?: string; tag?: string; pov?: string; gender?: string; rating?: string; sort?: 'recent' | 'popular' | 'featured'; limit?: number; cursor?: string }

const authPreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify()
  } catch {
    await reply.code(401).send({ error: 'Sign in is required.' })
  }
}

app.get('/health', async (_request, reply) => {
  await database.query('select 1')
  return reply.send({ status: 'ok' })
})

app.post<{ Body: RegisterBody }>('/api/v1/auth/register', {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  schema: {
    body: {
      type: 'object', additionalProperties: false,
      required: ['email', 'handle', 'displayName', 'password'],
      properties: {
        email: { type: 'string', format: 'email', maxLength: 254 },
        handle: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[a-zA-Z0-9_]+$' },
        displayName: { type: 'string', minLength: 1, maxLength: 48 },
        password: { type: 'string', minLength: 12, maxLength: 128 },
      },
    },
  },
}, async (request, reply) => {
  const { email, handle, displayName, password } = request.body
  const normalizedEmail = email.trim().toLowerCase()
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, salt, 64) as Buffer
  try {
    const result = await database.query<{ id: string; email: string; handle: string; display_name: string; role: string }>(
      'insert into users (email, handle, display_name, password_hash) values ($1, $2, $3, $4) returning id, email, handle, display_name, role',
      [normalizedEmail, handle.toLowerCase(), displayName.trim(), `${salt}:${hash.toString('hex')}`],
    )
    const user = result.rows[0]
    if (!user) return reply.code(500).send({ error: 'Account could not be created.' })
    const accessToken = await reply.jwtSign({ sub: user.id, email: user.email, handle: user.handle, role: user.role })
    return reply.code(201).send({ user: { id: user.id, email: user.email, handle: user.handle, displayName: user.display_name }, accessToken })
  } catch (error) {
    if (isUniqueViolation(error)) return reply.code(409).send({ error: 'That email or handle is already registered.' })
    throw error
  }
})

app.post<{ Body: LoginBody }>('/api/v1/auth/login', {
  config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['email', 'password'],
      properties: { email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', minLength: 1, maxLength: 128 } },
    },
  },
}, async (request, reply) => {
  const result = await database.query<{ id: string; email: string; handle: string; display_name: string; password_hash: string; role: string }>(
    'select id, email, handle, display_name, password_hash, role from users where email = $1',
    [request.body.email.trim().toLowerCase()],
  )
  const user = result.rows[0]
  if (!user || !await verifyPassword(request.body.password, user.password_hash)) {
    return reply.code(401).send({ error: 'Email or password is incorrect.' })
  }
  const accessToken = await reply.jwtSign({ sub: user.id, email: user.email, handle: user.handle, role: user.role })
  return reply.send({ user: { id: user.id, email: user.email, handle: user.handle, displayName: user.display_name }, accessToken })
})

app.get('/api/v1/auth/me', { preHandler: authPreHandler }, async (request, reply) => {
  const result = await database.query<{ id: string; email: string; handle: string; display_name: string }>(
    'select id, email, handle, display_name from users where id = $1',
    [request.user.sub],
  )
  const user = result.rows[0]
  if (!user) return reply.code(401).send({ error: 'Account is no longer available.' })
  return reply.send({ id: user.id, email: user.email, handle: user.handle, displayName: user.display_name })
})

app.get('/api/v1/workspace', { preHandler: authPreHandler }, async (request, reply) => {
  const result = await database.query<{ workspace: unknown; revision: number }>(
    'select workspace, revision from account_workspaces where user_id = $1',
    [request.user.sub],
  )
  const stored = result.rows[0]
  return reply.send({ workspace: stored?.workspace ?? null, revision: stored?.revision ?? 0 })
})

app.put<{ Body: WorkspaceBody }>('/api/v1/workspace', {
  bodyLimit: 9 * 1024 * 1024,
  preHandler: authPreHandler,
  config: { rateLimit: { max: 60, timeWindow: '15 minutes' } },
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['workspace', 'revision'],
      properties: { workspace: { type: 'object' }, revision: { type: 'integer', minimum: 0 } },
    },
  },
}, async (request, reply) => {
  if (!isWorkspace(request.body.workspace)) return reply.code(400).send({ error: 'Workspace data is invalid.' })
  const serialized = JSON.stringify(request.body.workspace)
  if (Buffer.byteLength(serialized, 'utf8') > 8 * 1024 * 1024) {
    return reply.code(413).send({ error: 'Workspace is too large to sync (8 MB maximum).' })
  }
  const result = await database.query<{ revision: number }>(
    `insert into account_workspaces (user_id, workspace, revision)
     values ($1, $2::jsonb, 1)
     on conflict (user_id) do update
     set workspace = excluded.workspace, revision = account_workspaces.revision + 1, updated_at = now()
     where account_workspaces.revision = $3
     returning revision`,
    [request.user.sub, serialized, request.body.revision],
  )
  const saved = result.rows[0]
  if (!saved) return reply.code(409).send({ error: 'Workspace changed on another device. Sync again to merge both versions.' })
  return reply.send({ revision: saved.revision })
})

app.get<{ Querystring: CatalogQuery }>('/api/v1/characters', {
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      properties: {
        q: { type: 'string', maxLength: 120 }, genre: { type: 'string', maxLength: 48 }, tag: { type: 'string', maxLength: 48 },
        pov: { type: 'string', maxLength: 32 }, gender: { type: 'string', maxLength: 32 },
        rating: { type: 'string', enum: ['SFW', 'Limited', 'Limitless', 'Mature'] },
        sort: { type: 'string', enum: ['recent', 'popular', 'featured'], default: 'recent' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 24 }, cursor: { type: 'string', maxLength: 512 },
      },
    },
  },
}, async (request, reply) => {
  const { q, genre, tag, pov, gender, rating, cursor, sort = 'recent', limit = 24 } = request.query
  const filters = ["c.visibility = 'public'", "c.moderation_status = 'approved'", 'c.current_version_id = cv.id']
  const values: unknown[] = []
  const bind = (value: unknown) => { values.push(value); return `$${values.length}` }
  if (q?.trim()) filters.push(`to_tsvector('simple', cv.name || ' ' || coalesce(cv.definition->>'title', '') || ' ' || cv.tagline || ' ' || cv.description || ' ' || array_to_string(cv.tags, ' ')) @@ websearch_to_tsquery('simple', ${bind(q.trim())})`)
  if (genre) filters.push(`lower(cv.genre) = lower(${bind(genre)})`)
  if (tag) filters.push(`cv.tags @> array[${bind(tag)}]::text[]`)
  if (pov) filters.push(`lower(cv.pov) = lower(${bind(pov)})`)
  if (gender) filters.push(`lower(cv.gender) = lower(${bind(gender)})`)
  if (rating) filters.push(`cv.content_rating = ${bind(rating.toLowerCase())}`)
  if (cursor) {
    const decoded = decodeCursor(cursor)
    if (!decoded) return reply.code(400).send({ error: 'The catalog cursor is invalid.' })
    if (sort === 'popular') filters.push(`(cv.view_count, cv.created_at, cv.id) < (${bind(decoded.views)}::bigint, ${bind(decoded.createdAt)}::timestamptz, ${bind(decoded.id)}::uuid)`)
    else if (sort === 'featured') filters.push(`(coalesce((cv.definition->>'featured')::boolean, false), cv.created_at, cv.id) < (${bind(decoded.featured)}::boolean, ${bind(decoded.createdAt)}::timestamptz, ${bind(decoded.id)}::uuid)`)
    else filters.push(`(cv.created_at, cv.id) < (${bind(decoded.createdAt)}::timestamptz, ${bind(decoded.id)}::uuid)`)
  }
  const order = sort === 'popular'
    ? 'cv.view_count desc, cv.created_at desc, cv.id desc'
    : sort === 'featured'
      ? "coalesce((cv.definition->>'featured')::boolean, false) desc, cv.created_at desc, cv.id desc"
      : 'cv.created_at desc, cv.id desc'
  values.push(limit + 1)
  const result = await database.query(
    `select cv.id, cv.character_id as "characterId", cv.name, cv.definition->>'title' as title, cv.nickname, cv.tagline, cv.description, cv.avatar_url as "avatarUrl", cv.tags, cv.genre, cv.pov, cv.gender, cv.content_rating as rating, cv.view_count as popularity, cv.created_at as "createdAt", coalesce((cv.definition->>'featured')::boolean, false) as featured
     from characters c join character_versions cv on c.current_version_id = cv.id
     where ${filters.join(' and ')} order by ${order} limit $${values.length}`,
    values,
  )
  const hasMore = result.rows.length > limit
  const items = hasMore ? result.rows.slice(0, limit) : result.rows
  const last = items.at(-1) as { id?: string; createdAt?: Date; popularity?: string; featured?: boolean } | undefined
  const nextCursor = hasMore && last?.id && last.createdAt
    ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString(), views: String(last.popularity ?? '0'), featured: last.featured ?? false })
    : null
  return reply.send({ items, nextCursor })
})

app.get<{ Params: { id: string } }>('/api/v1/characters/:id', {
  schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } },
}, async (request, reply) => {
  const result = await database.query(
    `select cv.id, cv.character_id as "characterId", cv.name, cv.nickname, cv.tagline, cv.description, cv.personality,
            cv.backstory, cv.scenario, cv.greeting, cv.example_dialogues as "exampleDialogues", cv.avatar_url as "avatarUrl",
            cv.tags, cv.genre, cv.pov, cv.gender, cv.content_rating as rating, cv.view_count as popularity,
            cv.definition, cv.created_at as "createdAt"
     from characters c join character_versions cv on c.current_version_id = cv.id
     where c.id = $1 and c.visibility = 'public' and c.moderation_status = 'approved'`,
    [request.params.id],
  )
  if (!result.rowCount) return reply.code(404).send({ error: 'Public character not found.' })
  return reply.send(result.rows[0])
})

app.post<{ Body: CharacterBody }>('/api/v1/characters', {
  preHandler: authPreHandler,
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 }, nickname: { type: 'string', maxLength: 80 }, tagline: { type: 'string', maxLength: 180 },
        description: { type: 'string', maxLength: 20_000 }, personality: { type: 'string', maxLength: 20_000 }, backstory: { type: 'string', maxLength: 20_000 },
        scenario: { type: 'string', maxLength: 20_000 }, greeting: { type: 'string', maxLength: 20_000 }, exampleDialogues: { type: 'string', maxLength: 20_000 },
        avatarUrl: { type: 'string', maxLength: 2048 }, tags: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 48 } },
        genre: { type: 'string', maxLength: 48 }, pov: { type: 'string', maxLength: 32 }, gender: { type: 'string', maxLength: 32 },
        rating: { type: 'string', enum: ['SFW', 'Limited', 'Limitless', 'Mature'] },
        visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] }, definition: { type: 'object', maxProperties: 64 },
      },
    },
  },
}, async (request, reply) => {
  const client = await database.connect()
  const characterId = randomUUID()
  const versionId = randomUUID()
  const body = request.body
  try {
    await client.query('begin')
    await client.query(
      'insert into characters (id, creator_id, visibility, moderation_status) values ($1, $2, $3, $4)',
      [characterId, request.user.sub, body.visibility ?? 'public', body.visibility === 'private' ? 'approved' : 'pending'],
    )
    await client.query(
      `insert into character_versions (id, character_id, version, name, nickname, tagline, description, personality, backstory, scenario, greeting, example_dialogues, avatar_url, tags, genre, pov, gender, content_rating, definition)
       values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [versionId, characterId, body.name.trim(), body.nickname ?? '', body.tagline ?? '', body.description ?? '', body.personality ?? '', body.backstory ?? '', body.scenario ?? '', body.greeting ?? '', body.exampleDialogues ?? '', body.avatarUrl ?? '', body.tags ?? [], body.genre ?? '', body.pov ?? 'Third person', body.gender ?? 'Unspecified', (body.rating ?? 'SFW').toLowerCase(), { ...(body.definition ?? {}), featured: false }],
    )
    await client.query('update characters set current_version_id = $1 where id = $2', [versionId, characterId])
    await client.query('commit')
    return reply.code(201).send({ id: characterId, versionId, moderationStatus: body.visibility === 'private' ? 'approved' : 'pending' })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
})

app.post<{ Params: { id: string } }>('/api/v1/characters/:id/view', {
  schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } },
  config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
}, async (request, reply) => {
  const result = await database.query(
    `update character_versions cv set view_count = cv.view_count + 1
     from characters c where c.current_version_id = cv.id and c.id = $1 and c.visibility = 'public' and c.moderation_status = 'approved'
     returning cv.view_count`,
    [request.params.id],
  )
  if (!result.rowCount) return reply.code(404).send({ error: 'Character not found.' })
  return reply.send({ ok: true })
})

app.post<{ Params: { id: string }; Body: { reason: string; details?: string } }>('/api/v1/characters/:id/reports', {
  preHandler: authPreHandler,
  schema: {
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    body: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 2, maxLength: 80 }, details: { type: 'string', maxLength: 2000 } } },
  },
}, async (request, reply) => {
  const result = await database.query(
    'insert into moderation_reports (character_id, reporter_id, reason, details) select id, $2, $3, $4 from characters where id = $1 and visibility <> $5 returning id',
    [request.params.id, request.user.sub, request.body.reason.trim(), request.body.details?.trim() ?? '', 'private'],
  )
  if (!result.rowCount) return reply.code(404).send({ error: 'Public character not found.' })
  return reply.code(202).send({ accepted: true })
})

app.post<{ Params: { id: string }; Body: { action: 'approve' | 'reject'; reason?: string } }>('/api/v1/moderation/characters/:id', {
  preHandler: authPreHandler,
  schema: {
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    body: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', enum: ['approve', 'reject'] }, reason: { type: 'string', maxLength: 1000 } } },
  },
}, async (request, reply) => {
  if (request.user.role !== 'moderator' && request.user.role !== 'admin') return reply.code(403).send({ error: 'Moderator permission is required.' })
  const status = request.body.action === 'approve' ? 'approved' : 'rejected'
  const client = await database.connect()
  try {
    await client.query('begin')
    const changed = await client.query('update characters set moderation_status = $2 where id = $1 returning id', [request.params.id, status])
    if (!changed.rowCount) {
      await client.query('rollback')
      return reply.code(404).send({ error: 'Character not found.' })
    }
    await client.query('insert into moderation_events (character_id, moderator_id, action, reason) values ($1, $2, $3, $4)', [request.params.id, request.user.sub, request.body.action, request.body.reason?.trim() ?? ''])
    await client.query('commit')
    return reply.send({ status })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
})

app.addHook('onClose', async () => database.end())

try {
  await app.listen({ host, port })
} catch (error) {
  app.log.error(error)
  await database.end()
  process.exitCode = 1
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expectedHex] = stored.split(':')
  if (!salt || !expectedHex || !/^[0-9a-f]{128}$/i.test(expectedHex)) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = await scrypt(password, salt, expected.length) as Buffer
  return timingSafeEqual(expected, actual)
}

function isWorkspace(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const workspace = value as Record<string, unknown>
  if (!Array.isArray(workspace.characters) || !Array.isArray(workspace.chats)) return false
  if (workspace.characters.length > 500 || workspace.chats.length > 1000) return false
  if (workspace.defaultPersonaId !== undefined && typeof workspace.defaultPersonaId !== 'string') return false
  if (workspace.profile !== undefined && workspace.profile !== null &&
    (!isRecord(workspace.profile) || typeof workspace.profile.displayName !== 'string' ||
      typeof workspace.profile.email !== 'string' || typeof workspace.profile.createdAt !== 'number')) return false
  const validCharacters = workspace.characters.every((character) =>
    isRecord(character) && typeof character.id === 'string' && typeof character.name === 'string' &&
    Array.isArray(character.tags) && character.tags.every((tag) => typeof tag === 'string') &&
    typeof character.createdAt === 'number' && Number.isFinite(character.createdAt),
  )
  const validChats = workspace.chats.every((chat) =>
    isRecord(chat) && typeof chat.id === 'string' && typeof chat.characterId === 'string' &&
    typeof chat.title === 'string' && typeof chat.updatedAt === 'number' && Number.isFinite(chat.updatedAt) &&
    Array.isArray(chat.messages) && chat.messages.length <= 10_000 &&
    chat.messages.every((message) =>
      isRecord(message) && typeof message.id === 'string' &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' && typeof message.createdAt === 'number' && Number.isFinite(message.createdAt),
    ),
  )
  const validPersonas = workspace.personas === undefined ||
    (Array.isArray(workspace.personas) && workspace.personas.length <= 100 &&
      workspace.personas.every((persona) => isRecord(persona) && typeof persona.id === 'string' &&
        typeof persona.name === 'string' && typeof persona.description === 'string' &&
        typeof persona.createdAt === 'number' && Number.isFinite(persona.createdAt)))
  return validCharacters && validChats && validPersonas
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

type CatalogCursor = { id: string; createdAt: string; views: string; featured: boolean }

function encodeCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(value: string): CatalogCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Partial<CatalogCursor>
    if (typeof candidate.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.id)) return null
    if (typeof candidate.createdAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt))) return null
    return { id: candidate.id, createdAt: candidate.createdAt, views: typeof candidate.views === 'string' ? candidate.views : '0', featured: candidate.featured === true }
  } catch {
    return null
  }
}