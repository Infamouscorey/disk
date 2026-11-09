# NovaRole

NovaRole is a local-first character and roleplay studio. Create characters, build persistent stories, and chat with a local AI model or a provider you configure. You can use the core app without an account; an optional self-hosted API adds accounts, private workspace sync, and a shared character catalog.

> **Privacy note:** “Local-first” does not mean every feature is offline. Ollama can keep generation on your device, while OpenAI/Groq/custom providers receive the prompt and relevant character/chat context. Account sync sends your workspace to the API server you choose. Read [Data, privacy, and backups](#data-privacy-and-backups) before connecting services.

## What you can do

- Create, edit, favorite, pin, search, sort, filter, and import characters.
- Import SillyTavern JSON character cards and PNG cards with uncompressed `chara` metadata. Compressed PNG metadata and `.charx` archives are not supported.
- Create persistent conversations with detailed personas (name, pronouns, appearance, and background), roleplay modes, memory summaries, permanent notes, pinned facts, and keyword-triggered lorebook entries.
- Search conversation titles, character names, and message history; rename or delete conversations from the sidebar.
- Adjust response length, context size, temperature, and top-p per conversation.
- Stop a streaming reply and keep the partial text, edit and retry your latest message, copy replies, regenerate the latest reply, and use browser read-aloud. Each message menu can pin it to permanent memory, branch into a new chat, or rewind the current chat to that message.
- Browse local discovery collections. “Trending here,” “Featured,” and “For you” are based on the characters stored on this device, not global rankings.
- Optionally register/sign in to sync a private workspace with your configured API and browse or submit characters to its community catalog.
- Export/import a portable JSON backup. Import merges data and does not delete existing records.
- If saved workspace data cannot be read, NovaRole pauses writes and offers backup restoration or a downloadable recovery copy rather than silently replacing it.
- Choose a light or dark theme and configure Ollama, OpenAI, Groq, or a compatible API from profile settings.

Content ratings are search metadata, not a complete moderation system. Lorebook lines use the format `keyword, another keyword | Text injected when a keyword appears in recent messages`. Arbitrary character scripts are not executed.

## Requirements
A web browser XD

### Web app

- Node.js 20 or later and npm (npm is included with Node.js).
- A modern browser.
- No account, Docker, or AI provider is required to explore the app and manage local characters/chats.

### Optional AI generation

Choose one:

- **Ollama:** install Ollama and download a model. Model size and speed depend on your computer.
- **OpenAI, Groq, or a custom OpenAI-compatible provider:** an API key and a model supported by that provider. Provider usage may incur charges.

### Optional accounts and community catalog

- Docker Desktop with Docker Compose to run PostgreSQL locally.
- Node.js/npm as above. The API dependencies are installed with the project.
- For a public deployment, a server, PostgreSQL, HTTPS/reverse proxy, secure secrets, backups, and operational monitoring. The included Docker Compose credentials are for local development only.

### Optional desktop app

- Rust stable.
- The native build prerequisites for Tauri on your operating system.
- On Windows: Microsoft C++ Build Tools and WebView2 Runtime. WebView2 is already installed on most current Windows systems.

## Install and run the web app

Open PowerShell (or a terminal) in the project folder
run the following commands:

npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`. Keep the terminal open while using the app; press **Ctrl+C** there to stop the development server.

To make a production web build:

```powershell
npm run build
npm run preview
```      


`npm run preview` serves the already-built app locally. For a live hosted deployment, serve the contents of `dist/` with a static web server and configure the API URL for that environment before building.

Run the focused workspace persistence and backup tests with:

```powershell
npm test
```

GitHub Actions runs lint, tests, and both production builds for pushes and pull requests.

## Quick start in the app

1. Open **Discover** and choose a character, or use **Create character** / **Import character**.
2. Open a conversation. Your workspace is saved in this browser/WebView on this device.
3. Open your profile to access **App settings**.
4. Configure an AI provider if you want to generate replies. Without a connected provider, you can still manage characters, conversations, and settings.
5. Use **Personas** to create identities with optional pronouns, appearance, and background, choose a workspace default, or manage personas directly from a conversation. Each conversation can inherit the default, choose another persona, or explicitly use no persona. Use the conversation's **Memory** control to add continuity notes.
6. Use **Export backup** periodically. Keep exported files private: they contain character definitions and chat history.

Use **Search conversations** in the sidebar to find a story by title, character, or a phrase from its messages. Rename stories or delete an unwanted conversation from its row; deletion cannot be undone. In chat, press **Enter** to send and **Shift+Enter** for a newline. **Stop** keeps any partial streamed reply. **Edit & retry** on your latest message replaces that turn and all later replies; **Copy** copies a reply, and **Regenerate** replaces the latest assistant reply. Open a message’s three-dot menu to pin or unpin it in permanent memory, continue from it in a separate chat, or rewind this chat through that message (later messages are removed after confirmation). Scrolling up pauses automatic follow so new tokens do not pull you away from older messages.

## Connect Ollama (local generation)

1. Install Ollama from [ollama.com](https://ollama.com/) and make sure its service is running.
2. Download a model in a terminal:

   ```powershell
   ollama pull llama3.2
   ```

3. Open NovaRole profile → **App settings** → **AI connection**. Select **Ollama**, refresh the model list, select a model, and choose **Use model**.

Ollama's default browser access policy may block requests from the app. If the model list does not load, allow the NovaRole origins when launching Ollama from PowerShell:

```powershell
$env:OLLAMA_ORIGINS = 'tauri://localhost,http://tauri.localhost,http://localhost:5173,http://127.0.0.1:5173'
ollama serve
```

If Ollama is already running as a background service, configure its environment and restart that service instead. Do not run a second `ollama serve` while another Ollama server is already listening on the port. The app connects to `http://localhost:11434`; keep Ollama available while generating.

## Connect OpenAI, Groq, or another provider

1. Open profile → **App settings** → **AI connection**.
2. Select **OpenAI**, **Groq**, or **Custom OpenAI-compatible API**.
3. Enter the provider's API key. For a custom provider, enter its API base URL.
4. Refresh models or enter a supported model ID manually, then choose **Save & connect** and **Use model**.

Custom providers must expose compatible `/models` and `/chat/completions` endpoints. Custom URLs must use HTTPS, except localhost. Provider access and model availability are controlled by that provider; not every API-compatible service supports all generation options.

API keys are stored in this browser's local storage and sent directly from the app to the selected provider. They are not sent to NovaRole's account API and are not included in workspace sync or portable backup files. Anyone who can access this browser profile can use its saved key. Provider requests include relevant character definitions, lore, persona/memory, and conversation context. Use Ollama if you want generation to stay on-device.

## Optional: run the account API and community catalog locally

This is not required for local use. It starts a development PostgreSQL database and the account/catalog API on your computer.

1. Start Docker Desktop.
2. In the project folder, start PostgreSQL and create the environment file:

   ```powershell
   docker compose up -d postgres
   Copy-Item .env.example .env
   ```

3. Open `.env`. Set `JWT_SECRET` to a new random value of at least 32 characters. Keep `DATABASE_URL` consistent with the PostgreSQL settings in `docker-compose.yml`. The example's database password is only for local development; replace it before any server exposure.
### Start and verify the NovaRole API

After PostgreSQL is running and `.env` is configured, open a **second PowerShell window** in the project folder. Start the API in development mode:

```powershell
npm run api:dev
```

Keep this terminal open while using account or community features. The API reads `.env`, listens on `http://127.0.0.1:3001` by default, and prints startup/errors in this terminal. In another terminal, confirm it can reach PostgreSQL:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/health
```

The response should report `status: ok`. If the request fails, check that PostgreSQL is up with `docker compose ps`, that `DATABASE_URL` and `JWT_SECRET` are set in `.env`, and that port `3001` is available. If you change `.env`, stop and restart both the API and Vite.

For a compiled API run instead of development/watch mode:

```powershell
npm run api:build
npm run api:start
```

`api:start` also needs PostgreSQL running and the same `.env` configuration.

Then start or restart the web app in a separate terminal:

```powershell
npm run dev
```

By default the frontend expects the API at `http://127.0.0.1:3001`; configure `VITE_API_URL` in `.env` if yours is different. Open profile settings to create an account or sign in. The community catalog can be browsed when the API is available; publishing requires an account.

The API listens on `127.0.0.1:3001` by default. `CORS_ORIGINS` in `.env` must include the exact frontend origin you use. Restart Vite and the API after changing environment settings.

The first PostgreSQL initialization automatically runs the SQL files in `api/migrations/`. For a database volume created before the account-workspace migration was added, apply that migration once:

```powershell
Get-Content api\migrations\002_account_workspaces.sql | docker compose exec -T postgres psql -U novarole -d novarole
```

Changing an initialization migration does not automatically re-run it on an existing volume. Back up persistent data before applying migrations or rebuilding the database.

### API overview

- `POST /api/v1/auth/register` and `POST /api/v1/auth/login`
- `GET /api/v1/auth/me` for the current account
- `GET /api/v1/workspace` and `PUT /api/v1/workspace` for private, revision-aware account sync
- `GET /api/v1/characters` and `GET /api/v1/characters/:id` for approved community characters
- `POST /api/v1/characters` to submit a character for review
- Additional routes for views, reports, and moderator actions

New community submissions require moderator approval. Moderator access is currently granted directly in PostgreSQL. The API is self-hosted software, not a hosted NovaRole service. Account workspace payloads are limited to 8 MB.

## Build the desktop app

Install the requirements listed under [Optional desktop app](#optional-desktop-app), then run:

```powershell
npm install
npm run desktop:dev
```

To create a desktop bundle:

```powershell
npm run desktop:build
```

The Tauri window uses the same local workspace and provider configuration as the web app's WebView storage. Ollama, the self-hosted API, and remote AI providers remain separate services that need to be running/configured as applicable.

## Data, privacy, and backups

- **Local workspace:** characters, chats, personas, and profile data are kept in browser/WebView local storage on this device. Clearing site/app data can permanently remove the local copy.
- **Account sync:** signing in merges the local workspace with the private workspace on the API server you configured. The server stores account data and private workspace backups in PostgreSQL. Signing out removes the token from that browser but does not delete the server backup.
- **AI provider:** Ollama runs on your device. A hosted provider receives the context needed to answer your prompt. Provider API keys are kept locally and excluded from account sync and portable backups.
- **Community catalog:** publishing a character is separate from private workspace sync. Published/submitted characters are sent to the configured catalog API and may become visible after approval.
- **Portable backup:** use profile settings to export/import a JSON backup. Import merges records and does not erase the existing workspace. The file includes private story data; store it somewhere secure.

Account tokens are stored in browser local storage and may remain valid for up to 30 days. The current self-hosted API does not include email verification, password recovery, or refresh-token revocation. Rate limits are process-local, so a multi-instance deployment needs a shared rate-limit store. Do not expose the development configuration publicly; change database credentials and secrets, restrict CORS, use HTTPS, and configure database backups before deployment.

## Project scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite web app |
| `npm run build` | Type-check and create the production web build in `dist/` |
| `npm run preview` | Preview the production web build locally |
| `npm run lint` | Run Oxlint |
| `npm test` | Run workspace recovery and backup tests |
| `npm run api:dev` | Start the API with watch/reload |
| `npm run api:build` | Type-check and compile the API |
| `npm run api:start` | Start the compiled API |
| `npm run desktop:dev` | Run the Tauri desktop app in development |
| `npm run desktop:build` | Build Tauri desktop bundles |

## Troubleshooting

- **The app is blank or Vite fails to start:** check `node --version` (Node.js 20+), run `npm install`, and review the terminal for the first error.
- **No AI models appear:** check that Ollama/provider is running, verify the provider and model in profile settings, and refresh. For Ollama browser CORS, see [Connect Ollama](#connect-ollama-local-generation). A model can also be entered manually.
- **Provider key rejected or request fails:** check the provider account, key permissions, model ID, billing/usage limits, and whether the model supports the requested API.
- **Can't sign in or browse the catalog:** confirm Docker/PostgreSQL and the API are running, check `http://127.0.0.1:3001/health`, verify `VITE_API_URL`, and confirm `CORS_ORIGINS` matches the browser origin.
- **Account data is not syncing:** local changes remain on the device; open profile settings and use **Retry sync** when the configured API is available.
- **Changes or chats disappeared:** check the same browser profile/device, and restore a recent portable backup if available. Local browser storage is not a substitute for backups.
- **Desktop build fails:** confirm Rust stable and the platform's Tauri native prerequisites are installed, then retry `npm run desktop:build`.

## Known limitations

There is no hosted NovaRole AI service or guaranteed free/unlimited hosted generation. A public community instance is not included. Native iOS/Android apps, email verification/password recovery, full moderation tooling, public chat sharing/forking, comments/reactions, image/audio/video generation, arbitrary character scripts, compressed PNG metadata, `.charx` archives, and NovaRole-trained models are not implemented.

For the longer-term architecture and deployment proposal, see [docs/architecture.md](docs/architecture.md).
