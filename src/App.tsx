import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  Copy,
  Download,
  Heart,
  Laptop,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  RotateCcw,
  Share2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Eye,
  EyeOff,
  GitBranch,
  Upload,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { branchChatFromMessage, createChat, createCharacter, loadWorkspace, parseWorkspaceBackup, pinnedMessageMemoryEntry, rewindChatToMessage, saveWorkspace, togglePinnedMessageMemory } from './workspace'
import { mergeWorkspaces } from './workspace'
import type { Character, Chat, GenerationSettings, LocalProfile, MemoryFact, Message, Persona, Theme, Workspace, WorkspaceRecovery } from './workspace'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getProviderModels, getProviderName, loadAiProviderConfig, saveAiProviderConfig, streamProviderChat } from './openaiCompatible'
import type { AiProvider, AiProviderConfig } from './openaiCompatible'
import { replaceUserPlaceholder } from './ollama'
import { importCharacterFile } from './characterImport'
import {
  clearSession,
  fetchCommunityCharacter,
  fetchCommunityCharacters,
  fetchAccountWorkspace,
  profileFromAccount,
  publishCommunityCharacter,
  recordCommunityView,
  registerAccount,
  restoreAccount,
  loginAccount,
  saveAccountWorkspace,
  WorkspaceConflictError,
} from './community'
import type { CommunityAccount } from './community'
import './App.css'

type View = 'chat' | 'discover'
type OllamaState = 'checking' | 'ready' | 'missing' | 'empty'
type LibraryFilter = 'all' | 'favorites' | 'featured' | 'trending' | 'recommended' | 'similar'
type CatalogSource = 'local' | 'community'
type SyncStatus = 'local' | 'loading' | 'synced' | 'saving' | 'error'

const emptyMessages: Message[] = []

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
}

function App() {
  const [initialLoad] = useState(loadWorkspace)
  const [workspace, setWorkspace] = useState<Workspace>(initialLoad.workspace)
  const [workspaceRecovery, setWorkspaceRecovery] = useState<WorkspaceRecovery | null>(initialLoad.recovery ?? null)
  const [workspaceRecoveryError, setWorkspaceRecoveryError] = useState('')
  const [activeChatId, setActiveChatId] = useState(() => workspace.chats[0]?.id ?? '')
  const [view, setView] = useState<View>('discover')
  const [search, setSearch] = useState('')
  const [conversationSearch, setConversationSearch] = useState('')
  const [renamingChatId, setRenamingChatId] = useState('')
  const [chatTitleDraft, setChatTitleDraft] = useState('')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [genreFilter, setGenreFilter] = useState('All genres')
  const [tagFilter, setTagFilter] = useState('All tags')
  const [povFilter, setPovFilter] = useState('All POVs')
  const [genderFilter, setGenderFilter] = useState('All genders')
  const [ratingFilter, setRatingFilter] = useState('All ratings')
  const [sortBy, setSortBy] = useState('Recently added')
  const [similarToId, setSimilarToId] = useState('')
  const [catalogSource, setCatalogSource] = useState<CatalogSource>('local')
  const [communityCharacters, setCommunityCharacters] = useState<Character[]>([])
  const [communityLoading, setCommunityLoading] = useState(false)
  const [communityError, setCommunityError] = useState('')
  const [communityCursor, setCommunityCursor] = useState<string | null>(null)
  const [communityRefresh, setCommunityRefresh] = useState(0)
  const [publishingCharacterId, setPublishingCharacterId] = useState('')
  const [communityAccount, setCommunityAccount] = useState<CommunityAccount | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('local')
  const [draft, setDraft] = useState('')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('novarole.theme') as Theme) || 'dark')
  const [ollamaState, setOllamaState] = useState<OllamaState>('checking')
  const [models, setModels] = useState<string[]>([])
  const [aiProviderConfig, setAiProviderConfig] = useState<AiProviderConfig>(() => loadAiProviderConfig())
  const [model, setModel] = useState(() => localStorage.getItem('novarole.model') ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('novarole.welcome-seen') && workspace.characters.length === 0 && workspace.chats.length === 0)
  const [showProfile, setShowProfile] = useState(false)
  const [showPersonas, setShowPersonas] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isEnhancingDraft, setIsEnhancingDraft] = useState(false)
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const [showDetails, setShowDetails] = useState(() => window.matchMedia('(min-width: 861px)').matches)
  const [notice, setNotice] = useState('')
  const [streamingChatId, setStreamingChatId] = useState('')
  const [editingTarget, setEditingTarget] = useState<{ chatId: string; messageId: string } | null>(null)
  const [openMessageMenuId, setOpenMessageMenuId] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const enhancementControllerRef = useRef<AbortController | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const cloudReadyRef = useRef(false)
  const cloudRevisionRef = useRef(0)
  const syncInFlightRef = useRef(false)
  const lastSyncedWorkspaceRef = useRef('')
  const workspaceRef = useRef(workspace)
  const initialWorkspaceRef = useRef(workspace)
  workspaceRef.current = workspace

  const activeChat = workspace.chats.find((chat) => chat.id === activeChatId) ?? workspace.chats[0]
  const activeCharacter = workspace.characters.find((character) => character.id === activeChat?.characterId) ?? workspace.characters[0]
  const recentChat = [...workspace.chats].sort((left, right) => right.updatedAt - left.updatedAt)
    .find((chat) => workspace.characters.some((character) => character.id === chat.characterId))
  const recentCharacter = workspace.characters.find((character) => character.id === recentChat?.characterId) ?? null
  const matchingChats = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase()
    return [...workspace.chats]
      .filter((chat) => {
        const character = workspace.characters.find((item) => item.id === chat.characterId)
        if (!character) return false
        return !query || `${chat.title} ${character.name} ${character.title ?? ''} ${chat.messages.map((message) => message.content).join(' ')}`.toLowerCase().includes(query)
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }, [conversationSearch, workspace.chats, workspace.characters])
  const generationSettings: GenerationSettings = {
    mode: activeChat?.generationSettings?.mode ?? 'Standard',
    responseLength: activeChat?.generationSettings?.responseLength ?? 'Balanced',
    temperature: activeChat?.generationSettings?.temperature ?? 0.8,
    topP: activeChat?.generationSettings?.topP ?? 0.9,
    contextTokens: activeChat?.generationSettings?.contextTokens ?? 8192,
  }
  const matchingCharacters = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return workspace.characters.filter((character) =>
      `${character.name} ${character.title ?? ''} ${character.tagline} ${character.description} ${character.tags.join(' ')}`.toLowerCase().includes(normalizedSearch),
    )
  }, [search, workspace.characters])
  const localVisibleCharacters = useMemo(() => {
    const favorites = matchingCharacters.filter((character) => character.favorite)
    const similarTo = workspace.characters.find((character) => character.id === similarToId)
    const filtered = matchingCharacters.filter((character) => {
      const collectionMatch = libraryFilter === 'all' ||
        (libraryFilter === 'favorites' && character.favorite) ||
        (libraryFilter === 'featured' && character.featured) ||
        (libraryFilter === 'trending') ||
        (libraryFilter === 'recommended' && (!favorites.length || favorites.some((favorite) => favorite.id !== character.id && (favorite.genre === character.genre || favorite.tags.some((tag) => character.tags.includes(tag)))))) ||
        (libraryFilter === 'similar' && Boolean(similarTo && character.id !== similarTo.id && (character.genre === similarTo.genre || character.tags.some((tag) => similarTo.tags.includes(tag)))))
      return collectionMatch &&
        (genreFilter === 'All genres' || character.genre.toLowerCase() === genreFilter.toLowerCase()) &&
        (tagFilter === 'All tags' || character.tags.includes(tagFilter)) &&
        (povFilter === 'All POVs' || character.pov === povFilter) &&
        (genderFilter === 'All genders' || character.gender === genderFilter) &&
        (ratingFilter === 'All ratings' || character.rating === ratingFilter)
    })
    return filtered.sort((left, right) => {
      if (sortBy === 'Name') return left.name.localeCompare(right.name)
      if (sortBy === 'Most loved') return Number(right.favorite) - Number(left.favorite) || right.createdAt - left.createdAt
      if (sortBy === 'Trending here' || libraryFilter === 'trending') return (right.popularity ?? 0) - (left.popularity ?? 0) || right.createdAt - left.createdAt
      return right.createdAt - left.createdAt
    })
  }, [genderFilter, genreFilter, libraryFilter, matchingCharacters, povFilter, ratingFilter, similarToId, sortBy, tagFilter, workspace.characters])
  const visibleCharacters = catalogSource === 'community' ? communityCharacters : localVisibleCharacters
  const facetCharacters = catalogSource === 'community' ? communityCharacters : workspace.characters
  const genres = useMemo(() => ['All genres', ...new Set(facetCharacters.map((character) => character.genre))], [facetCharacters])
  const tags = useMemo(() => ['All tags', ...new Set(facetCharacters.flatMap((character) => character.tags))], [facetCharacters])
  const povs = useMemo(() => ['All POVs', ...new Set(facetCharacters.map((character) => character.pov ?? 'Third person'))], [facetCharacters])
  const genders = useMemo(() => ['All genders', ...new Set(facetCharacters.map((character) => character.gender ?? 'Unspecified'))], [facetCharacters])

  useEffect(() => {
    if (workspaceRecovery) return
    if (!saveWorkspace(workspace)) {
      queueMicrotask(() => setNotice('Your latest changes could not be saved in this browser. Check available storage.'))
    }
  }, [workspace, workspaceRecovery])

  useEffect(() => {
    if (workspaceRecovery) return
    let cancelled = false
    restoreAccount().then(async (account) => {
      if (!account || cancelled) return
      await connectAccount(account, initialWorkspaceRef.current)
    }).catch((error: unknown) => {
      if (!cancelled) {
        setSyncStatus('error')
        setNotice(error instanceof Error ? `Could not restore your account session: ${error.message}` : 'Could not restore your account session.')
      }
    })
    return () => { cancelled = true }
  }, [workspaceRecovery])

  useEffect(() => {
    if (workspaceRecovery) return
    if (!communityAccount || !cloudReadyRef.current) return
    if (JSON.stringify(workspace) === lastSyncedWorkspaceRef.current) return
    const timer = window.setTimeout(() => { void pushWorkspaceSnapshot(workspace) }, 800)
    return () => window.clearTimeout(timer)
  }, [communityAccount, workspace, workspaceRecovery])

  useEffect(() => {
    if (catalogSource !== 'community' || view !== 'discover') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetchCommunityCharacters({
        q: search.trim() || undefined,
        genre: genreFilter === 'All genres' ? undefined : genreFilter,
        tag: tagFilter === 'All tags' ? undefined : tagFilter,
        pov: povFilter === 'All POVs' ? undefined : povFilter,
        gender: genderFilter === 'All genders' ? undefined : genderFilter,
        rating: ratingFilter === 'All ratings' ? undefined : ratingFilter,
        sort: libraryFilter === 'featured' ? 'featured' : libraryFilter === 'trending' || sortBy === 'Trending here' ? 'popular' : sortBy === 'Most loved' ? 'popular' : 'recent',
        limit: 24,
      }, controller.signal).then((page) => {
        setCommunityCharacters(page.characters)
        setCommunityCursor(page.nextCursor)
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCommunityCharacters([])
          setCommunityError(error instanceof Error ? error.message : 'Community catalog is unavailable.')
        }
      }).finally(() => {
        if (!controller.signal.aborted) setCommunityLoading(false)
      })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [catalogSource, communityRefresh, genderFilter, genreFilter, libraryFilter, povFilter, ratingFilter, search, sortBy, tagFilter, view])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('novarole.theme', theme)
  }, [theme])

  useEffect(() => {
    if (model) localStorage.setItem('novarole.model', model)
    else localStorage.removeItem('novarole.model')
  }, [model])

  useEffect(() => {
    if (!editingTarget || editingTarget.chatId !== activeChatId) return
    composerRef.current?.focus()
  }, [activeChatId, editingTarget])

  useEffect(() => {
    if (!openMessageMenuId) return
    function closeMenuOnOutsideAction(event: PointerEvent) {
      if (!(event.target instanceof Element) || !event.target.closest('.message-menu-wrap')) setOpenMessageMenuId('')
    }
    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMessageMenuId('')
    }
    document.addEventListener('pointerdown', closeMenuOnOutsideAction)
    document.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideAction)
      document.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [openMessageMenuId])

  useEffect(() => {
    let cancelled = false
    getProviderModels(aiProviderConfig)
      .then((availableModels) => {
        if (cancelled) return
        setModels(availableModels)
        if (availableModels.length) setModel((current) => current && availableModels.includes(current) ? current : availableModels[0] || '')
        setOllamaState(availableModels.length ? 'ready' : 'empty')
      })
      .catch(() => {
        if (!cancelled) setOllamaState('missing')
      })
    return () => {
      cancelled = true
      controllerRef.current?.abort()
      enhancementControllerRef.current?.abort()
    }
  }, [aiProviderConfig])

  function updateChat(chatId: string, update: (chat: Chat) => Chat, touch = true) {
    setWorkspace((current) => ({
      ...current,
      chats: current.chats.map((chat) => (chat.id === chatId
        ? { ...update(chat), ...(touch ? { updatedAt: Date.now() } : {}) }
        : chat)),
    }))
  }

  function prepareCommunityFetch() {
    setCommunityLoading(true)
    setCommunityError('')
    setCommunityCursor(null)
  }

  function updateGenerationSettings(patch: Partial<GenerationSettings>) {
    if (!activeChat) return
    updateChat(activeChat.id, (chat) => ({
      ...chat,
      generationSettings: { ...generationSettings, ...patch },
    }))
  }

  function openCharacter(character: Character) {
    setWorkspace((current) => ({
      ...current,
      characters: current.characters.map((item) => item.id === character.id ? { ...item, popularity: (item.popularity ?? 0) + 1 } : item),
    }))
    const existingChat = workspace.chats.find((chat) => chat.characterId === character.id)
    if (existingChat) {
      setActiveChatId(existingChat.id)
    } else {
      const chat = createChat(character, workspace.defaultPersonaId)
      setWorkspace((current) => ({ ...current, chats: [chat, ...current.chats] }))
      setActiveChatId(chat.id)
    }
    setView('chat')
    setShowMobileNav(false)
  }

  function surpriseMe() {
    if (!workspace.characters.length) {
      setShowCreate(true)
      return
    }
    const choices = workspace.characters.filter((character) => character.id !== activeCharacter?.id)
    const pool = choices.length ? choices : workspace.characters
    openCharacter(pool[Math.floor(Math.random() * pool.length)])
  }

  function startNewChat(character = activeCharacter) {
    if (!character) return
    const chat = createChat(character, workspace.defaultPersonaId)
    setWorkspace((current) => ({ ...current, chats: [chat, ...current.chats] }))
    setActiveChatId(chat.id)
    setView('chat')
    setShowMobileNav(false)
  }

  function renameChat(chatId: string) {
    const title = chatTitleDraft.trim()
    if (!title) return
    updateChat(chatId, (chat) => ({ ...chat, title: title.slice(0, 80) }))
    setRenamingChatId('')
    setChatTitleDraft('')
  }

  function deleteChat(chat: Chat) {
    if (!window.confirm(`Delete "${chat.title}" and its entire conversation? This cannot be undone.`)) return
    if (streamingChatId === chat.id) controllerRef.current?.abort()
    const remainingChats = workspace.chats.filter((item) => item.id !== chat.id)
    setWorkspace((current) => ({ ...current, chats: current.chats.filter((item) => item.id !== chat.id), updatedAt: Date.now() }))
    setRenamingChatId('')
    if (activeChatId === chat.id) {
      setActiveChatId(remainingChats[0]?.id ?? '')
      if (!remainingChats.length) setView('discover')
    }
  }

  function toggleFavorite(characterId: string) {
    setWorkspace((current) => ({
      ...current,
      characters: current.characters.map((character) =>
        character.id === characterId ? { ...character, favorite: !character.favorite, updatedAt: Date.now() } : character,
      ),
    }))
  }

  function togglePinned(characterId: string) {
    setWorkspace((current) => ({
      ...current,
      characters: current.characters.map((character) => character.id === characterId ? { ...character, pinned: !character.pinned, updatedAt: Date.now() } : character),
    }))
  }

  function saveCharacter(character: Character) {
    const isExisting = workspace.characters.some((item) => item.id === character.id)
    const savedCharacter = { ...character, updatedAt: Date.now() }
    setWorkspace((current) => ({
      ...current,
      characters: isExisting
        ? current.characters.map((item) => item.id === character.id ? savedCharacter : item)
        : [savedCharacter, ...current.characters],
    }))
    setShowCreate(false)
    setEditingCharacter(null)
    if (!isExisting) openCharacter(savedCharacter)
  }

  function saveLocalProfile(profile: LocalProfile) {
    setWorkspace((current) => ({ ...current, profile, updatedAt: Date.now() }))
    setShowProfile(false)
  }

  async function connectAccount(account: CommunityAccount, localWorkspace: Workspace) {
    cloudReadyRef.current = false
    setCommunityAccount(account)
    setSyncStatus('loading')
    try {
      const remote = await fetchAccountWorkspace()
      const local = { ...localWorkspace, profile: profileFromAccount(account) }
      const merged = remote.workspace ? mergeWorkspaces(local, remote.workspace) : local
      cloudRevisionRef.current = remote.revision
      setWorkspace(merged)
      if (!remote.workspace || JSON.stringify(merged) !== JSON.stringify(remote.workspace)) {
        setSyncStatus('saving')
        cloudRevisionRef.current = await saveAccountWorkspace(merged, cloudRevisionRef.current)
      }
      lastSyncedWorkspaceRef.current = JSON.stringify(merged)
      cloudReadyRef.current = true
      setSyncStatus('synced')
      setNotice('')
    } catch (error) {
      setSyncStatus('error')
      setNotice(`Signed in, but workspace sync failed: ${error instanceof Error ? error.message : 'Unknown sync error.'}`)
    }
  }

  function acceptCommunityAccount(account: CommunityAccount) {
    setShowProfile(false)
    void connectAccount(account, workspace)
  }

  async function pushWorkspaceSnapshot(snapshot: Workspace) {
    if (!cloudReadyRef.current || syncInFlightRef.current) return
    syncInFlightRef.current = true
    setSyncStatus('saving')
    try {
      let candidate = snapshot
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          cloudRevisionRef.current = await saveAccountWorkspace(candidate, cloudRevisionRef.current)
          lastSyncedWorkspaceRef.current = JSON.stringify(candidate)
          setWorkspace((current) => JSON.stringify(current) === lastSyncedWorkspaceRef.current ? current : mergeWorkspaces(current, candidate))
          setSyncStatus('synced')
          setNotice('')
          return
        } catch (error) {
          if (!(error instanceof WorkspaceConflictError) || attempt === 2) throw error
          const remote = await fetchAccountWorkspace()
          cloudRevisionRef.current = remote.revision
          if (remote.workspace) {
            candidate = mergeWorkspaces(candidate, remote.workspace)
            setNotice('A newer cloud version was detected, and your local edits were merged safely.')
          }
        }
      }
    } catch (error) {
      cloudReadyRef.current = false
      setSyncStatus('error')
      setNotice(`Your changes are saved on this device, but account sync failed: ${error instanceof Error ? error.message : 'Unknown sync error.'}`)
    } finally {
      syncInFlightRef.current = false
      if (cloudReadyRef.current && JSON.stringify(workspaceRef.current) !== JSON.stringify(snapshot)) {
        window.setTimeout(() => { void pushWorkspaceSnapshot(workspaceRef.current) }, 0)
      }
    }
  }

  function retryAccountSync() {
    if (communityAccount) void connectAccount(communityAccount, workspace)
  }

  function signOutCommunityAccount() {
    cloudReadyRef.current = false
    clearSession()
    setCommunityAccount(null)
    setWorkspace((current) => ({ ...current, profile: null }))
    setSyncStatus('local')
    setShowProfile(false)
  }

  function addImportedCharacter(character: Character) {
    const chat = createChat(character, workspace.defaultPersonaId)
    setWorkspace((current) => ({
      ...current,
      characters: [character, ...current.characters],
      chats: [chat, ...current.chats],
    }))
    setActiveChatId(chat.id)
    setShowImport(false)
    setView('chat')
    setShowMobileNav(false)
  }

  async function openCommunityCharacter(characterId: string) {
    try {
      const character = await fetchCommunityCharacter(characterId)
      void recordCommunityView(characterId).catch(() => undefined)
      const existingChat = workspace.chats.find((chat) => chat.characterId === character.id)
      if (existingChat) {
        setActiveChatId(existingChat.id)
      } else {
        const chat = createChat(character, workspace.defaultPersonaId)
        setWorkspace((current) => ({
          ...current,
          characters: current.characters.some((item) => item.id === character.id) ? current.characters : [character, ...current.characters],
          chats: [chat, ...current.chats],
        }))
        setActiveChatId(chat.id)
      }
      setView('chat')
      setShowMobileNav(false)
    } catch (error) {
      setCommunityError(error instanceof Error ? error.message : 'Could not open this community character.')
    }
  }

  async function loadMoreCommunityCharacters() {
    if (!communityCursor || communityLoading) return
    setCommunityLoading(true)
    try {
      const page = await fetchCommunityCharacters({
        q: search.trim() || undefined,
        genre: genreFilter === 'All genres' ? undefined : genreFilter,
        tag: tagFilter === 'All tags' ? undefined : tagFilter,
        pov: povFilter === 'All POVs' ? undefined : povFilter,
        gender: genderFilter === 'All genders' ? undefined : genderFilter,
        rating: ratingFilter === 'All ratings' ? undefined : ratingFilter,
        sort: libraryFilter === 'featured' ? 'featured' : libraryFilter === 'trending' || sortBy === 'Trending here' || sortBy === 'Most loved' ? 'popular' : 'recent',
        limit: 24,
        cursor: communityCursor,
      })
      setCommunityCharacters((current) => [...current, ...page.characters])
      setCommunityCursor(page.nextCursor)
    } catch (error) {
      setCommunityError(error instanceof Error ? error.message : 'Could not load more characters.')
    } finally {
      setCommunityLoading(false)
    }
  }

  async function publishCharacter(character: Character) {
    if (!communityAccount) {
      setShowProfile(true)
      setNotice('Sign in to submit characters to the community catalog.')
      return
    }
    setPublishingCharacterId(character.id)
    try {
      const result = await publishCommunityCharacter(character)
      setNotice(result.moderationStatus === 'pending' ? 'Submitted for community review. It will appear after approval.' : 'Character published.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not submit this character.')
    } finally {
      setPublishingCharacterId('')
    }
  }

  function savePersonas(personas: Persona[], defaultPersonaId: string) {
    const personaIds = new Set(personas.map((persona) => persona.id))
    setWorkspace((current) => ({
      ...current,
      personas: personas.map((persona) => ({ ...persona, updatedAt: persona.updatedAt ?? Date.now() })),
      defaultPersonaId: defaultPersonaId || undefined,
      updatedAt: Date.now(),
      chats: current.chats.map((chat) => {
        if (!chat.personaOverride) return { ...chat, personaId: defaultPersonaId || undefined }
        if (chat.personaId && !personaIds.has(chat.personaId)) {
          return { ...chat, personaId: defaultPersonaId || undefined, personaOverride: false }
        }
        return chat
      }),
    }))
    setShowPersonas(false)
  }

  function saveChatMemory(memory: { memorySummary: string; permanentMemory: string; memoryFacts: MemoryFact[] }) {
    if (activeChat) updateChat(activeChat.id, (chat) => ({ ...chat, ...memory }))
    setShowMemory(false)
  }

  function toggleMessagePin(message: Message) {
    if (!activeChat) return
    const speaker = message.role === 'user' ? activePersona?.name || 'You' : activeCharacter.name
    const wasPinned = (activeChat.permanentMemory ?? '').includes(pinnedMessageMemoryEntry(message, speaker))
    updateChat(activeChat.id, (chat) => {
      return togglePinnedMessageMemory(chat, message, speaker).chat
    })
    setOpenMessageMenuId('')
    setNotice(wasPinned ? 'Message removed from permanent memory.' : 'Message added to this chat’s permanent memory.')
  }

  function branchFromMessage(messageIndex: number) {
    if (!activeChat) return
    const branch = branchChatFromMessage(activeChat, messageIndex)
    setWorkspace((current) => ({ ...current, chats: [branch, ...current.chats], updatedAt: Date.now() }))
    setActiveChatId(branch.id)
    setOpenMessageMenuId('')
    setNotice('A separate conversation was created from this message.')
  }

  function rewindToMessage(messageIndex: number) {
    if (!activeChat) return
    const removedCount = activeChat.messages.length - messageIndex - 1
    if (removedCount <= 0) return
    const confirmed = window.confirm(`Rewind to this message and remove ${removedCount} later ${removedCount === 1 ? 'message' : 'messages'} from this conversation? This cannot be undone.`)
    if (!confirmed) return
    updateChat(activeChat.id, (chat) => rewindChatToMessage(chat, messageIndex))
    setOpenMessageMenuId('')
    setNotice(`Conversation rewound. ${removedCount} later ${removedCount === 1 ? 'message was' : 'messages were'} removed.`)
  }

  function toggleReadAloud() {
    if (!('speechSynthesis' in window)) {
      setNotice('Read-aloud is not supported by this browser.')
      return
    }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }
    const reply = [...(activeChat?.messages ?? [])].reverse().find((message) => message.role === 'assistant' && message.content)?.content
    if (!reply) {
      setNotice('There is no character reply to read aloud yet.')
      return
    }
    const utterance = new SpeechSynthesisUtterance(reply)
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.speak(utterance)
    setIsSpeaking(true)
  }

  async function refreshModels(config = aiProviderConfig) {
    setOllamaState('checking')
    try {
      const availableModels = await getProviderModels(config)
      setModels(availableModels)
      if (availableModels.length) setModel((current) => current && availableModels.includes(current) ? current : availableModels[0] || '')
      setOllamaState(availableModels.length ? 'ready' : 'empty')
      setNotice('')
    } catch {
      setOllamaState('missing')
      setNotice(`${getProviderName(config.provider)} is not reachable. Check the connection settings and try again.`)
    }
  }

  function saveAiConnection(config: AiProviderConfig) {
    try {
      saveAiProviderConfig(config)
      setAiProviderConfig(config)
      setModels([])
      setOllamaState('checking')
      setNotice('')
    } catch (error) {
      setNotice(`Could not save AI connection settings: ${error instanceof Error ? error.message : 'Browser storage is unavailable.'}`)
    }
  }

  function dismissWelcome() {
    localStorage.setItem('novarole.welcome-seen', '1')
    setShowWelcome(false)
  }

  function useModelId(value: string) {
    const selected = value.trim()
    if (!selected) return
    if (aiProviderConfig.provider !== 'ollama' && !aiProviderConfig.apiKey.trim()) {
      setNotice(`Add an API key for ${getProviderName(aiProviderConfig.provider)} before using a model.`)
      return
    }
    setModel(selected)
    setOllamaState('ready')
    setNotice('')
  }

  async function sendMessage(content = draft) {
    const prompt = content.trim()
    if (!prompt || !activeChat || !activeCharacter || !model || ollamaState !== 'ready' || controllerRef.current || enhancementControllerRef.current) return

    const editingMessageId = editingTarget?.chatId === activeChat.id ? editingTarget.messageId : ''
    const editIndex = editingMessageId ? activeChat.messages.findIndex((message) => message.id === editingMessageId && message.role === 'user') : -1
    const userMessage: Message = editIndex >= 0
      ? { ...activeChat.messages[editIndex]!, content: prompt, createdAt: Date.now() }
      : { id: crypto.randomUUID(), role: 'user', content: prompt, createdAt: Date.now() }
    const responseMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: Date.now() }
    const priorMessages = editIndex >= 0 ? activeChat.messages.slice(0, editIndex) : activeChat.messages
    const chatId = activeChat.id
    setDraft('')
    setEditingTarget(null)
    setNotice('')
    const context = [...priorMessages, userMessage]
    setWorkspace((current) => ({
      ...current,
      chats: current.chats.map((chat) => chat.id === chatId
        ? { ...chat, title: chat.messages.length && editIndex < 0 ? chat.title : prompt.slice(0, 42), updatedAt: Date.now(), messages: [...context, responseMessage] }
        : chat),
    }))

    void generateAssistantReply(activeChat, activeCharacter, context, responseMessage)
  }

  async function enhanceDraft() {
    const originalDraft = draft.trim()
    if (!originalDraft || !activeChat || !activeCharacter || isEnhancingDraft) return
    if (!model || ollamaState !== 'ready') {
      setNotice(`Connect ${getProviderName(aiProviderConfig.provider)} before enhancing a message.`)
      return
    }
    if (controllerRef.current) {
      setNotice('Wait for the current reply to finish before enhancing a message.')
      return
    }

    const controller = new AbortController()
    enhancementControllerRef.current = controller
    setIsEnhancingDraft(true)
    setNotice('')
    let enhancedText = ''
    try {
      await streamProviderChat(aiProviderConfig, model, {
        model,
        character: activeCharacter,
        messages: [
          ...activeChat.messages.filter((message) => message.content.trim()).slice(-8),
          {
            id: `draft-to-enhance-${crypto.randomUUID()}`,
            role: 'user',
            content: `Draft message to enhance:\n${originalDraft}`,
            createdAt: Date.now(),
          },
        ],
        persona: activeChat.personaId ? workspace.personas?.find((persona) => persona.id === activeChat.personaId) : undefined,
        temperature: 0.4,
        topP: 0.9,
        contextTokens: activeChat.generationSettings?.contextTokens ?? 8192,
        responseLength: activeChat.generationSettings?.responseLength ?? 'Balanced',
        mode: activeChat.generationSettings?.mode ?? 'Standard',
        systemPrompt: 'You are an editor improving a user-written message for an interactive roleplay. Rewrite only the user’s draft to make it clearer, more natural, and engaging while preserving its intent, point of view, and voice. Do not answer the draft, continue the story, or invent actions, thoughts, feelings, or dialogue for the user. Return only the revised message, without quotation marks, labels, or explanation.',
        signal: controller.signal,
        onToken: (token) => { enhancedText += token },
      })
      if (!enhancedText.trim()) throw new Error('The model returned an empty enhancement. Your original draft was kept.')
      setDraft(enhancedText.trim())
      setNotice('Draft enhanced. Review it before sending.')
      composerRef.current?.focus()
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : 'Could not enhance this message.')
      }
    } finally {
      if (enhancementControllerRef.current === controller) {
        enhancementControllerRef.current = null
        setIsEnhancingDraft(false)
      }
    }
  }

  async function generateAssistantReply(chat: Chat, character: Character, context: Message[], response: Message) {
    const controller = new AbortController()
    controllerRef.current = controller
    setStreamingChatId(chat.id)
    let receivedToken = false
    try {
      await streamProviderChat(aiProviderConfig, model, {
        model,
        character,
        messages: context,
        persona: workspace.personas?.find((persona) => persona.id === chat.personaId),
        memorySummary: chat.memorySummary,
        memoryFacts: chat.memoryFacts,
        permanentMemory: chat.permanentMemory,
        temperature: chat.generationSettings?.temperature ?? 0.8,
        topP: chat.generationSettings?.topP ?? 0.9,
        contextTokens: chat.generationSettings?.contextTokens ?? 8192,
        responseLength: chat.generationSettings?.responseLength ?? 'Balanced',
        mode: chat.generationSettings?.mode ?? 'Standard',
        signal: controller.signal,
        onToken: (token) => {
          receivedToken = receivedToken || Boolean(token)
          updateChat(chat.id, (current) => ({
            ...current,
            messages: current.messages.map((message) => message.id === response.id
              ? { ...message, content: message.content + token }
              : message),
          }), false)
        },
      })
      if (!receivedToken && workspaceRef.current.chats.some((item) => item.id === chat.id)) {
        updateChat(chat.id, (current) => ({
          ...current,
          messages: current.messages.filter((message) => message.id !== response.id),
        }))
        setNotice('The model returned an empty reply. Try continuing again or send a message.')
      }
    } catch (error) {
      const chatStillExists = workspaceRef.current.chats.some((item) => item.id === chat.id)
      if (chatStillExists) {
        updateChat(chat.id, (current) => ({
          ...current,
          messages: current.messages.filter((message) => message.id !== response.id || message.content.length > 0),
        }))
        setNotice(controller.signal.aborted
          ? 'Reply stopped. Your partial response has been kept.'
          : error instanceof Error ? error.message : 'The model could not finish this reply.')
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setStreamingChatId('')
      }
    }
  }

  function stopGeneration() {
    controllerRef.current?.abort()
  }

  function regenerateLastReply() {
    if (!activeChat || !activeCharacter || controllerRef.current || !model || ollamaState !== 'ready') return
    const lastAssistantIndex = activeChat.messages.length - 1
    const lastUserIndex = activeChat.messages.map((message) => message.role).lastIndexOf('user')
    if (lastAssistantIndex < 0 || lastUserIndex < 0 || lastAssistantIndex <= lastUserIndex ||
      activeChat.messages[lastAssistantIndex]?.role !== 'assistant') return

    const context = activeChat.messages.slice(0, lastAssistantIndex)
    const response: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: Date.now() }
    const updatedChat = { ...activeChat, messages: [...context, response], updatedAt: Date.now() }
    updateChat(activeChat.id, () => updatedChat, false)
    void generateAssistantReply(updatedChat, activeCharacter, context, response)
  }

  function continueAssistantReply() {
    if (!activeChat || !activeCharacter || controllerRef.current || !model || ollamaState !== 'ready' || editingMessageId) return
    const lastMessage = activeChat.messages[activeChat.messages.length - 1]
    if (lastMessage?.role !== 'assistant' || !lastMessage.content.trim() ||
      !activeChat.messages.some((message) => message.role === 'user')) return

    const response: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: Date.now() }
    const history = activeChat.messages
    const context = [...history, {
      id: `continuation-${response.id}`,
      role: 'user' as const,
      content: 'Continue the scene with another in-character message. Do not repeat or summarize your previous reply, do not speak or act for the user, and advance the scene naturally. Write only your next message.',
      createdAt: Date.now(),
    }]
    const updatedChat = { ...activeChat, messages: [...history, response], updatedAt: Date.now() }
    updateChat(activeChat.id, (chat) => ({ ...chat, messages: [...chat.messages, response] }))
    setNotice('')
    void generateAssistantReply(updatedChat, activeCharacter, context, response)
  }

  async function copyReply(content: string) {
    try {
      await navigator.clipboard.writeText(content)
      setNotice('Reply copied to clipboard.')
    } catch {
      setNotice('Could not access the clipboard. Check your browser permissions.')
    }
  }

  function exportWorkspaceBackup() {
    const backup = {
      format: 'novarole-workspace',
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `novarole-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Workspace backup exported. Keep the file somewhere safe.')
  }

  async function importWorkspaceBackup(file: File) {
    try {
      const backup = parseWorkspaceBackup(await file.text())
      setWorkspace((current) => mergeWorkspaces(current, backup))
      setNotice(`Merged ${backup.characters.length} characters and ${backup.chats.length} conversations from backup.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not import this workspace backup.')
    }
  }

  async function restoreWorkspaceBackup(file: File) {
    try {
      const backup = parseWorkspaceBackup(await file.text())
      if (workspaceRecovery?.rawData) downloadRecoveryData()
      setWorkspace(backup)
      initialWorkspaceRef.current = backup
      setActiveChatId(backup.chats[0]?.id ?? '')
      setWorkspaceRecovery(null)
      setWorkspaceRecoveryError('')
      setNotice(`Restored ${backup.characters.length} characters and ${backup.chats.length} conversations from backup.`)
    } catch (error) {
      setWorkspaceRecoveryError(error instanceof Error ? error.message : 'Could not restore this workspace backup.')
    }
  }

  function downloadRecoveryData() {
    if (!workspaceRecovery?.rawData) return
    const url = URL.createObjectURL(new Blob([workspaceRecovery.rawData], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `novarole-recovery-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function continueWithStarterWorkspace() {
    if (!window.confirm('Replace the unreadable saved workspace with the starter library? Download the saved data first if you may need it.')) return
    if (workspaceRecovery?.rawData) downloadRecoveryData()
    setWorkspaceRecovery(null)
    setWorkspaceRecoveryError('')
    setNotice(workspaceRecovery?.rawData ? 'A copy of the previous saved data was downloaded before starting with the starter library.' : 'Using the starter library. The saved workspace could not be read, so no recovery file was available to download.')
  }

  const messages = activeChat?.messages ?? emptyMessages
  const isStreaming = Boolean(activeChat && streamingChatId === activeChat.id)
  const activePersona = workspace.personas?.find((persona) => persona.id === activeChat?.personaId)
  const latestUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id
  const editingMessageId = editingTarget && editingTarget.chatId === activeChat?.id ? editingTarget.messageId : ''
  const canContinueAssistant = Boolean(!editingMessageId && !isStreaming && model && ollamaState === 'ready' &&
    messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content.trim() &&
    messages.some((message) => message.role === 'user'))
  const canEnhanceDraft = Boolean(draft.trim() && model && ollamaState === 'ready' && !isStreaming && !isEnhancingDraft)
  const starterPrompts = activeCharacter ? getStarterPrompts(activeCharacter, messages) : []
  const aiSetupNeeded = !model || ollamaState !== 'ready'
  const providerLabel = getProviderName(aiProviderConfig.provider)

  useEffect(() => {
    shouldAutoScrollRef.current = true
    const element = messageScrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [activeChat?.id])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return
    const element = messageScrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages])

  return (
    <main className="app-shell">
      {showMobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setShowMobileNav(false)} />}
      <aside className={`sidebar ${showMobileNav ? 'sidebar-open' : ''}`} id="app-sidebar">
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={18} strokeWidth={1.8} /></div>
          <span className="brand-name">NovaRole</span>
          <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setShowMobileNav(false)}><X size={17} /></button>
        </div>
        <div className="local-status"><span className="status-dot" /> LOCAL STUDIO</div>

        <nav className="primary-nav" aria-label="Main navigation">
          <button className={`nav-item ${view === 'discover' ? 'nav-active' : ''}`} aria-current={view === 'discover' ? 'page' : undefined} onClick={() => { setView('discover'); setShowMobileNav(false) }}>
            <Compass size={17} /><span>Discover</span><span className="nav-count">{workspace.characters.length}</span>
          </button>
          <button className={`nav-item ${view === 'chat' ? 'nav-active' : ''}`} aria-current={view === 'chat' ? 'page' : undefined} onClick={() => { setView('chat'); setShowMobileNav(false) }}>
            <MessageCircle size={17} /><span>Conversations</span>
          </button>
          <button className="nav-item" onClick={() => { setShowImport(true); setShowMobileNav(false) }}>
            <Upload size={17} /><span>Import character</span>
          </button>
          <button className="nav-item" onClick={() => { setShowPersonas(true); setShowMobileNav(false) }}>
            <UserRound size={17} /><span>Personas</span><span className="nav-count">{workspace.personas?.length ?? 0}</span>
          </button>
        </nav>

        <div className="sidebar-section-heading conversation-section-heading">
          <span>Conversations <small className="conversation-total">{workspace.chats.length}</small></span>
          <button className="tiny-icon-button" title="New conversation" aria-label="New conversation" onClick={() => startNewChat()} disabled={!activeCharacter}><Plus size={15} /></button>
        </div>
        <label className="search-box conversation-search">
          <Search size={14} />
          <input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
          {conversationSearch && <button type="button" className="clear-search" aria-label="Clear conversation search" onClick={() => setConversationSearch('')}><X size={12} /></button>}
        </label>
        <div className="conversation-list">
          {matchingChats.map((chat) => {
            const character = workspace.characters.find((item) => item.id === chat.characterId)
            if (!character) return null
            return <div key={chat.id} className="conversation-item">
              {renamingChatId === chat.id
                ? <form className="conversation-rename-form" onSubmit={(event) => { event.preventDefault(); renameChat(chat.id) }}>
                  <input value={chatTitleDraft} onChange={(event) => setChatTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setRenamingChatId(''); setChatTitleDraft('') } }} aria-label="Conversation title" maxLength={80} required autoFocus />
                  <button type="submit" className="tiny-icon-button" aria-label="Save conversation title" title="Save title"><Check size={14} /></button>
                  <button type="button" className="tiny-icon-button" aria-label="Cancel renaming" title="Cancel" onClick={() => { setRenamingChatId(''); setChatTitleDraft('') }}><X size={14} /></button>
                </form>
                : <>
                  <button className={`conversation-row ${chat.id === activeChat?.id && view === 'chat' ? 'conversation-row-active' : ''}`} onClick={() => { setActiveChatId(chat.id); setView('chat'); setShowMobileNav(false) }}>
                    <MessageCircle size={14} />
                    <span className="conversation-row-copy"><span className="conversation-row-title">{chat.title}</span><span className="conversation-row-character">{character.name}</span></span>
                  </button>
                  <div className="conversation-row-actions">
                    <button type="button" className="tiny-icon-button" title="Rename conversation" aria-label={`Rename ${chat.title}`} onClick={() => { setRenamingChatId(chat.id); setChatTitleDraft(chat.title) }}><Pencil size={12} /></button>
                    <button type="button" className="tiny-icon-button conversation-delete" title="Delete conversation" aria-label={`Delete ${chat.title}`} onClick={() => deleteChat(chat)}><Trash2 size={12} /></button>
                  </div>
                </>}
            </div>
          })}
          {!workspace.chats.length && <p className="no-results">Your stories will appear here.</p>}
          {workspace.chats.length > 0 && !matchingChats.length && <p className="no-results">No conversations match that search.</p>}
        </div>

        <div className="sidebar-section-heading">
          <span>Your characters</span>
          <button className="tiny-icon-button" title="Create character" aria-label="Create character" onClick={() => setShowCreate(true)}><Plus size={15} /></button>
        </div>
        <label className="search-box">
          <Search size={15} />
          <input value={search} onChange={(event) => { setSearch(event.target.value); if (catalogSource === 'community') prepareCommunityFetch() }} placeholder="Find a character" aria-label="Find a character" />
          {search && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}
        </label>
        <div className="character-list">
          {[...matchingCharacters].sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))).map((character) => (
            <button key={character.id} className={`character-row ${activeCharacter?.id === character.id && view === 'chat' ? 'character-row-active' : ''}`} onClick={() => openCharacter(character)}>
              <Avatar character={character} size="small" />
              <span className="character-row-copy"><span className="character-row-name">{character.nickname?.trim() || character.name}</span><span className="character-row-tagline">{character.title || character.tagline}</span></span>
              {character.favorite && <Heart className="favorite-indicator" size={13} fill="currentColor" />}
              {character.pinned && <Pin className="pin-indicator" size={13} fill="currentColor" />}
            </button>
          ))}
          {!matchingCharacters.length && <p className="no-results">No characters found.</p>}
        </div>

        <div className="sidebar-bottom">
          <div className="privacy-note"><ShieldCheck size={15} /><span>{communityAccount ? 'Private backup on your API.' : 'Your stories stay on this device.'}</span></div>
          <button className="profile-row" onClick={() => setShowProfile(true)}>
            <div className="profile-avatar">{(communityAccount?.displayName || workspace.profile?.displayName)?.slice(0, 1).toUpperCase() || <UserRound size={15} />}</div><span><b>{communityAccount?.displayName || workspace.profile?.displayName || 'Sign in'}</b><small>{communityAccount ? `@${communityAccount.handle} · ${syncStatus === 'synced' ? 'Synced' : syncStatus === 'saving' ? 'Saving…' : syncStatus === 'loading' ? 'Syncing…' : 'Sync issue'}` : workspace.profile?.email || 'Local profile'}</small></span><MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={showMobileNav} aria-controls="app-sidebar" onClick={() => setShowMobileNav(true)}><Menu size={19} /></button>
            <span className="breadcrumb">Studio <span>/</span> {view === 'chat' ? 'Conversation' : 'Discover'}</span>
          </div>
          <div className="topbar-actions">
            <div className={`model-pill ${ollamaState}`}>
              <span className="status-dot" />
              <span>{ollamaState === 'ready' ? (model || `${getProviderName(aiProviderConfig.provider)} ready`) : ollamaState === 'checking' ? `Checking ${getProviderName(aiProviderConfig.provider)}…` : `${getProviderName(aiProviderConfig.provider)} not connected`}</span>
              {ollamaState !== 'ready' && <button onClick={() => void refreshModels()} title="Check AI provider"><ArrowUpRight size={13} /></button>}
            </div>
            <button className="icon-button theme-button" title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button className="icon-button settings-button" title="Generation settings" aria-label="Generation settings" onClick={() => setShowDetails(!showDetails)}><Settings2 size={17} /></button>
          </div>
        </header>
        {notice && <div className="notice-bar" role="status"><CircleHelp size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={14} /></button></div>}

        {view === 'discover' ? (
          <DiscoverView
            characters={visibleCharacters}
            resumeCharacter={catalogSource === 'local' ? recentCharacter : null}
            resumeTitle={recentChat?.title ?? ''}
            searchValue={search}
            onSearchChange={setSearch}
            catalogSource={catalogSource}
            communityLoading={communityLoading}
            communityError={communityError}
            hasMoreCommunity={Boolean(communityCursor)}
            publishingCharacterId={publishingCharacterId}
            filter={libraryFilter}
            genres={genres}
            genreFilter={genreFilter}
            tags={tags}
            tagFilter={tagFilter}
            povs={povs}
            povFilter={povFilter}
            genders={genders}
            genderFilter={genderFilter}
            ratingFilter={ratingFilter}
            sortBy={sortBy}
            canShowSimilar={Boolean(similarToId)}
            onFilterChange={setLibraryFilter}
            onCatalogSourceChange={(source) => { setCatalogSource(source); setLibraryFilter('all'); if (source === 'community') prepareCommunityFetch(); else setCommunityLoading(false) }}
            onLoadMore={() => void loadMoreCommunityCharacters()}
            onRetry={() => { prepareCommunityFetch(); setCommunityRefresh((count) => count + 1) }}
            onPublish={(character) => void publishCharacter(character)}
            onGenreChange={(value) => { setGenreFilter(value); if (catalogSource === 'community') prepareCommunityFetch() }}
            onTagChange={(value) => { setTagFilter(value); if (catalogSource === 'community') prepareCommunityFetch() }}
            onPovChange={(value) => { setPovFilter(value); if (catalogSource === 'community') prepareCommunityFetch() }}
            onGenderChange={(value) => { setGenderFilter(value); if (catalogSource === 'community') prepareCommunityFetch() }}
            onRatingChange={(value) => { setRatingFilter(value); if (catalogSource === 'community') prepareCommunityFetch() }}
            onSortChange={setSortBy}
            onOpen={(character) => catalogSource === 'community' ? void openCommunityCharacter(character.id) : openCharacter(character)}
            onResume={() => { if (recentChat) { setActiveChatId(recentChat.id); setView('chat') } }}
            onSurprise={surpriseMe}
            onFavorite={toggleFavorite}
            onPin={togglePinned}
            onSimilar={(character) => { setSimilarToId(character.id); setLibraryFilter('similar') }}
            onEdit={(character) => { setEditingCharacter(character); setShowCreate(true) }}
            onCreate={() => { setEditingCharacter(null); setShowCreate(true) }}
              onImport={() => setShowImport(true)}
              aiSetupNeeded={aiSetupNeeded}
              providerLabel={providerLabel}
              onOpenSettings={() => setShowProfile(true)}
            />
        ) : activeCharacter && activeChat ? (
          <div className={`chat-layout ${showDetails ? '' : 'details-hidden'}`}>
            <section className="conversation-column">
              <div className="conversation-heading">
                <button className="back-to-discover" onClick={() => setView('discover')}><ArrowLeft size={15} /><span>Characters</span></button>
                <div className="conversation-title-row">
                  <Avatar character={activeCharacter} size="large" />
                  <div className="conversation-title-copy"><div className="eyebrow">A PRIVATE STORY <span className="eyebrow-line" /></div><h1>{activeCharacter.name}</h1><p>{activeCharacter.title || activeCharacter.tagline}</p></div>
                  <button className={`icon-button favorite-button ${activeCharacter.favorite ? 'is-favorite' : ''}`} aria-label={activeCharacter.favorite ? 'Remove favorite' : 'Add favorite'} onClick={() => toggleFavorite(activeCharacter.id)}><Heart size={18} fill={activeCharacter.favorite ? 'currentColor' : 'none'} /></button>
                  <button className="icon-button more-button" title="Start a new conversation" aria-label="Start a new conversation" onClick={() => startNewChat()}><Plus size={18} /></button>
                </div>
                <div className="conversation-controls">
                  <ControlMenu
                    className="conversation-select"
                    icon={<MessageCircle size={14} />}
                    label="Switch conversation"
                    value={activeChat.id}
                    onChange={(value) => {
                      if (value === '__new__') {
                        startNewChat(activeCharacter)
                        return
                      }
                      setActiveChatId(value)
                      setView('chat')
                    }}
                    options={[
                      ...[...workspace.chats]
                        .filter((chat) => chat.characterId === activeCharacter.id)
                        .sort((left, right) => right.updatedAt - left.updatedAt)
                        .map((chat, index) => ({
                          value: chat.id,
                          label: chat.title === 'New conversation' ? `Conversation ${index + 1}` : chat.title || `Conversation ${index + 1}`,
                          description: chat.id === activeChat.id ? 'Currently open' : `${chat.messages.length} messages`,
                        })),
                      { value: '__new__', label: 'New conversation…', description: 'Start a fresh story with this character' },
                    ]}
                  />
                  <ControlMenu
                    className="mode-select"
                    icon={<Sparkles size={14} />}
                    label="Story style"
                    value={generationSettings.mode}
                    onChange={(value) => updateGenerationSettings({ mode: value })}
                    options={[
                      { value: 'Standard', label: 'Standard', description: 'A balanced pace and reply length' },
                      { value: 'Immersive story', label: 'Immersive story', description: 'Stay close to the scene and characters' },
                      { value: 'Quick replies', label: 'Quick replies', description: 'Short, lively responses' },
                      { value: 'Long-form narrative', label: 'Long-form story', description: 'Give scenes more room to unfold' },
                    ]}
                  />
                  <ControlMenu
                    className="persona-select"
                    icon={<UserRound size={13} />}
                    label="Chat persona"
                    value={activeChat.personaOverride ? activeChat.personaId ?? '__none__' : '__default__'}
                    onChange={(value) => updateChat(activeChat.id, (chat) => ({
                      ...chat,
                      personaId: value === '__default__' ? workspace.defaultPersonaId ?? null : value === '__none__' ? null : value,
                      personaOverride: value !== '__default__',
                    }))}
                    options={[
                      {
                        value: '__default__',
                        label: 'Workspace default',
                        description: workspace.personas?.find((persona) => persona.id === workspace.defaultPersonaId)?.name
                          ? `Use ${workspace.personas.find((persona) => persona.id === workspace.defaultPersonaId)?.name}`
                          : 'Use the workspace default persona, if set',
                      },
                      { value: '__none__', label: 'No persona', description: 'Chat without a roleplay identity' },
                      ...(workspace.personas ?? []).map((persona) => ({
                        value: persona.id,
                        label: persona.name,
                        description: persona.description || 'Use this persona in the chat',
                      })),
                    ]}
                  />
                  <button className="icon-button persona-manage" title="Manage personas" aria-label="Manage personas" onClick={() => setShowPersonas(true)}><UsersRound size={15} /></button>
                  <span className="control-divider" />
                  <span className="conversation-count"><MessageCircle size={13} /> {messages.length} messages</span>
                  <button className="icon-button memory-toggle" title="Edit chat memory" aria-label="Edit chat memory" onClick={() => setShowMemory(true)}><BookOpen size={15} /></button>
                  <button className="icon-button details-toggle" title={showDetails ? 'Hide details' : 'Show details'} aria-label={showDetails ? 'Hide details' : 'Show details'} onClick={() => setShowDetails(!showDetails)}><PanelRight size={16} /></button>
                </div>
              </div>

                {aiSetupNeeded && <div className="ai-setup-banner" role="status">
                  <div className="ai-setup-copy">
                    <Sparkles size={15} />
                    <span>Connect {providerLabel} to start generating replies.</span>
                  </div>
                  <button className="create-button" type="button" onClick={() => setShowProfile(true)}><Settings2 size={14} /> Open settings</button>
                </div>}

                <div className="message-scroll" key={activeChat.id} ref={messageScrollRef} onScroll={(event) => {
                const element = event.currentTarget
                shouldAutoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
              }}>
                {messages.map((message, index) => {
                  const dateLabel = formatStoryDate(message.createdAt)
                  const startsNewDay = index === 0 || new Date(messages[index - 1]?.createdAt ?? 0).toDateString() !== new Date(message.createdAt).toDateString()
                  const isLatestUserMessage = message.role === 'user' && message.id === latestUserMessageId
                  const messageMenuId = `${activeChat.id}:${message.id}`
                  const messageSpeaker = message.role === 'user' ? activePersona?.name || 'You' : activeCharacter.name
                  const isMessagePinned = (activeChat.permanentMemory ?? '').includes(pinnedMessageMemoryEntry(message, messageSpeaker))
                  return <Fragment key={message.id}>
                  {startsNewDay && <div className="story-date"><span /> {dateLabel} <span /></div>}
                  <article className={`message ${message.role === 'user' ? 'message-user' : 'message-character'} ${openMessageMenuId === messageMenuId ? 'message-menu-open' : ''}`}>
                    {message.role === 'assistant' && <Avatar character={activeCharacter} size="message" />}
                    <div className="message-content-wrap">
                      <div className="message-meta"><b>{message.role === 'user' ? activePersona?.name || 'You' : activeCharacter.name}</b><time>{formatTime(message.createdAt)}</time>{index === 0 && message.role === 'assistant' && <span className="greeting-label">OPENING</span>}</div>
                      <div className={`message-bubble ${message.role === 'user' ? 'user-bubble' : ''}`}>
                        {message.content
                          ? <div className="message-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{replaceUserPlaceholder(message.content, activePersona?.name.trim() || 'you')}</ReactMarkdown></div>
                          : <span className="typing-indicator"><i /><i /><i /></span>}
                      </div>
                      {message.content && !isStreaming && <div className="message-menu-wrap">
                        <button
                          type="button"
                          className="message-menu-trigger"
                          aria-label={`More actions for ${message.role === 'user' ? 'your' : activeCharacter.name} message`}
                          aria-haspopup="menu"
                          aria-expanded={openMessageMenuId === messageMenuId}
                          onClick={() => setOpenMessageMenuId((current) => current === messageMenuId ? '' : messageMenuId)}
                        ><MoreHorizontal size={16} /></button>
                        {openMessageMenuId === messageMenuId && <div className="message-menu" role="menu" aria-label="Message actions">
                          {message.role === 'assistant' && <button type="button" role="menuitem" onClick={() => { void copyReply(message.content); setOpenMessageMenuId('') }}><Copy size={13} /> Copy message</button>}
                          {message.role === 'user' && isLatestUserMessage && <button type="button" role="menuitem" onClick={() => { setEditingTarget({ chatId: activeChat.id, messageId: message.id }); setDraft(message.content); setOpenMessageMenuId('') }}><Pencil size={13} /> Edit &amp; retry</button>}
                          {message.role === 'assistant' && index === messages.length - 1 && messages.slice(0, index).some((item) => item.role === 'user') && <button type="button" role="menuitem" disabled={!model || ollamaState !== 'ready'} onClick={() => { regenerateLastReply(); setOpenMessageMenuId('') }}><RotateCcw size={13} /> Regenerate reply</button>}
                          <button type="button" role="menuitem" onClick={() => toggleMessagePin(message)}>{isMessagePinned ? <PinOff size={13} /> : <Pin size={13} />}{isMessagePinned ? 'Remove from permanent memory' : 'Pin to permanent memory'}</button>
                          <button type="button" role="menuitem" onClick={() => branchFromMessage(index)}><GitBranch size={13} /> Continue in a new chat</button>
                          <button type="button" role="menuitem" disabled={index === messages.length - 1} onClick={() => rewindToMessage(index)}><RotateCcw size={13} /> Rewind to this message</button>
                        </div>}
                      </div>}
                    </div>
                  </article>
                  </Fragment>
                })}
                {messages.length === 0 && <div className="empty-chat"><BookOpen size={22} /><h2>Begin the story</h2><p>{replaceUserPlaceholder(activeCharacter.greeting, activePersona?.name.trim() || 'you')}</p></div>}
              </div>

              <div className="composer-area">
                {editingMessageId && <div className="editing-message-banner"><span><Pencil size={12} /> Editing your last message; sending will replace its reply.</span><button type="button" className="text-action" onClick={() => { setEditingTarget(null); setDraft('') }}>Cancel</button></div>}
                {!isStreaming && <div className="suggestion-row" aria-label="Suggested next messages">{starterPrompts.map((prompt) => <button key={prompt} type="button" aria-label={`Send suggestion: ${prompt}`} disabled={isEnhancingDraft} onClick={() => {
                  if (model && ollamaState === 'ready') {
                    void sendMessage(prompt)
                  } else {
                    setDraft(prompt)
                    composerRef.current?.focus()
                    setNotice(`Connect ${getProviderName(aiProviderConfig.provider)} to send a suggested message.`)
                  }
                }}>{prompt}<ArrowUpRight size={12} aria-hidden="true" /></button>)}</div>}
                <div className="composer-shell">
                  <textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (draft.trim()) void sendMessage(); else if (canContinueAssistant) continueAssistantReply() } }} placeholder={isEnhancingDraft ? 'Enhancing your message…' : editingMessageId ? 'Revise your message, then send to retry the conversation...' : ollamaState === 'ready' ? `Write to ${activeCharacter.name}...` : `Connect ${getProviderName(aiProviderConfig.provider)} in app settings to start chatting...`} rows={2} aria-label={editingMessageId ? 'Edit message' : 'Message'} disabled={isEnhancingDraft} />
                  <div className="composer-footer">
                    <div className="composer-tools"><button className={`enhance-draft-button ${isEnhancingDraft ? 'is-enhancing' : ''}`} type="button" title={isEnhancingDraft ? 'Enhancing your message…' : 'Enhance message with AI'} aria-label={isEnhancingDraft ? 'Enhancing message' : 'Enhance message with AI'} aria-busy={isEnhancingDraft} disabled={!canEnhanceDraft} onClick={() => void enhanceDraft()}><Sparkles size={15} /></button><button type="button" title={isSpeaking ? 'Stop read-aloud' : 'Read the last reply aloud'} aria-label={isSpeaking ? 'Stop read-aloud' : 'Read the last reply aloud'} onClick={toggleReadAloud}><AudioLines size={15} /></button><span className="composer-hint">{isEnhancingDraft ? 'Enhancing draft…' : canContinueAssistant && !draft.trim() ? 'Enter for another reply' : 'Enter to send'} <span>·</span> Shift + Enter for a new line</span></div>
                    {isStreaming
                      ? <button className="send-button stop-button" onClick={stopGeneration} aria-label="Stop generating"><Square size={13} fill="currentColor" /><span>Stop</span></button>
                      : <button className="send-button" onClick={() => void sendMessage()} disabled={!draft.trim() || !model || ollamaState !== 'ready' || Boolean(streamingChatId) || isEnhancingDraft} aria-label={editingMessageId ? 'Replace message and retry' : 'Send message'}><Send size={16} /><span>{editingMessageId ? 'Retry' : 'Send'}</span></button>}
                  </div>
                </div>
                <div className="local-footnote"><ShieldCheck size={12} /> {communityAccount ? syncStatus === 'synced' ? 'Chats are backed up to your account' : syncStatus === 'saving' ? 'Saving your account backup…' : syncStatus === 'loading' ? 'Loading your account backup…' : 'Chats remain on this device until sync succeeds' : 'Chats are stored locally on this device'} <span>·</span> {getProviderName(aiProviderConfig.provider)}: {model || 'not connected'}</div>
              </div>
            </section>

            {showDetails && <aside className="details-panel">
              <div className="details-heading"><span>STORY DETAILS</span><button className="tiny-icon-button" title="Close details" aria-label="Close details" onClick={() => setShowDetails(false)}><X size={15} /></button></div>
              <div className="detail-character-card"><Avatar character={activeCharacter} size="detail" /><h2>{activeCharacter.name}</h2><p>{activeCharacter.title || activeCharacter.tagline}</p>{activeCharacter.title && <p className="character-tagline">{activeCharacter.tagline}</p>}<div className="tag-row">{activeCharacter.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><p className="character-description">{activeCharacter.description}</p></div>
              <div className="detail-divider" />
              <section className="setting-section"><div className="section-label"><span>{getProviderName(aiProviderConfig.provider).toUpperCase()} MODEL</span><button className="tiny-icon-button" title="Refresh models" aria-label="Refresh models" onClick={() => void refreshModels()}><ArrowUpRight size={13} /></button></div><label className="field-label" htmlFor="model-select">Model</label><div className="select-wrap"><select id="model-select" value={model} onChange={(event) => setModel(event.target.value)} disabled={!models.length}><option value="">{models.length ? 'Choose a model' : 'No models found'}</option>{models.map((availableModel) => <option key={availableModel}>{availableModel}</option>)}</select><ChevronDown size={14} /></div>{ollamaState !== 'ready' && <p className="field-help">{aiProviderConfig.provider === 'ollama' ? <>Start Ollama, then pull a model such as <code>llama3.2</code>.</> : 'Choose a model in app settings and verify the provider connection.'}</p>}</section>
              <div className="detail-divider" />
              <section className="setting-section"><div className="section-label"><span>RESPONSE</span><Settings2 size={13} /></div><label className="field-label" htmlFor="length-select">Length</label><div className="select-wrap"><select id="length-select" value={generationSettings.responseLength} onChange={(event) => updateGenerationSettings({ responseLength: event.target.value })}><option>Brief</option><option>Balanced</option><option>Detailed</option></select><ChevronDown size={14} /></div><label className="field-label context-label" htmlFor="context-select">Context window</label><div className="select-wrap"><select id="context-select" value={generationSettings.contextTokens} onChange={(event) => updateGenerationSettings({ contextTokens: Number(event.target.value) })} disabled={aiProviderConfig.provider !== 'ollama'} aria-describedby={aiProviderConfig.provider !== 'ollama' ? 'context-window-help' : undefined}><option value={4096}>Short · 4K</option><option value={8192}>Standard · 8K</option><option value={16384}>Expanded · 16K</option><option value={32768}>Long · 32K</option><option value={45056}>Maximum · 45K</option></select><ChevronDown size={14} /></div>{aiProviderConfig.provider !== 'ollama' && <p id="context-window-help" className="field-help">Context size is controlled by the connected provider for this model; this setting applies to Ollama.</p>}<label className="slider-label" htmlFor="temperature"><span>Creativity</span><span>{generationSettings.temperature.toFixed(1)}</span></label><input id="temperature" className="range-input" type="range" min="0" max="1.5" step="0.1" value={generationSettings.temperature} onChange={(event) => updateGenerationSettings({ temperature: Number(event.target.value) })} /><label className="slider-label" htmlFor="top-p"><span>Top-p</span><span>{generationSettings.topP.toFixed(2)}</span></label><input id="top-p" className="range-input" type="range" min="0.1" max="1" step="0.05" value={generationSettings.topP} onChange={(event) => updateGenerationSettings({ topP: Number(event.target.value) })} /></section>
              <div className="detail-divider" />
              <div className="memory-preview"><div className="memory-icon"><BookOpen size={15} /></div><div><b>Memory</b><p>{activeChat.memoryFacts?.length ?? 0} facts · {activeChat.memorySummary ? 'Summary saved' : 'No summary yet'}</p></div><button title="Edit chat memory" aria-label="Edit chat memory" onClick={() => setShowMemory(true)}><Pencil size={14} /></button></div>
              <div className="details-bottom"><span><Laptop size={13} /> {communityAccount ? 'ACCOUNT BACKUP' : 'LOCAL ONLY'}</span><span>{communityAccount ? 'Private workspace synced to your configured API' : 'Nothing leaves your device'}</span></div>
            </aside>}
          </div>
        ) : (
          <div className="empty-workspace"><h1>Create your first character</h1><p>Build a character and begin a private, locally stored story.</p><button className="create-button" onClick={() => setShowCreate(true)}><Plus size={16} /> Create character</button></div>
        )}
      </section>

      {showWelcome && <WelcomeModal onClose={dismissWelcome} onCreate={() => { dismissWelcome(); setShowCreate(true) }} onImport={() => { dismissWelcome(); setShowImport(true) }} onConnectModel={() => { dismissWelcome(); setShowProfile(true) }} />}
      {showCreate && <CreateCharacterModal character={editingCharacter ?? undefined} onClose={() => { setShowCreate(false); setEditingCharacter(null) }} onSave={saveCharacter} />}
      {showImport && <ImportCharacterModal onClose={() => setShowImport(false)} onImport={addImportedCharacter} />}
      {showProfile && <LocalProfileModal
        profile={workspace.profile}
        account={communityAccount}
        theme={theme}
        onThemeChange={setTheme}
        models={models}
        model={model}
        ollamaState={ollamaState}
        onModelChange={setModel}
        onUseModel={useModelId}
        onRefreshModels={(config) => void refreshModels(config)}
        providerConfig={aiProviderConfig}
        onSaveProviderConfig={saveAiConnection}
        onExportBackup={exportWorkspaceBackup}
        onImportBackup={(file) => void importWorkspaceBackup(file)}
        onClose={() => setShowProfile(false)}
        onSave={saveLocalProfile}
        onAuthenticate={acceptCommunityAccount}
        onSignOut={signOutCommunityAccount}
        syncStatus={syncStatus}
        onRetrySync={retryAccountSync}
      />}
      {showPersonas && <PersonasModal personas={workspace.personas ?? []} defaultPersonaId={workspace.defaultPersonaId ?? ''} onClose={() => setShowPersonas(false)} onSave={savePersonas} />}
      {showMemory && activeChat && <MemoryModal chat={activeChat} onClose={() => setShowMemory(false)} onSave={saveChatMemory} />}
      {workspaceRecovery && <div className="modal-backdrop workspace-recovery-backdrop" role="presentation">
        <section className="create-modal workspace-recovery" role="alertdialog" aria-modal="true" aria-labelledby="workspace-recovery-title" aria-describedby="workspace-recovery-description">
          <div className="eyebrow">WORKSPACE RECOVERY <span className="eyebrow-line" /></div>
          <h2 id="workspace-recovery-title">Your saved stories need attention.</h2>
          <p id="workspace-recovery-description">{workspaceRecovery.message} NovaRole has paused automatic saving so it will not overwrite the saved workspace while you choose what to do.</p>
          {workspaceRecovery.rawData && <button className="settings-refresh" type="button" onClick={downloadRecoveryData}><Download size={14} /> Download a copy of the saved data</button>}
          {workspaceRecoveryError && <p className="form-error" role="alert">{workspaceRecoveryError}</p>}
          <label className="settings-refresh backup-import-button workspace-recovery-import">
            <input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void restoreWorkspaceBackup(file); event.target.value = '' }} />
            <Upload size={14} /> Restore from a NovaRole backup
          </label>
          <button className="text-action workspace-recovery-reset" type="button" onClick={continueWithStarterWorkspace}>Download saved data and use the starter library</button>
        </section>
      </div>}
    </main>
  )
}

const CHARACTER_ICON_OPTIONS = ['✨', '🌙', '🌸', '🦋', '⭐', '📚', '🗝️', '🌿', '☁️', '🔥', '💫', '🌻']

function Avatar({ character, size }: { character: Character; size: 'small' | 'large' | 'message' | 'detail' }) {
  return <div className={`avatar avatar-${size} avatar-${character.palette}`} aria-hidden="true">{character.avatarUrl ? <img src={character.avatarUrl} alt="" /> : <span className={character.avatarIcon ? 'avatar-symbol' : undefined}>{character.avatarIcon || character.initials}</span>}<i /></div>
}

type ChatControlOption = { value: string; label: string; description?: string }

function ControlMenu({ className = '', icon, label, value, options, onChange }: {
  className?: string
  icon: React.ReactNode
  label: string
  value: string
  options: ChatControlOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedOption = options[selectedIndex] ?? options[0]

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current[selectedIndex >= 0 ? selectedIndex : 0]?.focus()
  }, [open, selectedIndex])

  function focusOption(index: number) {
    const nextIndex = (index + options.length) % options.length
    optionRefs.current[nextIndex]?.focus()
  }

  return <div className={`control-menu ${className}`} ref={rootRef}>
    <button
      ref={triggerRef}
      className="control-menu-trigger"
      type="button"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setOpen(true)
        }
      }}
    >
      <span className="control-menu-icon">{icon}</span>
      <span className="control-menu-value">{selectedOption?.label ?? value}</span>
      <ChevronDown className="control-menu-chevron" size={14} aria-hidden="true" />
    </button>
    {open && <div className="control-menu-popover" role="listbox" aria-label={label}>
      {options.map((option, index) => <button
        key={option.value}
        ref={(element) => { optionRefs.current[index] = element }}
        type="button"
        role="option"
        aria-selected={option.value === value}
        className={`control-menu-option ${option.value === value ? 'control-menu-option-selected' : ''}`}
        onClick={() => {
          onChange(option.value)
          setOpen(false)
          triggerRef.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            focusOption(index + 1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            focusOption(index - 1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            focusOption(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            focusOption(options.length - 1)
          }
        }}
      >
        <span className="control-menu-option-copy">
          <span>{option.label}</span>
          {option.description && <small>{option.description}</small>}
        </span>
        {option.value === value && <Check size={15} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}

function DiscoverView({ characters, resumeCharacter, resumeTitle, searchValue, onSearchChange, catalogSource, communityLoading, communityError, hasMoreCommunity, publishingCharacterId, filter, genres, genreFilter, tags, tagFilter, povs, povFilter, genders, genderFilter, ratingFilter, sortBy, canShowSimilar, onCatalogSourceChange, onLoadMore, onRetry, onPublish, onFilterChange, onGenreChange, onTagChange, onPovChange, onGenderChange, onRatingChange, onSortChange, onOpen, onResume, onSurprise, onFavorite, onPin, onSimilar, onEdit, onCreate, onImport, aiSetupNeeded, providerLabel, onOpenSettings }: {
  characters: Character[]
  resumeCharacter: Character | null
  resumeTitle: string
  searchValue: string
  onSearchChange: (value: string) => void
  catalogSource: CatalogSource
  communityLoading: boolean
  communityError: string
  hasMoreCommunity: boolean
  publishingCharacterId: string
  filter: LibraryFilter
  genres: string[]
  genreFilter: string
  tags: string[]
  tagFilter: string
  povs: string[]
  povFilter: string
  genders: string[]
  genderFilter: string
  ratingFilter: string
  sortBy: string
  canShowSimilar: boolean
  onCatalogSourceChange: (source: CatalogSource) => void
  onLoadMore: () => void
  onRetry: () => void
  onPublish: (character: Character) => void
  onFilterChange: (filter: LibraryFilter) => void
  onGenreChange: (genre: string) => void
  onTagChange: (tag: string) => void
  onPovChange: (pov: string) => void
  onGenderChange: (gender: string) => void
  onRatingChange: (rating: string) => void
  onSortChange: (sort: string) => void
  onOpen: (character: Character) => void
  onResume: () => void
  onSurprise: () => void
  onFavorite: (id: string) => void
  onPin: (id: string) => void
  onSimilar: (character: Character) => void
  onEdit: (character: Character) => void
  onCreate: () => void
  onImport: () => void
  aiSetupNeeded: boolean
  providerLabel: string
  onOpenSettings: () => void
}) {
  const tabs: { id: LibraryFilter; label: string }[] = catalogSource === 'community'
    ? [{ id: 'all', label: 'All' }, { id: 'featured', label: 'Featured' }, { id: 'trending', label: 'Trending' }]
    : [
        { id: 'all', label: 'All' },
        { id: 'featured', label: 'Featured' },
        { id: 'trending', label: 'Trending here' },
        { id: 'recommended', label: 'For you' },
        { id: 'favorites', label: 'Favorites' },
        ...(canShowSimilar ? [{ id: 'similar' as const, label: 'Similar' }] : []),
      ]

  return <section className="discover-view">
    <div className="discover-intro">
      <div><div className="eyebrow">CHARACTER DISCOVERY <span className="eyebrow-line" /></div><h1>Find your next story.</h1><p>Meet a character, open a conversation, and make the story yours.</p></div>
      <div className="discover-intro-actions">
        <button className="surprise-button" onClick={onSurprise}><Sparkles size={15} /> Surprise me</button>
        <button className="create-button" onClick={onCreate}><Plus size={16} /> Create character</button>
      </div>
    </div>
    {resumeCharacter && <section className={`resume-story resume-story-${resumeCharacter.palette}`} aria-label="Continue your latest story">
      <div className="resume-art"><div className="resume-orbit" /><Avatar character={resumeCharacter} size="detail" /></div>
      <div className="resume-copy">
        <div className="resume-kicker"><Clock3 size={12} /> PICK UP WHERE YOU LEFT OFF</div>
        <h2>{resumeTitle || `A story with ${resumeCharacter.name}`}</h2>
        <p><span>{resumeCharacter.name}</span> · {resumeCharacter.title || resumeCharacter.tagline}</p>
      </div>
      <button className="resume-button" onClick={onResume}>Continue story <ArrowUpRight size={15} /></button>
    </section>}
    {aiSetupNeeded && <div className="ai-setup-banner" role="status">
      <div className="ai-setup-copy"><Sparkles size={15} /><span>Connect {providerLabel} to start generating replies.</span></div>
      <button className="create-button" type="button" onClick={onOpenSettings}><Settings2 size={14} /> Open settings</button>
    </div>}
    <label className="discover-search"><Search size={18} /><input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search characters, genres, and tags" aria-label="Search characters, genres, and tags" />{searchValue && <button type="button" aria-label="Clear discovery search" onClick={() => onSearchChange('')}><X size={15} /></button>}</label>
    <div className="catalog-source-tabs" role="tablist" aria-label="Character catalog">
      <button role="tab" aria-selected={catalogSource === 'local'} className={catalogSource === 'local' ? 'catalog-source-active' : ''} onClick={() => onCatalogSourceChange('local')}><Laptop size={14} /> On this device</button>
      <button role="tab" aria-selected={catalogSource === 'community'} className={catalogSource === 'community' ? 'catalog-source-active' : ''} onClick={() => onCatalogSourceChange('community')}><Compass size={14} /> Community catalog</button>
      {catalogSource === 'community' && <span className={`community-status ${communityError ? 'community-status-error' : ''}`}>{communityLoading ? 'Connecting...' : communityError ? 'Offline' : 'Live catalog'}</span>}
    </div>
    {communityError && catalogSource === 'community' && <div className="community-error" role="status"><span>{communityError}</span><button className="text-action" onClick={onRetry}>Retry</button></div>}
    <div className="library-controls">
      <div className="library-tabs" role="tablist" aria-label="Character collection">
        {tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={filter === tab.id} className={filter === tab.id ? 'library-tab-active' : ''} onClick={() => onFilterChange(tab.id)}>{tab.id === 'favorites' && <Heart size={13} />}{tab.label}</button>)}
      </div>
      <div className="discover-toolbar">
        <span>{characters.length} {characters.length === 1 ? 'CHARACTER' : 'CHARACTERS'}</span>
        <div className="discover-filters">
          <label><span className="sr-only">Filter by genre</span><select value={genreFilter} onChange={(event) => onGenreChange(event.target.value)}>{genres.map((genre) => <option key={genre}>{genre}</option>)}</select><ChevronDown size={13} /></label>
          <label><span className="sr-only">Filter by tag</span><select value={tagFilter} onChange={(event) => onTagChange(event.target.value)}>{tags.map((tag) => <option key={tag}>{tag}</option>)}</select><ChevronDown size={13} /></label>
          <label><span className="sr-only">Filter by point of view</span><select value={povFilter} onChange={(event) => onPovChange(event.target.value)}>{povs.map((pov) => <option key={pov}>{pov}</option>)}</select><ChevronDown size={13} /></label>
          <label><span className="sr-only">Filter by gender</span><select value={genderFilter} onChange={(event) => onGenderChange(event.target.value)}>{genders.map((gender) => <option key={gender}>{gender}</option>)}</select><ChevronDown size={13} /></label>
          <label><span className="sr-only">Filter by content rating</span><select value={ratingFilter} onChange={(event) => onRatingChange(event.target.value)}><option>All ratings</option><option>SFW</option><option>Limited</option><option>Limitless</option><option>Mature</option></select><ChevronDown size={13} /></label>
          {catalogSource === 'local' && <label><span className="sr-only">Sort characters</span><select value={sortBy} onChange={(event) => onSortChange(event.target.value)}><option>Recently added</option><option>Name</option><option>Most loved</option><option>Trending here</option></select><ChevronDown size={13} /></label>}
        </div>
      </div>
    </div>
    {characters.length ? <div className="character-grid">{characters.map((character, index) => <article className="discover-card" key={character.id} style={{ animationDelay: `${index * 45}ms` }}>
      <div className={`card-art card-art-${character.palette}`}><div className="card-art-orbit" /><Avatar character={character} size="detail" /><span className="rating-tag">{character.rating ?? 'SFW'}</span>{catalogSource === 'local' && <><button className={`card-favorite ${character.favorite ? 'is-favorite' : ''}`} aria-label={character.favorite ? 'Remove favorite' : 'Add favorite'} onClick={() => onFavorite(character.id)}><Heart size={16} fill={character.favorite ? 'currentColor' : 'none'} /></button><button className="card-pin" title={character.pinned ? 'Unpin character' : 'Pin character'} aria-label={character.pinned ? 'Unpin character' : 'Pin character'} onClick={() => onPin(character.id)}>{character.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button><button className="card-edit" title={`Edit ${character.name}`} aria-label={`Edit ${character.name}`} onClick={() => onEdit(character)}><Pencil size={14} /></button></>}</div>
      <div className="discover-card-body"><div className="card-meta"><span>{character.genre}</span><span>{character.gender || 'Unspecified'}</span><span>{character.pov ?? 'Third person'}</span></div><h2>{character.title || character.tagline || character.nickname?.trim() || character.name}</h2>{(character.title || character.tagline) && <div className="discover-card-character-name">Character: {character.name}</div>}<div className="card-tags" aria-label="Character tags">{character.tags.map((tag, tagIndex) => <span key={`${tag}-${tagIndex}`}>{tag}</span>)}</div><p>{character.description}</p><button className="open-story" onClick={() => onOpen(character)}>Open conversation <ArrowUpRight size={14} /></button>{catalogSource === 'local' && <><button className="similar-story" onClick={() => onSimilar(character)}><Sparkles size={12} /> Find similar characters</button><button className="similar-story publish-character" disabled={publishingCharacterId === character.id} onClick={() => onPublish(character)}><Share2 size={12} /> {publishingCharacterId === character.id ? 'Submitting...' : 'Submit to community'}</button></>}</div>
    </article>)}</div> : <div className="empty-library"><Compass size={24} /><h2>{communityLoading ? 'Finding characters...' : communityError ? 'Community is offline' : catalogSource === 'local' ? 'Start your archive' : 'No characters match'}</h2><p>{communityError ? 'The community catalog could not be reached. Your on-device characters are safe and ready to browse.' : catalogSource === 'community' ? 'No approved public characters match these filters yet.' : 'Create a character or import one to start your next story.'}</p>{catalogSource === 'local' ? <div className="empty-library-actions"><button className="create-button" onClick={onCreate}><Plus size={16} /> Create character</button><button className="surprise-button" onClick={onImport}><Upload size={15} /> Import character</button></div> : communityError ? <div className="empty-library-actions"><button className="create-button" type="button" onClick={() => onCatalogSourceChange('local')}><Laptop size={16} /> Browse local library</button><button className="surprise-button" type="button" onClick={onCreate}><Plus size={15} /> Create character</button></div> : <button className="create-button" onClick={onCreate}><Plus size={16} /> Create character</button>}</div>}
    {catalogSource === 'community' && hasMoreCommunity && <div className="catalog-load-more"><button className="create-button" disabled={communityLoading} onClick={onLoadMore}>{communityLoading ? 'Loading...' : 'Load more characters'}</button></div>}
  </section>
}

function WelcomeModal({ onClose, onCreate, onImport, onConnectModel }: { onClose: () => void; onCreate: () => void; onImport: () => void; onConnectModel: () => void }) {
  useEscapeToClose(onClose)
  const [step, setStep] = useState<'intro' | 'setup' | 'ready'>('intro')

  function renderStep() {
    if (step === 'intro') {
      return <>
        <div className="welcome-intro-copy">
          <div className="eyebrow">WELCOME <span className="eyebrow-line" /></div>
          <h2 id="welcome-title">Build your first story.</h2>
          <p>NovaRole is a private character studio. Start with a hero, connect an AI model, and begin your session in minutes.</p>
        </div>
        <div className="welcome-tiles">
          <button type="button" className="welcome-tile" onClick={onCreate}><Plus size={18} /><span><b>Create character</b><small>Write a new protagonist and start a fresh roleplay.</small></span></button>
          <button type="button" className="welcome-tile" onClick={onImport}><Upload size={18} /><span><b>Import character</b><small>Bring in an existing SillyTavern card or JSON backup.</small></span></button>
          <button type="button" className="welcome-tile" onClick={onConnectModel}><Settings2 size={18} /><span><b>Connect model</b><small>Use Ollama locally or connect a provider in app settings.</small></span></button>
        </div>
      </>
    }
    if (step === 'setup') {
      return <>
        <div className="welcome-intro-copy">
          <div className="eyebrow">SETUP <span className="eyebrow-line" /></div>
          <h2>Recommended path</h2>
          <p>Open app settings and choose the best provider for your machine. For a local-first setup, Ollama is the easiest and most private option.</p>
        </div>
        <div className="welcome-pills">
          <span>Ollama</span>
          <span>OpenAI</span>
          <span>Groq</span>
          <span>Custom API</span>
        </div>
        <ul className="welcome-list">
          <li>Install Ollama and pull a model like <code>llama3.2</code>.</li>
          <li>Open settings and click “Refresh models”.</li>
          <li>Select the model and choose “Use model”.</li>
        </ul>
      </>
    }

    return <>
      <div className="welcome-intro-copy">
        <div className="eyebrow">READY <span className="eyebrow-line" /></div>
        <h2>You’re all set.</h2>
        <p>Start writing a scene, continue a story, or connect a model to unlock live replies.</p>
      </div>
      <div className="welcome-ready-actions">
        <button type="button" className="create-button" onClick={onCreate}>Create character</button>
        <button type="button" className="surprise-button" onClick={onConnectModel}>Connect model</button>
      </div>
    </>
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="create-modal welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <header><div><div className="eyebrow">WELCOME <span className="eyebrow-line" /></div><h2 id="welcome-title">First steps</h2><p>Take the quick route into your story.</p></div><button type="button" className="icon-button" aria-label="Close welcome screen" onClick={onClose}><X size={18} /></button></header>
    {renderStep()}
    <div className="welcome-footer">
      {step === 'intro' && <p>Start local, then connect a model whenever you’re ready.</p>}
      {step === 'setup' && <p>Prefer a private local setup? Ollama is the best default.</p>}
      {step === 'ready' && <p>Everything is ready — just choose your first move.</p>}
      <div className="welcome-footer-actions">
        {step !== 'intro' && <button type="button" className="text-action" onClick={() => setStep(step === 'setup' ? 'intro' : 'setup')}>Back</button>}
        {step === 'intro' && <button type="button" className="create-button" onClick={() => setStep('setup')}>Next</button>}
        {step === 'setup' && <button type="button" className="create-button" onClick={() => setStep('ready')}>Continue</button>}
        {step === 'ready' && <button type="button" className="create-button" onClick={onClose}>Start</button>}
      </div>
    </div>
  </div></div>
}

function CreateCharacterModal({ character, onClose, onSave }: { character?: Character; onClose: () => void; onSave: (character: Character) => void }) {
  useEscapeToClose(onClose)
  const [name, setName] = useState(character?.name ?? '')
  const [title, setTitle] = useState(character?.title ?? '')
  const [nickname, setNickname] = useState(character?.nickname ?? '')
  const [tagline, setTagline] = useState(character?.tagline ?? '')
  const [description, setDescription] = useState(character?.description ?? '')
  const [personality, setPersonality] = useState(character?.personality ?? '')
  const [scenario, setScenario] = useState(character?.scenario ?? '')
  const [exampleDialogues, setExampleDialogues] = useState(character?.exampleDialogues ?? '')
  const [lorebook, setLorebook] = useState((character?.loreEntries ?? []).map((entry) => `${entry.keywords.join(', ')} | ${entry.content}`).join('\n'))
  const [greeting, setGreeting] = useState(character?.greeting ?? '')
  const [genre, setGenre] = useState(character?.genre ?? 'NEW STORY')
  const [tags, setTags] = useState(character?.tags.join(', ') ?? 'Original')
  const [pov, setPov] = useState(character?.pov ?? 'Third person')
  const [gender, setGender] = useState(character?.gender ?? 'Unspecified')
  const [rating, setRating] = useState<NonNullable<Character['rating']>>(character?.rating ?? 'SFW')
  const [featured, setFeatured] = useState(character?.featured ?? false)
  const [palette, setPalette] = useState<Character['palette']>(character?.palette ?? 'moss')
  const [avatarUrl, setAvatarUrl] = useState(character?.avatarUrl ?? '')
  const [avatarIcon, setAvatarIcon] = useState(character?.avatarIcon ?? '')
  const [avatarError, setAvatarError] = useState('')

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setAvatarUrl(await resizeAvatar(file))
      setAvatarError('')
    } catch (cause) {
      setAvatarError(cause instanceof Error ? cause.message : 'This image could not be used.')
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !greeting.trim()) return
    const fields = {
      name: name.trim(),
      title: title.trim() || tagline.trim() || name.trim(),
      nickname: nickname.trim(),
      tagline: tagline.trim() || 'A new story begins',
      description: description.trim() || tagline.trim() || 'A new story begins',
      personality: personality.trim(),
      scenario: scenario.trim(),
      exampleDialogues: exampleDialogues.trim(),
      loreEntries: lorebook.split('\n').flatMap((line) => {
        const separator = line.indexOf('|')
        if (separator < 0) return []
        const keywords = line.slice(0, separator).split(',').map((keyword) => keyword.trim()).filter(Boolean)
        const content = line.slice(separator + 1).trim()
        return keywords.length && content ? [{ id: crypto.randomUUID(), keywords, content, enabled: true }] : []
      }),
      greeting: greeting.trim(),
      genre: genre.trim().toUpperCase() || 'NEW STORY',
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      pov,
      gender: gender.trim() || 'Unspecified',
      rating: rating as Character['rating'],
      featured,
      palette,
      avatarUrl,
      avatarIcon: avatarIcon || undefined,
    }
    if (character) {
      onSave({ ...character, ...fields, initials: fields.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'NR' })
    } else {
      onSave(createCharacter(fields))
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="create-modal character-modal" role="dialog" aria-modal="true" onSubmit={submit} aria-labelledby="create-title">
      <header><div><div className="eyebrow">CHARACTER BUILDER <span className="eyebrow-line" /></div><h2 id="create-title">{character ? 'Refine this character.' : 'Bring someone to life.'}</h2><p>Character details and chats stay on this device.</p></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
      <div className="builder-avatar-row">
        <div className={`avatar avatar-large avatar-${palette}`}>{avatarUrl ? <img src={avatarUrl} alt="" /> : <span className={avatarIcon ? 'avatar-symbol' : undefined}>{avatarIcon || name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'NR'}</span>}<i /></div>
        <div className="builder-avatar-controls"><label className="avatar-file-field">Upload avatar<input type="file" accept="image/*" onChange={(event) => void handleAvatarChange(event)} /></label>{avatarUrl && <button className="text-action" type="button" onClick={() => setAvatarUrl('')}>Remove image</button>}<small>Choose an icon or upload an image. Uploaded images take priority.</small>{avatarError && <small className="form-error">{avatarError}</small>}</div>
        <label className="palette-field">Frame<select value={palette} onChange={(event) => setPalette(event.target.value as Character['palette'])}><option value="moss">Moss</option><option value="rose">Rose</option><option value="blue">Blue</option><option value="gold">Gold</option></select></label>
      </div>
      <div className="character-icon-picker" role="group" aria-label="Choose a character icon">
        <span>Character icon</span>
        <button type="button" className={!avatarIcon ? 'character-icon-selected' : ''} aria-label="Use initials" aria-pressed={!avatarIcon} onClick={() => setAvatarIcon('')}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'Aa'}</button>
        {CHARACTER_ICON_OPTIONS.map((icon) => <button key={icon} type="button" className={avatarIcon === icon ? 'character-icon-selected' : ''} aria-label={`Use character icon ${icon}`} aria-pressed={avatarIcon === icon} onClick={() => setAvatarIcon(icon)}>{icon}</button>)}
      </div>
      <label>Name used in chat<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Mara Venn" maxLength={48} required /><small className="field-help">This is the name characters use in messages and conversation headers.</small></label>
      <label>Story title / character role<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. The midnight librarian" maxLength={120} /><small className="field-help">Shown in discovery as the story hook; the character’s name remains the name used in chat.</small></label>
      <label>Custom nickname<input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="Optional name shown in your library" maxLength={48} /></label>
      <label>Short description<input value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder="A cartographer chasing the impossible" maxLength={90} /></label>
      <label>Character overview<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who are they, and what makes this story interesting?" rows={3} /></label>
      <label>Personality and backstory<textarea value={personality} onChange={(event) => setPersonality(event.target.value)} placeholder="How do they speak? What do they want? Where did they come from?" rows={3} /></label>
      <label>Scenario<textarea value={scenario} onChange={(event) => setScenario(event.target.value)} placeholder="Where does the story begin, and what is happening?" rows={2} /></label>
      <label>Example dialogue<textarea value={exampleDialogues} onChange={(event) => setExampleDialogues(event.target.value)} placeholder="Character: I knew you would find me.\nYou: What happened here?" rows={2} /></label>
      <label>Keyword lorebook<textarea value={lorebook} onChange={(event) => setLorebook(event.target.value)} placeholder={'star signal, observatory | The star pulses three times, pauses, then pulses twice.'} rows={3} /><small className="field-help">One entry per line. Lore is injected only when a keyword appears in recent messages.</small></label>
      <label>Opening message<textarea value={greeting} onChange={(event) => setGreeting(event.target.value)} placeholder="The first thing they say to you..." rows={3} required /></label>
      <div className="builder-metadata-grid">
        <label>Genre<input value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="Fantasy, sci-fi..." maxLength={32} /></label>
        <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Mystery, cozy, adventure" /><small className="field-help">Separate tags with commas.</small></label>
        <label>Point of view<select value={pov} onChange={(event) => setPov(event.target.value)}><option>First person</option><option>Second person</option><option>Third person</option></select></label>
        <label>Gender<input value={gender} onChange={(event) => setGender(event.target.value)} placeholder="Unspecified" maxLength={32} /><small className="field-help">Shown with the character’s discovery details.</small></label>
        <label>Content rating<select value={rating} onChange={(event) => setRating(event.target.value as NonNullable<Character['rating']>)}><option>SFW</option><option>Limited</option><option>Limitless</option><option>Mature</option></select></label>
        <label className="featured-toggle"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> Feature in this library</label>
      </div>
      <footer><span><ShieldCheck size={13} /> Stored locally</span><button className="create-button" type="submit" disabled={!name.trim() || !greeting.trim()}><Sparkles size={15} /> {character ? 'Save changes' : 'Create character'}</button></footer>
    </form>
  </div>
}

function ImportCharacterModal({ onClose, onImport }: { onClose: () => void; onImport: (character: Character) => void }) {
  useEscapeToClose(onClose)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return
    setImporting(true)
    setError('')
    try {
      onImport(await importCharacterFile(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This character card could not be imported.')
      setImporting(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="create-modal import-modal" role="dialog" aria-modal="true" onSubmit={submit} aria-labelledby="import-title">
    <header><div><div className="eyebrow">CHARACTER IMPORT <span className="eyebrow-line" /></div><h2 id="import-title">Bring a character with you.</h2><p>Import a SillyTavern character card in JSON or PNG format.</p></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
    <label className="file-dropzone"><Upload size={20} /><span>{file ? file.name : 'Choose a character card'}</span><small>JSON definition or PNG with embedded chara data</small><input type="file" accept=".json,.png,application/json,image/png" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError('') }} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><span><ShieldCheck size={13} /> Imported data stays on this device</span><button className="create-button" type="submit" disabled={!file || importing}><Upload size={15} /> {importing ? 'Importing...' : 'Import character'}</button></footer>
  </form></div>
}

function LocalProfileModal({ profile, account, theme, onThemeChange, models, model, ollamaState, onModelChange, onUseModel, onRefreshModels, providerConfig, onSaveProviderConfig, onExportBackup, onImportBackup, onClose, onSave, onAuthenticate, onSignOut, syncStatus, onRetrySync }: {
  profile?: LocalProfile | null
  account: CommunityAccount | null
  theme: Theme
  onThemeChange: (theme: Theme) => void
  models: string[]
  model: string
  ollamaState: OllamaState
  onModelChange: (model: string) => void
  onUseModel: (model: string) => void
  onRefreshModels: (config?: AiProviderConfig) => void
  providerConfig: AiProviderConfig
  onSaveProviderConfig: (config: AiProviderConfig) => void
  onExportBackup: () => void
  onImportBackup: (file: File) => void
  onClose: () => void
  onSave: (profile: LocalProfile) => void
  onAuthenticate: (account: CommunityAccount) => void
  onSignOut: () => void
  syncStatus: SyncStatus
  onRetrySync: () => void
}) {
  useEscapeToClose(onClose)
  const [mode, setMode] = useState<'login' | 'register' | 'local'>('login')
  const [showAuth, setShowAuth] = useState(false)
  const [providerDraft, setProviderDraft] = useState(providerConfig)
  const [showApiKey, setShowApiKey] = useState(false)
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [handle, setHandle] = useState('')
  const [email, setEmail] = useState(account?.email ?? profile?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const accountServiceOffline = error.startsWith('Community service is offline.')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (mode === 'local') {
      onSave({ displayName: displayName.trim(), email: email.trim(), createdAt: profile?.createdAt ?? Date.now() })
      return
    }
    setBusy(true)
    try {
      const result = mode === 'register'
        ? await registerAccount({ email: email.trim(), handle: handle.trim(), displayName: displayName.trim(), password })
        : await loginAccount({ email: email.trim(), password })
      onAuthenticate(result.account)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account request failed.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>{account || !showAuth ? <section className="create-modal app-settings-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
    <header><div><div className="eyebrow">YOUR STUDIO <span className="eyebrow-line" /></div><h2 id="profile-title">App settings</h2><p>Make NovaRole feel like yours.</p></div><button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}><X size={18} /></button></header>
    <section className="settings-group" aria-labelledby="appearance-title">
      <div className="settings-group-heading"><div><h3 id="appearance-title">Appearance</h3><p>Choose the look of your studio.</p></div></div>
      <div className="settings-choice-row">
        <button type="button" className={`settings-choice ${theme === 'light' ? 'settings-choice-active' : ''}`} aria-pressed={theme === 'light'} onClick={() => onThemeChange('light')}><Sun size={16} /><span><b>Light</b><small>Warm paper, soft greens</small></span></button>
        <button type="button" className={`settings-choice ${theme === 'dark' ? 'settings-choice-active' : ''}`} aria-pressed={theme === 'dark'} onClick={() => onThemeChange('dark')}><Moon size={16} /><span><b>Dark</b><small>Easy on the eyes</small></span></button>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="model-settings-title">
      <div className="settings-group-heading"><div><h3 id="model-settings-title">AI connection</h3><p>Use a local model or connect an OpenAI-compatible provider.</p></div><span className={`settings-model-status ${ollamaState}`}><i />{ollamaState === 'ready' ? 'Ready' : ollamaState === 'checking' ? 'Connecting' : 'Not connected'}</span></div>
      <label className="settings-field-label">Provider<select aria-label="AI provider" value={providerDraft.provider} onChange={(event) => setProviderDraft((current) => ({ ...current, provider: event.target.value as AiProvider, ...(event.target.value === 'ollama' ? { apiKey: '' } : {}) }))}><option value="ollama">Ollama · local and private</option><option value="groq">Groq · fast inference</option><option value="openai">OpenAI</option><option value="custom">Custom OpenAI-compatible API</option></select></label>
      {providerDraft.provider === 'custom' && <label className="settings-field-label">API base URL<input type="url" value={providerDraft.customBaseUrl} onChange={(event) => setProviderDraft((current) => ({ ...current, customBaseUrl: event.target.value }))} placeholder="https://api.example.com/v1" autoComplete="url" /></label>}
      {providerDraft.provider !== 'ollama' && <label className="settings-field-label">API key<div className="settings-key-input"><input type={showApiKey ? 'text' : 'password'} value={providerDraft.apiKey} onChange={(event) => setProviderDraft((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Paste your provider API key" autoComplete="off" spellCheck={false} /><button type="button" aria-label={showApiKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowApiKey((current) => !current)}>{showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>}
      {providerDraft.provider === 'ollama' && <p className="settings-help">Ollama keeps generation on this device. Start Ollama, then pull a model such as <code>llama3.2</code> or <code>qwen2.5</code>.</p>}
      {providerDraft.provider !== 'ollama' && <p className="settings-security-note"><ShieldCheck size={13} /> API keys are saved only in this browser and sent directly to your provider over HTTPS. They are never included in account sync. Anyone with access to this browser profile can use the saved key.</p>}
      <label className="settings-field-label">Model<input list="provider-model-options" aria-label="Default local AI model" value={model} onChange={(event) => onModelChange(event.target.value)} placeholder={models.length ? 'Choose or type a model ID' : 'Enter a model ID'} /><datalist id="provider-model-options">{models.map((availableModel) => <option key={availableModel} value={availableModel} />)}</datalist></label>
      <p className="settings-help">Recommended: choose a provider, refresh models, then click “Use model” before starting a chat. If a provider is unreachable, check the URL or local service status before retrying.</p>
      <div className="settings-model-actions">
        <button type="button" className="settings-refresh" onClick={() => onRefreshModels()} disabled={ollamaState === 'checking'}>{ollamaState === 'checking' ? 'Connecting…' : 'Refresh models'}</button>
        <button type="button" className="settings-refresh" onClick={() => onSaveProviderConfig(providerDraft)}>Save &amp; connect</button>
        <button type="button" className="create-button" disabled={!model.trim()} onClick={() => onUseModel(model)}>Use model</button>
      </div>
      {models.length > 0 && <p className="settings-help">{models.length} model{models.length === 1 ? '' : 's'} available. You can also enter a model ID manually.</p>}
      {!models.length && ollamaState !== 'checking' && ollamaState !== 'ready' && <p className="settings-help">Model discovery failed. Check your connection, or enter a model ID and choose “Use model” to try it anyway.</p>}
    </section>
    <section className="settings-group account-settings-group" aria-labelledby="account-settings-title">
      {account ? <>
        <div className="settings-group-heading"><div><h3 id="account-settings-title">Account &amp; backup</h3><p>{account.displayName} · @{account.handle}</p></div><span className={`settings-sync-status settings-sync-${syncStatus}`}><i />{syncStatus === 'synced' ? 'Synced' : syncStatus === 'saving' ? 'Saving' : syncStatus === 'loading' ? 'Loading' : syncStatus === 'error' ? 'Needs attention' : 'On this device'}</span></div>
        <p className="settings-help">{syncStatus === 'error' ? 'Your local copy is safe. Retry to reconnect your private account backup.' : syncStatus === 'saving' ? 'A local change is being uploaded to your account backup.' : syncStatus === 'loading' ? 'Loading your latest private workspace from the configured API.' : 'Your characters and conversations are private to your account and are not published to the community.'}</p>
        <div className="settings-account-actions">{syncStatus === 'error' && <button className="settings-refresh" type="button" onClick={onRetrySync}>Retry sync</button>}<span>{account.email}</span><button className="text-action" type="button" onClick={onSignOut}><LogOut size={13} /> Sign out</button></div>
      </> : <>
        <div className="settings-group-heading"><div><h3 id="account-settings-title">Account &amp; backup</h3><p>{profile?.displayName || 'Local workspace'} · {profile?.email || 'Not signed in'}</p></div></div>
        <p className="settings-help">Sign in to sync your private characters and conversations between devices. AI provider keys remain on this device.</p>
        <div className="settings-account-actions"><button className="settings-refresh" type="button" onClick={() => { setMode('login'); setShowAuth(true) }}>Sign in</button><button className="settings-refresh" type="button" onClick={() => { setMode('register'); setShowAuth(true) }}>Create account</button><button className="settings-refresh" type="button" onClick={() => { setMode('local'); setShowAuth(true) }}>Edit local profile</button></div>
      </>}
    </section>
    <section className="settings-group" aria-labelledby="backup-settings-title">
      <div className="settings-group-heading"><div><h3 id="backup-settings-title">Your data</h3><p>Take your stories with you, whenever you want.</p></div></div>
      <p className="settings-help">Export a portable backup of your characters, conversations, personas and preferences. Importing merges it with your current workspace; it does not delete anything.</p>
      <div className="settings-account-actions">
        <button className="settings-refresh" type="button" onClick={onExportBackup}><Download size={13} /> Export backup</button>
        <label className="settings-refresh backup-import-button"><input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportBackup(file); event.target.value = '' }} /><Upload size={13} /> Import &amp; merge</label>
      </div>
    </section>
    <footer><span><ShieldCheck size={13} /> Preferences are saved on this device</span><button className="create-button" type="button" onClick={onClose}>Done</button></footer>
  </section> : <form className="create-modal profile-modal" role="dialog" aria-modal="true" onSubmit={submit} aria-labelledby="profile-title">
    <header><div><div className="eyebrow">{mode === 'local' ? 'DEVICE PROFILE' : 'NOVAROLE ACCOUNT'} <span className="eyebrow-line" /></div><h2 id="profile-title">{mode === 'local' ? 'Continue locally.' : mode === 'register' ? 'Create your account.' : 'Sign in.'}</h2><p>{mode === 'local' ? 'A local profile stays only in this browser.' : 'Sign in to restore and sync your private workspace.'}</p></div><button type="button" className="icon-button" aria-label="Back to settings" onClick={() => setShowAuth(false)}><ArrowLeft size={18} /></button></header>
    <div className="account-mode-tabs">
      <button type="button" className={mode === 'login' ? 'account-mode-active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button>
      <button type="button" className={mode === 'register' ? 'account-mode-active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button>
      <button type="button" className={mode === 'local' ? 'account-mode-active' : ''} onClick={() => { setMode('local'); setError('') }}>Local profile</button>
    </div>
    {mode !== 'local' && <div className="local-auth-notice"><ShieldCheck size={16} /><p>Private workspace backup is stored on your configured API server. Signing in merges existing local and account data. Use at least 12 characters for a new password.</p></div>}
    {(mode === 'local' || mode === 'register') && <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How should we address you?" maxLength={48} required /></label>}
    {mode === 'register' && <label>Handle<input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="letters, numbers, underscores" minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" required /></label>}
    <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" maxLength={254} required /></label>
    {mode !== 'local' && <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === 'register' ? 12 : 1} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required /></label>}
    {error && <div className="auth-error" role="alert"><p>{error}</p>{accountServiceOffline && <><p>Your characters and chats are still saved on this device. No account was created; start the API to enable account features, or continue with a local profile.</p><button className="text-action" type="button" onClick={() => { setMode('local'); setPassword(''); setError('') }}>Continue with a local profile</button></>}</div>}
    <footer><span><UserRound size={13} /> {mode === 'local' ? 'No password required' : 'Credentials go only to your configured API'}</span><button className="create-button" type="submit" disabled={busy}>{busy ? 'Connecting...' : mode === 'local' ? 'Save local profile' : mode === 'register' ? 'Create account' : 'Sign in'}</button></footer>
  </form>}</div>
}

function PersonasModal({ personas, defaultPersonaId, onClose, onSave }: { personas: Persona[]; defaultPersonaId: string; onClose: () => void; onSave: (personas: Persona[], defaultPersonaId: string) => void }) {
  useEscapeToClose(onClose)
  const [items, setItems] = useState(personas)
  const [selectedDefault, setSelectedDefault] = useState(defaultPersonaId)
  const [editingId, setEditingId] = useState('')
  const [name, setName] = useState('')
  const [pronouns, setPronouns] = useState('')
  const [details, setDetails] = useState('')

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const existing = items.find((item) => item.id === editingId)
    const persona: Persona = {
      id: editingId || crypto.randomUUID(),
      name: name.trim(),
      description: details.trim(),
      pronouns: pronouns.trim() || undefined,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    setItems((current) => editingId ? current.map((item) => item.id === editingId ? persona : item) : [...current, persona])
    setEditingId('')
    setName('')
    setPronouns('')
    setDetails('')
  }

  function edit(persona: Persona) {
    setEditingId(persona.id)
    setName(persona.name)
    setPronouns(persona.pronouns ?? '')
    setDetails([
      persona.appearance ? `Appearance: ${persona.appearance}` : '',
      persona.description,
    ].filter(Boolean).join('\n\n'))
  }

  function remove(personaId: string) {
    setItems((current) => current.filter((item) => item.id !== personaId))
    if (selectedDefault === personaId) setSelectedDefault('')
    if (editingId === personaId) {
      setEditingId('')
      setName('')
      setPronouns('')
      setDetails('')
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="create-modal persona-modal" role="dialog" aria-modal="true" aria-labelledby="personas-title">
    <header><div><div className="eyebrow">PERSISTENT IDENTITY <span className="eyebrow-line" /></div><h2 id="personas-title">Personas</h2><p>Choose the identity a character should remember across your chats.</p></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
    <div className="persona-list">{items.map((persona) => <div className="persona-row" key={persona.id}>
      <div className="persona-copy"><b>{persona.name}</b><small>{[persona.pronouns, persona.appearance, persona.description].filter(Boolean).join(' · ') || 'No additional details'}</small></div>
      {selectedDefault === persona.id ? <span className="default-persona">Default</span> : <button className="text-action" type="button" onClick={() => setSelectedDefault(persona.id)}>Set default</button>}
      <button className="tiny-icon-button" type="button" title={`Edit ${persona.name}`} aria-label={`Edit ${persona.name}`} onClick={() => edit(persona)}><Pencil size={14} /></button>
      <button className="tiny-icon-button persona-delete" type="button" title={`Delete ${persona.name}`} aria-label={`Delete ${persona.name}`} onClick={() => remove(persona.id)}><X size={14} /></button>
    </div>)}{!items.length && <p className="field-help">No personas yet. Create one below.</p>}</div>
    <form className="persona-form" onSubmit={submit}>
      <label>Persona name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ari, a traveling botanist" required /></label>
      <label>Pronouns<input value={pronouns} onChange={(event) => setPronouns(event.target.value)} placeholder="e.g. they/them" /></label>
      <label>Appearance, personality &amp; identity<textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Describe your appearance, personality, background, and anything else characters should know." rows={7} /></label>
      <div className="persona-form-actions"><button className="text-action" type="button" onClick={() => { setEditingId(''); setName(''); setPronouns(''); setDetails('') }}>{editingId ? 'Cancel edit' : ''}</button><button className="create-button" type="submit"><Plus size={14} /> {editingId ? 'Save persona' : 'Add persona'}</button></div>
    </form>
    <footer><span><ShieldCheck size={13} /> Saved locally and included in workspace backups</span><button className="create-button" type="button" onClick={() => onSave(items, selectedDefault)}>Save personas</button></footer>
  </div></div>
}

function MemoryModal({ chat, onClose, onSave }: { chat: Chat; onClose: () => void; onSave: (memory: { memorySummary: string; permanentMemory: string; memoryFacts: MemoryFact[] }) => void }) {
  useEscapeToClose(onClose)
  const [summary, setSummary] = useState(chat.memorySummary ?? '')
  const [permanentMemory, setPermanentMemory] = useState(chat.permanentMemory ?? '')
  const [facts, setFacts] = useState(chat.memoryFacts ?? [])
  const [draftFact, setDraftFact] = useState('')

  function addFact() {
    const content = draftFact.trim()
    if (!content) return
    setFacts((current) => [...current, { id: crypto.randomUUID(), content, pinned: false, createdAt: Date.now() }])
    setDraftFact('')
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="create-modal memory-modal" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); onSave({ memorySummary: summary.trim(), permanentMemory: permanentMemory.trim(), memoryFacts: facts }) }} aria-labelledby="memory-title">
    <header><div><div className="eyebrow">STORY CONTINUITY <span className="eyebrow-line" /></div><h2 id="memory-title">Memory</h2><p>These notes are included in generation context for this chat.</p></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
    <label>Chat summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="A concise recap of the story so far..." rows={3} /></label>
    <label>Permanent memory<textarea value={permanentMemory} onChange={(event) => setPermanentMemory(event.target.value)} placeholder="Important details to keep across the whole story..." rows={3} /></label>
    <label>Add a remembered fact<div className="memory-add-row"><input value={draftFact} onChange={(event) => setDraftFact(event.target.value)} placeholder="The user prefers quiet places" /><button className="tiny-icon-button" type="button" aria-label="Add memory fact" onClick={addFact} disabled={!draftFact.trim()}><Plus size={16} /></button></div></label>
    <div className="memory-fact-list">{facts.map((fact) => <div className="memory-fact-row" key={fact.id}><button className={`memory-pin ${fact.pinned ? 'memory-pin-active' : ''}`} type="button" aria-label={fact.pinned ? 'Unpin fact' : 'Pin fact'} onClick={() => setFacts((current) => current.map((item) => item.id === fact.id ? { ...item, pinned: !item.pinned } : item))}><Pin size={14} fill={fact.pinned ? 'currentColor' : 'none'} /></button><span>{fact.content}</span><button className="tiny-icon-button" type="button" aria-label="Remove fact" onClick={() => setFacts((current) => current.filter((item) => item.id !== fact.id))}><X size={14} /></button></div>)}{!facts.length && <p className="field-help">No saved facts yet.</p>}</div>
    <footer><span><BookOpen size={13} /> {facts.length} saved facts</span><button className="create-button" type="submit">Save memory</button></footer>
  </form></div>
}

function getStarterPrompts(character: Character, messages: Message[]): string[] {
  const recentText = messages.slice(-6).map((message) => message.content).join(' ').toLowerCase()
  const context = recentText || `${character.scenario} ${character.greeting}`.toLowerCase()
  const topics = [
    { terms: ['observatory', 'star', 'signal', 'telescope', 'orbit', 'sky'], label: 'the signal in the sky' },
    { terms: ['forest', 'lantern', 'trail', 'road', 'tree', 'village'], label: 'the forest road' },
    { terms: ['station', 'mechanic', 'relay', 'ship', 'engine', 'orbit'], label: 'the station' },
    { terms: ['archive', 'letter', 'timeline', 'book', 'memory'], label: 'the strange letter' },
  ]
  const topic = topics.find((item) => item.terms.some((term) => context.includes(term)))?.label
    ?? character.tags[0]?.toLowerCase()
    ?? 'the scene'
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')?.content.trim() ?? ''
  const name = character.nickname?.trim() || character.name

  if (!messages.length) {
    return [`Ask ${name} about ${topic}`, 'React to the opening scene', 'Set the tone for your story']
  }
  if (latestAssistant.includes('?')) {
    return [`Answer ${name}'s question`, `Ask ${name} to explain ${topic} further`, 'Share what you notice in the scene']
  }
  return [`Ask ${name} what happens next`, `Explore ${topic} together`, 'Take the story in a new direction']
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
}

function formatStoryDate(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  }).format(date)
}

async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file for the avatar.')
  if (file.size > 8_000_000) throw new Error('Choose an image smaller than 8 MB.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('Your browser cannot resize this image.')
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}

export default App