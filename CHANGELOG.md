# Changelog

## 2.16.1-railway.1 (2026-11-23)

First release of the Railway template.

- Prompt Optimizer 2.16.1, official image `linshen/prompt-optimizer:2.16.1@sha256:88a59aa626eabbff2f6cf66afe9c055f582338256d2d67e858a49a3a00c6ff8e`.
- Login required on the web app (`ACCESS_PASSWORD`, generated) and a bearer token on `/mcp` (`MCP_AUTH_TOKEN`, generated).
- `/healthz` answers without a login and without an LLM key.
- WebDAV backup folder at `/dav` on the `/data` volume.
- The container exits non-zero when nginx, the MCP server or the helper stops, so Railway restarts it.
