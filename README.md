[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/prompt-optimizer-2?utm_medium=integration&utm_source=button&utm_campaign=prompt-optimizer)

# Prompt Optimizer on Railway

One-click Railway template for [Prompt Optimizer](https://github.com/linshenkx/prompt-optimizer) (linshenkx/prompt-optimizer), an open-source web app that rewrites, iterates and A/B-tests prompts against any LLM, plus its built-in MCP server.

## What it deploys

One service, built from this repo's `Dockerfile`:

- `FROM linshen/prompt-optimizer:2.16.1@sha256:88a59aa626eabbff2f6cf66afe9c055f582338256d2d67e858a49a3a00c6ff8e` (official image, pinned by version and digest)
- a small Node start script (`railway-start.cjs`) that:
  - refuses to start without a login (`ACCESS_PASSWORD`) and an MCP bearer token (`MCP_AUTH_TOKEN`)
  - writes the browser config from the `VITE_*` variables
  - runs nginx on `$PORT`, the upstream MCP server (streamable HTTP, at `/mcp`) and a small helper for `/healthz` and a WebDAV backup folder at `/dav`
  - exits non-zero when any of these stops, so Railway's `ON_FAILURE` restart policy brings the service back
- a volume at `/data` that holds WebDAV backups (`/data/webdav`)

Prompts, history and model settings live in each user's browser (IndexedDB). Use the app's **Data management → WebDAV backup** with the `/dav` endpoint below to keep a copy on the server volume.

It runs well inside 0.5 GB RAM (about 100 MB in use in our tests), so it works on Railway's Free and Trial plans.

## Variables

| Variable | Default | What it does |
|---|---|---|
| `VITE_CUSTOM_API_KEY` | *(you enter it)* | API key for an OpenAI or OpenAI-compatible provider. Required. Get one at https://platform.openai.com/api-keys or from your provider. |
| `VITE_CUSTOM_API_BASE_URL` | `https://api.openai.com/v1` | Base URL of the OpenAI-compatible API (for example OpenRouter, DeepSeek, Groq, a self-hosted Ollama or vLLM). |
| `VITE_CUSTOM_API_MODEL` | `gpt-5.6-luna` | Model name sent to that API. |
| `ACCESS_USERNAME` | `admin` | Login user name for the web app and `/dav`. |
| `ACCESS_PASSWORD` | generated, 24 chars | Login password. |
| `MCP_AUTH_TOKEN` | generated, 40 chars | Bearer token for the MCP server at `/mcp`. |
| `PORT` | `8080` | Port nginx listens on (the Railway domain points here). |

Optional, add them yourself if you need them: `VITE_OPENAI_API_KEY`, `VITE_GEMINI_API_KEY`, `VITE_ANTHROPIC_API_KEY`, `VITE_DEEPSEEK_API_KEY`, `VITE_OPENROUTER_API_KEY` (and the other provider keys upstream supports) preload more model providers.

**Note:** the keys you set here are sent to the browser of anyone who logs in (that is how upstream's web app calls the LLM). Only share the login with people you'd trust with the key. Without a key in Railway, users can still enter their own keys in the browser; the MCP server then stays off.

## After deploy

1. Open the Railway domain and log in as `admin` with the `ACCESS_PASSWORD` from the service's **Variables** tab.
2. The "Custom" model is preselected with your key, base URL and model. Write a prompt and click **Optimize**.
3. MCP clients (Claude Desktop, Cursor, VS Code…) connect to `https://YOUR-DOMAIN/mcp` with the token:

   ```json
   {
     "mcpServers": {
       "prompt-optimizer": {
         "url": "https://YOUR-DOMAIN/mcp",
         "headers": { "Authorization": "Bearer YOUR-MCP_AUTH_TOKEN" }
       }
     }
   }
   ```

   Tools: `optimize-user-prompt`, `optimize-system-prompt`, `iterate-prompt`.
4. Backups: in the app, open data management, choose WebDAV, and enter `https://YOUR-DOMAIN/dav` with the same user name and password.

Health check: `GET /healthz` (no login) answers `200`.

## Updates

This template builds from this GitHub repo. When we bump the pinned image here (one commit to `main`, with a `CHANGELOG.md` entry), Railway shows everyone who deployed the template an "update available" notice, and you choose when to apply it. Read `CHANGELOG.md` first: breaking changes are listed at the top of each entry.

## Not included

- No GPU and no local model: point `VITE_CUSTOM_API_BASE_URL` at an API instead.
- The desktop app and browser extension are separate upstream downloads.

## License

Upstream Prompt Optimizer is licensed under AGPL-3.0. This wrapper only adds deployment files.
