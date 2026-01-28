---
name: ngrok-unofficial-webhook-skill
description: Start an ngrok tunnel to receive incoming webhooks and process them via the LLM. Use when the user asks to listen for webhooks, set up a webhook endpoint, start ngrok, or when another skill (like Zoom RTMS Meeting Assistant) needs a public webhook URL. Receives webhook payloads and lets the LLM decide how to handle them.
---

# Ngrok Webhook Listener

Start a public webhook endpoint via ngrok. Incoming webhooks are output as JSON lines — read them and decide what to do (e.g. forward to another skill like the Zoom RTMS Meeting Assistant).

## Prerequisites

```bash
cd skills/ngrok-unofficial-webhook-skill
npm install
```

## Environment Variables

Set `NGROK_AUTHTOKEN` in the skill's `.env` file (copy from `.env.example`).

- `NGROK_AUTHTOKEN` — **(required)** ngrok auth token from https://dashboard.ngrok.com
- `NGROK_DOMAIN` — (optional) stable ngrok domain for consistent URLs
- `WEBHOOK_PORT` — (optional) local port, default `4040`
- `WEBHOOK_PATH` — (optional) webhook path, default `/webhook`

## Usage

### Start the webhook listener

Run as a **background process**:

```bash
cd skills/ngrok-unofficial-webhook-skill
node scripts/webhook-server.js
```

The server prints its public URL to stderr:
```
NGROK_URL=https://xxxx.ngrok-free.app
Webhook endpoint: https://xxxx.ngrok-free.app/webhook
```

Capture the `NGROK_URL` from stderr output to configure external services.

### Reading webhook events

The server writes each incoming webhook as a JSON line to **stdout**. Each event contains:

```json
{
  "id": "uuid",
  "timestamp": "ISO-8601",
  "method": "POST",
  "path": "/webhook",
  "headers": {},
  "query": {},
  "body": {}
}
```

Poll stdout of the background process to read incoming webhooks.

### Processing webhooks

When a webhook arrives:

1. Read the event from the process stdout
2. Inspect `body` to determine the event type
3. Route to the appropriate handler:
   - **Zoom RTMS** (`event: "meeting.rtms_started"`) → Start the Zoom RTMS Meeting Assistant skill
   - **Other events** → Ask the user what to do

### Health check

```bash
curl http://localhost:4040/health
```

### Stop the listener

Kill the background process when done.

## Integration with Zoom RTMS

Typical flow:
1. Start this webhook listener → get ngrok URL
2. Configure the ngrok URL in your Zoom Marketplace app's webhook settings
3. When a meeting starts, Zoom sends `meeting.rtms_started` to the webhook
4. Read the event, then start the RTMS Meeting Assistant with the payload
