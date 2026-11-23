# Deploy and Host Prompt Optimizer on Railway

Prompt Optimizer is an open-source web app that rewrites your prompts with an LLM to get clearer, more reliable answers. You can optimize system and user prompts, iterate on them with feedback, and compare the original and optimized prompt side by side. It also ships an MCP server so AI clients can call the same tools.

## About Hosting Prompt Optimizer

This template runs the official Prompt Optimizer 2.16.1 image, pinned by digest, as one service built from a public GitHub repo. nginx serves the web app on a Railway domain behind a login with a generated password, the MCP server answers at `/mcp` behind a generated bearer token, and `/healthz` serves Railway's health check. You only enter one API key for an OpenAI or OpenAI-compatible provider; base URL and model have defaults. Prompts and history stay in each user's browser, and a WebDAV folder on a Railway volume (`/dav`) keeps backups. It uses about 100 MB of RAM, so it fits Railway's 0.5 GB plans.

## Common Use Cases

* Turn rough prompts into structured, detailed prompts for ChatGPT, Claude, Gemini or any other LLM
* Iterate on a system prompt and compare the original and optimized versions on the same model
* Give Claude Desktop, Cursor or other MCP clients prompt-optimization tools over a private, token-protected URL

## Dependencies for Prompt Optimizer Hosting

* An API key for OpenAI or any OpenAI-compatible provider (OpenRouter, DeepSeek, Groq, a self-hosted Ollama or vLLM)
* A Railway volume at `/data` for WebDAV backups (included)

### Deployment Dependencies

* Upstream project: https://github.com/linshenkx/prompt-optimizer
* Template repo: https://github.com/aalfath/prompt-optimizer-railway-template
* OpenAI API keys: https://platform.openai.com/api-keys

### Implementation Details

Services: one service, **Prompt Optimizer** (nginx web app, MCP server at `/mcp`, health check at `/healthz`, WebDAV backups at `/dav`, volume at `/data`).

After deploy, open the Railway domain and log in as `admin` with the `ACCESS_PASSWORD` shown in the service's Variables tab. The "Custom" model is preselected with your key. Anyone who logs in can see the key in their browser, so share the login only with people you trust with it.

Connect an MCP client with the `MCP_AUTH_TOKEN` variable:

```json
{
  "mcpServers": {
    "prompt-optimizer": {
      "url": "https://YOUR-DOMAIN/mcp",
      "headers": { "Authorization": "Bearer YOUR-MCP-TOKEN" }
    }
  }
}
```

To back up data, open the app's data management, choose WebDAV and enter `https://YOUR-DOMAIN/dav` with the same login. Optional extra provider keys (`VITE_OPENAI_API_KEY`, `VITE_GEMINI_API_KEY`, `VITE_ANTHROPIC_API_KEY`, `VITE_DEEPSEEK_API_KEY`, `VITE_OPENROUTER_API_KEY`) can be added as variables. There is no GPU or local model. Updates: when the template repo bumps the pinned version, Railway offers you the update; read the repo's CHANGELOG.md before applying it.

## Why Deploy Prompt Optimizer on Railway?

<!-- Recommended: Keep this section as shown below -->
Railway is a singular platform to deploy your infrastructure stack. Railway will host your infrastructure so you don't have to deal with configuration, while allowing you to vertically and horizontally scale it.

By deploying Prompt Optimizer on Railway, you are one step closer to supporting a complete full-stack application with minimal burden. Host your servers, databases, AI agents, and more on Railway.
<!-- End recommended section -->
