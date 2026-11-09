import { createCharacter } from './workspace'
import type { Character } from './workspace'

type CharacterCard = Record<string, unknown>

export async function importCharacterFile(file: File): Promise<Character> {
  let card: CharacterCard
  if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
    const parsed: unknown = JSON.parse(await file.text())
    const record = asRecord(parsed)
    if (!record) throw new Error('The JSON file must contain a character card object.')
    card = record
  } else if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') {
    card = parsePngCard(await file.arrayBuffer())
  } else {
    throw new Error('Choose a SillyTavern JSON character card or PNG card image.')
  }

  const data = asRecord(card.data) ?? card
  const name = text(data.name) || text(data.char_name) || text(data.title)
  if (!name) throw new Error('This file does not contain a character name.')

  const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())) : []
  const ratingValue = (text(data.rating) || text(data.content_rating)).toLowerCase()
  const rating = (['sfw', 'limited', 'limitless', 'mature'] as const).find((value) => value === ratingValue)
  const greeting = text(data.first_mes) || text(data.greeting) || firstText(data.alternate_greetings) || 'A new story is ready to begin.'
  const tagline = text(data.tagline) || tags[0] || 'Imported character'
  const character = createCharacter({
    name,
    title: text(data.story_title) || text(data.scenario_title) || tagline,
    tagline,
    description: text(data.description) || text(data.summary) || name,
    personality: text(data.personality) || text(data.backstory),
    scenario: text(data.scenario),
    exampleDialogues: text(data.mes_example) || text(data.example_dialogue),
    greeting,
    pov: text(data.pov) || 'Third person',
    gender: text(data.gender) || 'Unspecified',
    rating: rating ? rating[0].toUpperCase() + rating.slice(1) as Character['rating'] : 'SFW',
  })
  return {
    ...character,
    tags: tags.length ? tags : ['Imported'],
    genre: text(data.genre).toUpperCase() || 'IMPORTED',
  }
}

function parsePngCard(buffer: ArrayBuffer): CharacterCard {
  const bytes = new Uint8Array(buffer)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (signature.some((byte, index) => bytes[index] !== byte)) throw new Error('This PNG file is not valid.')

  const view = new DataView(buffer)
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false)
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
    const start = offset + 8
    const end = start + length
    if (end + 4 > bytes.length) throw new Error('The PNG metadata is incomplete.')

    if (type === 'tEXt' || type === 'iTXt') {
      const entry = readPngText(type, bytes.subarray(start, end))
      if (entry?.key === 'chara') return parseCardText(entry.value)
    }
    if (type === 'IEND') break
    offset = end + 4
  }
  throw new Error('No SillyTavern `chara` data was found in this PNG.')
}

function readPngText(type: string, chunk: Uint8Array): { key: string; value: string } | null {
  const decoder = new TextDecoder()
  const keywordEnd = chunk.indexOf(0)
  if (keywordEnd < 0) return null
  const key = decoder.decode(chunk.subarray(0, keywordEnd))
  if (type === 'tEXt') return { key, value: decoder.decode(chunk.subarray(keywordEnd + 1)) }

  let offset = keywordEnd + 1
  const compressed = chunk[offset] === 1
  offset += 2
  const languageEnd = chunk.indexOf(0, offset)
  if (languageEnd < 0) return null
  offset = languageEnd + 1
  const translatedEnd = chunk.indexOf(0, offset)
  if (translatedEnd < 0) return null
  offset = translatedEnd + 1
  if (compressed) throw new Error('Compressed PNG character metadata is not supported yet. Export the card as JSON instead.')
  return { key, value: decoder.decode(chunk.subarray(offset)) }
}

function parseCardText(value: string): CharacterCard {
  const trimmed = value.trim()
  const decoded = trimmed.startsWith('{') ? trimmed : decodeBase64(trimmed)
  try {
    const parsed: unknown = JSON.parse(decoded)
    const record = asRecord(parsed)
    if (!record) throw new Error('Invalid card data.')
    return record
  } catch {
    throw new Error('The character card metadata is not valid JSON.')
  }
}

function decodeBase64(value: string): string {
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    throw new Error('The PNG character metadata is not valid base64.')
  }
}

function asRecord(value: unknown): CharacterCard | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as CharacterCard : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstText(value: unknown): string {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === 'string' && Boolean(item.trim()))?.trim() ?? '' : ''
}