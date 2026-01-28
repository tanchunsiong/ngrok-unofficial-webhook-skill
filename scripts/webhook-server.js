#!/usr/bin/env node
// Ngrok webhook listener — starts an Express server behind an ngrok tunnel.
// Incoming webhooks are forwarded to the Clawdbot agent for the LLM to decide what to do.

import express from 'express';
import ngrok from '@ngrok/ngrok';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, readFileSync, existsSync } from 'fs';

// Load .env from the skill's root directory
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const PORT = parseInt(process.env.WEBHOOK_PORT || '4040');
const NGROK_AUTHTOKEN = process.env.NGROK_AUTHTOKEN;
const NGROK_DOMAIN = process.env.NGROK_DOMAIN || '';
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';
const CLAWDBOT_BIN = process.env.CLAWDBOT_BIN || 'clawdbot';
const NOTIFY_CHANNEL = process.env.CLAWDBOT_NOTIFY_CHANNEL || 'whatsapp';
const NOTIFY_TARGET = process.env.CLAWDBOT_NOTIFY_TARGET || '';

if (!NGROK_AUTHTOKEN) {
  console.error('ERROR: NGROK_AUTHTOKEN is required. Set it in .env or environment.');
  process.exit(1);
}

/**
 * Send a message to the user via Clawdbot CLI.
 */
function notifyUser(message) {
  if (!NOTIFY_TARGET) {
    console.error('⚠️ CLAWDBOT_NOTIFY_TARGET not set — skipping notification.');
    return;
  }
  const args = ['message', 'send', '--channel', NOTIFY_CHANNEL, '--target', NOTIFY_TARGET, '--message', message];
  execFile(CLAWDBOT_BIN, args, { timeout: 30000 }, (err) => {
    if (err) {
      console.error('❌ Failed to notify user:', err.message);
    } else {
      console.error('✅ User notified');
    }
  });
}

/**
 * Discover installed skills from the skills directory.
 * Returns array of { name, description, path }.
 */
function discoverSkills() {
  const skillsDir = join(__dirname, '..', '..');
  const skills = [];
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip ourselves
      if (entry.name === 'ngrok-unofficial-webhook-skill') continue;

      const skillMd = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillMd)) continue;

      // Parse frontmatter for name and description
      const content = readFileSync(skillMd, 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let name = entry.name;
      let description = '';
      if (fmMatch) {
        const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
        const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m);
        if (nameMatch) name = nameMatch[1].trim();
        if (descMatch) description = descMatch[1].trim();
      }
      skills.push({ name, description, folder: entry.name });
    }
  } catch (err) {
    console.error('⚠️ Failed to discover skills:', err.message);
  }
  return skills;
}

/**
 * Build a human-readable summary of the webhook for the user.
 */
function formatWebhookMessage(event) {
  const body = event.body || {};
  const eventType = body.event || body.type || body.action || 'unknown';
  const bodyPreview = JSON.stringify(body, null, 2).slice(0, 1000);

  const skills = discoverSkills();
  let skillList = skills
    .map((s, i) => `${i + 1}. *${s.name}* — ${s.description.slice(0, 80)}${s.description.length > 80 ? '…' : ''}`)
    .join('\n');

  if (!skillList) {
    skillList = '_(no skills with SKILL.md found)_';
  }

  return `🔗 *Incoming Webhook Received*

*Event:* ${eventType}
*Method:* ${event.method}
*Time:* ${event.timestamp}

*Payload:*
\`\`\`
${bodyPreview}
\`\`\`

*Available skills to handle this:*
${skillList}
${skills.length > 0 ? `\n0. Ignore / do nothing` : ''}

Reply with a number or tell me how to handle it.`;
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Webhook receiver — accepts any method
app.all(WEBHOOK_PATH, (req, res) => {
  const event = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body || null,
  };

  // Write to stdout as a JSON line (for process polling)
  process.stdout.write(JSON.stringify(event) + '\n');

  // Notify the user via Clawdbot
  const message = formatWebhookMessage(event);
  notifyUser(message);

  // Respond 200 OK immediately
  res.status(200).json({ status: 'received', id: event.id });
});

// Catch-all for other paths — log but don't notify (avoids noise from bots/crawlers)
app.all('*', (req, res) => {
  const event = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body || null,
    note: 'non-webhook-path',
  };
  process.stdout.write(JSON.stringify(event) + '\n');
  res.status(200).json({ status: 'received', id: event.id });
});

// Start server and ngrok tunnel
const server = app.listen(PORT, async () => {
  try {
    const listenerOpts = {
      addr: PORT,
      authtoken: NGROK_AUTHTOKEN,
    };
    if (NGROK_DOMAIN) {
      listenerOpts.domain = NGROK_DOMAIN;
    }
    const listener = await ngrok.forward(listenerOpts);
    const url = listener.url();
    console.error(`NGROK_URL=${url}`);
    console.error(`Webhook endpoint: ${url}${WEBHOOK_PATH}`);
    console.error(`Listening on port ${PORT}`);

    // Notify user that the webhook listener is ready
    notifyUser(`⚡ Ngrok webhook listener started!\n\n*URL:* ${url}${WEBHOOK_PATH}\n\nI'll notify you when webhooks come in and ask how to handle them.`);
  } catch (err) {
    console.error('Failed to start ngrok tunnel:', err.message);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
