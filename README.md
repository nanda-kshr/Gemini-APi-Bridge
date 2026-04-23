# Gemini-APi-Bridge

A lightweight server-side bridge that proxies requests to Google Gemini generative models. It pools and rotates API keys using an LRU strategy, automatically fails over on rate limits, and exposes a single authenticated endpoint for client apps.

## Bridge Endpoint

- Route: `POST /api/prompt`
- Auth header: `X-API-KEY`
- Body:

```json
{
	"systemprompt": "You are a concise assistant",
	"prompt": "Write 3 startup ideas",
	"mode": "free",
	"loop": true
}
```

## MongoDB Collections

### `internal_clients`

```json
{
	"client_name": "Project-Idea-Generator",
	"api_key": "bridge_secret_abc123",
	"status": "active"
}
```

### `gemini_pool`

```json
{
	"key_value": "AIzaSy...",
	"mode": "free",
	"model_name": "gemini-1.5-pro",
	"last_used": "2026-04-23T10:30:00.000Z",
	"is_rate_limited": false,
	"rate_limit_expiry": null
}
```

## Request Processing Logic

1. Validate `X-API-KEY` against `internal_clients` with `status: "active"`.
2. Fetch candidate keys from `gemini_pool` by `mode`.
3. Apply LRU ordering using `sort({ last_used: 1, _id: 1 })`.
4. Exclude currently rate-limited keys unless `rate_limit_expiry` has passed.
5. If `loop=true`, fail over across keys on `429`.
6. If `loop=false`, only the first LRU key is attempted.
7. On success, return `{ content, model }` and update `last_used`.
8. On `429`, set `is_rate_limited=true` and future `rate_limit_expiry`.

## Database Indexes (Auto-created)

- `internal_clients.api_key` (unique)
- `gemini_pool.mode + is_rate_limited + rate_limit_expiry + last_used`
- `gemini_pool.mode + last_used`

## Quick Test

```bash
curl -X POST http://localhost:3000/api/prompt \
	-H "Content-Type: application/json" \
	-H "X-API-KEY: bridge_secret_abc123" \
	-d '{
		"systemprompt": "Be direct",
		"prompt": "Generate one product idea",
		"mode": "free",
		"loop": true
	}'
```
