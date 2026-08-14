'use strict';

/**
 * VELOCITY RUSH — relay server
 * --------------------------------
 * Serves the game (laptop screen) and the controller pages (phones), and
 * relays joystick input between them.
 *
 * Transports:
 *   1. WebSocket  -> /ws?role=screen|controller   (preferred)
 *   2. SSE + POST -> /api/join, /api/events, /api/send  (fallback if a
 *                    proxy blocks WebSocket upgrades)
 *
 * Protocol (JSON messages):
 *   controller -> server : {type:'input', steer, throttle, brake, handbrake}
 *                          {type:'button', action:'cam'|'reset'|'horn', pressed}
 *                          {type:'ping'}
 *   server -> screens    : input/button messages tagged with `slot` (1|2),
 *                          {type:'controller-joined'|'controller-left', slot}
 *   screen -> server     : {type:'telemetry', slot, data:{...}}  -> routed to
 *                          the controller holding that slot.
 */

const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// friendly aliases used by the QR code / shared links
app.get(['/controller', '/join', '/phone'], (req, res) => res.redirect('/controller.html'));
app.get(['/game', '/screen'], (req, res) => res.redirect('/'));

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---------------------------------------------------------------------------
// Logical client registry (shared by both transports)
// ---------------------------------------------------------------------------

let nextId = 1;
const clients = new Map(); // id -> { id, role, slot, transport, ws?, res?, queue? }

function sendTo(client, msg) {
  const data = JSON.stringify(msg);
  try {
    if (client.transport === 'ws') {
      if (client.ws && client.ws.readyState === 1) client.ws.send(data);
    } else if (client.transport === 'sse') {
      if (client.res) {
        client.res.write(`data: ${data}\n\n`);
      } else {
        client.queue = client.queue || [];
        if (client.queue.length < 64) client.queue.push(data);
      }
    }
  } catch (e) { /* drop */ }
}

function broadcastToRole(role, msg, exceptId) {
  for (const c of clients.values()) {
    if (c.role === role && c.id !== exceptId) sendTo(c, msg);
  }
}

function connectedSlots() {
  const slots = [];
  for (const c of clients.values()) {
    if (c.role === 'controller' && c.slot) slots.push(c.slot);
  }
  return slots;
}

function freeSlot() {
  const used = new Set(connectedSlots());
  if (!used.has(1)) return 1;
  if (!used.has(2)) return 2;
  return 0;
}

function addClient(role, transport, handle) {
  const client = Object.assign({ id: nextId++, role, slot: null, transport }, handle);

  if (role === 'controller') {
    const slot = freeSlot();
    if (!slot) {
      clients.set(client.id, client);
      sendTo(client, { type: 'full' });
      setTimeout(() => removeClient(client.id), 1000);
      return client;
    }
    client.slot = slot;
  }

  clients.set(client.id, client);

  if (role === 'controller') {
    sendTo(client, { type: 'welcome', role, slot: client.slot });
    broadcastToRole('screen', { type: 'controller-joined', slot: client.slot });
  } else {
    sendTo(client, { type: 'welcome', role, controllers: connectedSlots() });
  }
  return client;
}

function removeClient(id) {
  const c = clients.get(id);
  if (!c) return;
  clients.delete(id);
  if (c.role === 'controller' && c.slot) {
    broadcastToRole('screen', { type: 'controller-left', slot: c.slot });
  }
  if (c.transport === 'ws' && c.ws) { try { c.ws.close(); } catch (e) {} }
  if (c.transport === 'sse' && c.res) { try { c.res.end(); } catch (e) {} }
}

function handleClientMessage(client, msg) {
  if (!msg || typeof msg !== 'object' || !msg.type) return;
  switch (msg.type) {
    case 'input':
    case 'button':
      if (client.role === 'controller' && client.slot) {
        broadcastToRole('screen', { type: msg.type, slot: client.slot,
          steer: msg.steer, throttle: msg.throttle, brake: msg.brake,
          handbrake: !!msg.handbrake, nitro: !!msg.nitro,
          action: msg.action, pressed: msg.pressed });
      }
      break;
    case 'telemetry':
      if (client.role === 'screen' && msg.slot) {
        for (const c of clients.values()) {
          if (c.role === 'controller' && c.slot === msg.slot) {
            sendTo(c, { type: 'telemetry', data: msg.data });
          }
        }
      }
      break;
    case 'ping':
      sendTo(client, { type: 'pong' });
      break;
  }
}

// ---------------------------------------------------------------------------
// WebSocket transport
// ---------------------------------------------------------------------------

wss.on('connection', (ws, req) => {
  let role = 'screen';
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('role') === 'controller') role = 'controller';
  } catch (e) {}
  const client = addClient(role, 'ws', { ws });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    handleClientMessage(client, msg);
  });
  ws.on('close', () => removeClient(client.id));
  ws.on('error', () => removeClient(client.id));
});

// ---------------------------------------------------------------------------
// SSE + POST fallback transport
// ---------------------------------------------------------------------------

app.post('/api/join', (req, res) => {
  const role = (req.body && req.body.role === 'controller') ? 'controller' : 'screen';
  const client = addClient(role, 'sse', {});
  res.json({ id: client.id, role: client.role, slot: client.slot });
});

app.get('/api/events', (req, res) => {
  const id = parseInt(req.query.id, 10);
  const client = clients.get(id);

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');

  if (!client || client.transport !== 'sse') {
    res.write(`data: ${JSON.stringify({ type: 'rejoin' })}\n\n`);
    res.end();
    return;
  }

  client.res = res;
  if (client.queue && client.queue.length) {
    for (const data of client.queue) res.write(`data: ${data}\n\n`);
    client.queue.length = 0;
  }

  const keepalive = setInterval(() => { try { res.write(':ka\n\n'); } catch (e) {} }, 15000);
  req.on('close', () => {
    clearInterval(keepalive);
    if (clients.get(id) === client) removeClient(id);
  });
});

app.post('/api/send', (req, res) => {
  const id = parseInt(req.query.id, 10);
  const client = clients.get(id);
  if (!client || client.transport !== 'sse') {
    return res.status(410).json({ error: 'unknown client, rejoin required' });
  }
  handleClientMessage(client, req.body || {});
  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, clients: clients.size, slots: connectedSlots() });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[velocity-rush] listening on http://0.0.0.0:${PORT}`);
});
