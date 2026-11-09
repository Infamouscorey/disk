import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSystemPrompt } from '../src/ollama'
import { loadWorkspace } from '../src/workspace'

test('system prompt applies the selected point of view and character gender', () => {
  const character = {
    ...loadWorkspace().workspace.characters[0]!,
    pov: 'First person',
    gender: 'Woman',
  }
  const prompt = buildSystemPrompt({
    model: 'test-model',
    character,
    messages: [],
    temperature: 0.8,
    topP: 0.9,
    contextTokens: 8192,
    responseLength: 'Balanced',
    mode: 'Standard',
    signal: new AbortController().signal,
    onToken: () => {},
  })

  assert.match(prompt, /first person point of view/)
  assert.match(prompt, /Character gender: Woman/)
})
