#!/usr/bin/env node
// Ngrok webhook listener — starts an Express server behind an ngrok tunnel
// and writes incoming webhook payloads to stdout as JSON lines for the LLM to process.

import express from 'express';
import ngrok from '@ngrok/ngrok';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load .env from the skill's root directory
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const PORT = parseInt(process.env.WEBHOOK_PORT || '4040');
const NGROK_AUTHTOKEN = process.env.NGROK_AUTHTOKEN;
const NGROK_DOMAIN = process.env.NGROK_DOMAIN || '';
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';

if (!NGROK_AUTHTOKEN) {
  console.error('ERROR: NGROK_AUTHTOKEN is required. Set it in .env or environment.');
  process.exit(1);
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
    headers: req.headers,
    query: req.query,
    body: req.body || null,
  };

  // Write to stdout as a JSON line for the LLM to consume
  process.stdout.write(JSON.stringify(event) + '\n');

  // Respond 200 OK immediately
  res.status(200).json({ status: 'received', id: event.id });
});

// Catch-all for other paths — still log them
app.all('*', (req, res) => {
  const event = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    headers: req.headers,
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
    // Print the public URL to stderr so it doesn't mix with JSON event lines
    console.error(`NGROK_URL=${url}`);
    console.error(`Webhook endpoint: ${url}${WEBHOOK_PATH}`);
    console.error(`Listening on port ${PORT}`);
  } catch (err) {
    console.error('Failed to start ngrok tunnel:', err.message);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
