import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { branchChatFromMessage, createCharacter, loadWorkspace, parseWorkspaceBackup, rewindChatToMessage, saveWorkspace, togglePinnedMessageMemory } from '../src/workspace'

let values: Map<string, string>

beforeEach(() => {
  values = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    },
  })
})

test('starts with the starter workspace when storage is empty', () => {
  const result = loadWorkspace()
  assert.equal(result.recovery, undefined)
  assert.ok(result.workspace.characters.length > 0)
})

test('preserves unreadable JSON and reports recovery instead of deleting it', () => {
  const saved = '{"broken":'
  values.set('novarole.workspace.v1', saved)

  const result = loadWorkspace()

  assert.equal(result.recovery?.rawData, saved)
  assert.match(result.recovery?.message ?? '', /not valid JSON/)
  assert.equal(values.get('novarole.workspace.v1'), saved)
})

test('preserves valid JSON with an unsupported workspace shape', () => {
  const saved = JSON.stringify({ characters: 'not-an-array', chats: [] })
  values.set('novarole.workspace.v1', saved)

  const result = loadWorkspace()

  assert.equal(result.recovery?.rawData, saved)
  assert.match(result.recovery?.message ?? '', /unsupported or incomplete/)
  assert.equal(values.get('novarole.workspace.v1'), saved)
})

test('reports browser storage read failures without attempting to clear storage', () => {
  let removeAttempted = false
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => { throw new Error('storage is blocked') },
      removeItem: () => { removeAttempted = true },
    },
  })

  const result = loadWorkspace()

  assert.match(result.recovery?.message ?? '', /could not read/)
  assert.equal(result.recovery?.rawData, undefined)
  assert.equal(removeAttempted, false)
})

test('loads and normalizes a valid existing workspace', () => {
  const workspace = loadWorkspace().workspace
  values.set('novarole.workspace.v1', JSON.stringify(workspace))

  const result = loadWorkspace()

  assert.equal(result.recovery, undefined)
  assert.equal(result.workspace.characters.length, workspace.characters.length)
  assert.equal(result.workspace.chats[0]?.generationSettings?.contextTokens, 8192)
})

test('preserves selected character icons in saved workspaces', () => {
  const workspace = loadWorkspace().workspace
  const character = createCharacter({
    name: 'Mara Venn',
    title: 'The midnight librarian',
    tagline: 'A keeper of impossible books',
    description: 'A librarian in a hidden archive.',
    personality: '',
    scenario: '',
    exampleDialogues: '',
    greeting: 'The library doors open.',
    genre: 'Fantasy',
    tags: ['Mystery', 'Cozy'],
    gender: 'Woman',
    avatarIcon: '🌙',
  })
  workspace.characters.push(character)
  saveWorkspace(workspace)

  const loaded = loadWorkspace().workspace.characters.find((item) => item.id === character.id)

  assert.equal(loaded?.avatarIcon, '🌙')
  assert.equal(loaded?.title, 'The midnight librarian')
  assert.deepEqual(loaded?.tags, ['Mystery', 'Cozy'])
  assert.equal(loaded?.gender, 'Woman')
})

test('accepts a valid portable backup and rejects unsupported backup data', () => {
  const workspace = loadWorkspace().workspace
  const backup = JSON.stringify({ format: 'novarole-workspace', version: 1, workspace })

  assert.equal(parseWorkspaceBackup(backup).characters.length, workspace.characters.length)
  assert.throws(() => parseWorkspaceBackup('{}'), /not a supported NovaRole workspace backup/)
})

test('reports storage write failures without throwing', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: () => { throw new Error('quota exceeded') } },
  })

  assert.equal(saveWorkspace(loadWorkspace().workspace), false)
})

test('branches a conversation through the selected message without altering its source', () => {
  const chat = loadWorkspace().workspace.chats[0]!
  const branch = branchChatFromMessage(chat, 1)

  assert.notEqual(branch.id, chat.id)
  assert.equal(branch.messages.length, 2)
  assert.equal(chat.messages.length, 3)
  assert.equal(branch.characterId, chat.characterId)
})

test('rewinds a conversation through the selected message', () => {
  const chat = loadWorkspace().workspace.chats[0]!
  const rewound = rewindChatToMessage(chat, 1)

  assert.equal(rewound.id, chat.id)
  assert.equal(rewound.messages.length, 2)
  assert.equal(chat.messages.length, 3)
})

test('toggles a message in and out of permanent memory', () => {
  const chat = loadWorkspace().workspace.chats[0]!
  const message = chat.messages[1]!
  const pinned = togglePinnedMessageMemory(chat, message, 'You')
  const unpinned = togglePinnedMessageMemory(pinned.chat, message, 'You')

  assert.equal(pinned.pinned, true)
  assert.match(pinned.chat.permanentMemory ?? '', /What makes you think it is a signal/)
  assert.equal(unpinned.pinned, false)
  assert.equal(unpinned.chat.permanentMemory, '')
})
