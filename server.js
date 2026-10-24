#!/usr/bin/env node
/* EDGE COIN online relay — zero dependency.
 * Static server + 8-slot room API (SSE + POST).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8130;
const COINS = ['gold', 'red', 'cyan', 'violet', 'rose', 'moss', 'azure', 'amber', 'echo', 'curve', 'anchor'];
const PERSONALITIES = ['greedy', 'steady', 'rage', 'lazy', 'random', 'smart', 'blackdog', 'meow'];
const MAX_SLOTS = 8;
const ROOM_TTL_MS = 30 * 60 * 1000;
const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function cleanName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim();
  return name.slice(0, 16) || '玩家';
}

function cleanCoin(value) {
  return COINS.includes(value) ? value : null;
}

function cleanPersonalityPool(value) {
  const selected = Array.isArray(value)
    ? PERSONALITIES.filter((id) => value.includes(id))
    : PERSONALITIES.slice();
  return selected.length ? selected : PERSONALITIES.slice();
}

function cleanMode(value) {
  return value === 'volley' ? 'volley' : 'turn';
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i += 1) code += alphabet[bytes[i] % alphabet.length];
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function lanAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  const virtual = /vEthernet|WSL|Docker|VirtualBox|VMware|Hyper-V|Loopback|Tailscale/i;
  for (const [name, list] of Object.entries(interfaces)) {
    if (virtual.test(name)) continue;
    for (const iface of list || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('169.254.')) continue;
      addresses.push(iface.address);
    }
  }
  const score = (ip) => {
    if (ip.startsWith('10.')) return 0;
    if (ip.startsWith('192.168.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };
  return [...new Set(addresses)].sort((a, b) => score(a) - score(b));
}

function makeHost(name, coin) {
  return {
    index: 0,
    type: 'host',
    name: cleanName(name),
    coin: cleanCoin(coin) || 'gold',
    token: makeToken(),
    connected: false,
    res: null,
  };
}

function tokenSlots(room) {
  return room.slots.filter((slot) => slot && slot.token);
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    mode: room.mode,
    size: MAX_SLOTS,
    arena: room.arena || null,
    personalityPool: room.personalityPool || PERSONALITIES.slice(),
    slots: room.slots.map((slot) => slot ? {
      index: slot.index,
      type: slot.type,
      name: slot.name,
      coin: slot.coin,
      connected: slot.type === 'ai' ? true : !!slot.connected,
    } : null),
  };
}

function slotForToken(room, token) {
  if (!room || !token) return null;
  return room.slots.find((slot) => slot && slot.token === token) || null;
}

function hostSlot(room) {
  return room.slots.find((slot) => slot && slot.type === 'host') || null;
}

function usedCoins(room) {
  return new Set(room.slots.filter(Boolean).map((slot) => slot.coin));
}

function firstFreeCoin(room, preferred) {
  if (preferred && !usedCoins(room).has(preferred)) return preferred;
  return COINS.find((coin) => !usedCoins(room).has(coin)) || null;
}

function nextEmptyIndex(room) {
  for (let i = 0; i < MAX_SLOTS; i += 1) {
    if (!room.slots[i]) return i;
  }
  return -1;
}

function sendEvent(slot, data) {
  if (!slot || !slot.res) return false;
  try {
    slot.res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (error) {
    return false;
  }
}

function broadcast(room, data, exceptToken = null) {
  for (const slot of tokenSlots(room)) {
    if (exceptToken && slot.token === exceptToken) continue;
    sendEvent(slot, data);
  }
}

function broadcastRoom(room, exceptToken = null) {
  broadcast(room, { type: 'room-updated', room: publicRoom(room) }, exceptToken);
}

function sendToHost(room, data) {
  const host = hostSlot(room);
  if (host) sendEvent(host, data);
}

function closeSlot(slot) {
  if (!slot) return;
  slot.connected = false;
  if (slot.res) {
    try { slot.res.end(); } catch (error) { /* ignore */ }
    slot.res = null;
  }
}

function removeRoom(room, reason) {
  if (!room || !rooms.has(room.code)) return;
  rooms.delete(room.code);
  for (const slot of tokenSlots(room)) {
    sendEvent(slot, { type: 'room-closed', reason: reason || 'closed' });
    closeSlot(slot);
  }
}

function touch(room) {
  room.lastActivity = Date.now();
}

function removeGuestSlot(room, slot) {
  if (!room || !slot || slot.type !== 'guest') return;
  room.slots[slot.index] = null;
  touch(room);
  broadcastRoom(room);
  if (room.phase === 'playing') {
    broadcast(room, {
      type: 'player-left',
      slot: { index: slot.index, name: slot.name, coin: slot.coin },
    });
  }
}

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    res.writeHead(400);
    res.end('Bad path');
    return;
  }
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  const filePath = path.resolve(ROOT, `.${decoded}`);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-store' : 'public, max-age=3600',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function handleEvents(req, res, url) {
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  const token = String(url.searchParams.get('token') || '');
  const room = rooms.get(code);
  const slot = slotForToken(room, token);
  if (!room || !slot) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Room not found');
    return;
  }
  if (slot.res) closeSlot(slot);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  slot.res = res;
  slot.connected = true;
  touch(room);
  sendEvent(slot, {
    type: 'hello',
    role: slot.type,
    slot: slot.index,
    room: publicRoom(room),
    lastSnapshot: slot.type === 'guest' ? room.lastSnapshot || null : null,
  });
  broadcast(room, {
    type: 'peer-connected',
    slot: { index: slot.index, type: slot.type, name: slot.name },
    room: publicRoom(room),
  }, token);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (error) { clearInterval(heartbeat); }
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    if (slot.res !== res) return;
    slot.res = null;
    slot.connected = false;
    if (!rooms.has(room.code)) return;
    if (slot.type === 'host') {
      removeRoom(room, 'host-left');
      return;
    }
    removeGuestSlot(room, slot);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

async function handleAction(req, res, url) {
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  const token = String(url.searchParams.get('token') || '');
  const room = rooms.get(code);
  const slot = slotForToken(room, token);
  if (!room || !slot) {
    sendJson(res, 404, { error: 'room-not-found' });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid-body' });
    return;
  }
  const type = String(body.type || '');
  touch(room);
  if (type === 'ping') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (type === 'leave') {
    if (slot.type === 'host') removeRoom(room, 'left');
    else removeGuestSlot(room, slot);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (type === 'coin') {
    const coin = cleanCoin(body.coin);
    if (!coin) {
      sendJson(res, 400, { error: 'invalid-coin' });
      return;
    }
    const index = body.index === undefined || body.index === null
      ? slot.index
      : Number(body.index);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_SLOTS) {
      sendJson(res, 400, { error: 'slot-not-found' });
      return;
    }
    const target = room.slots[index];
    if (!target) {
      sendJson(res, 404, { error: 'slot-not-found' });
      return;
    }
    const isSelf = target.token && target.token === token;
    const isHostAI = slot.type === 'host' && target.type === 'ai';
    if (!isSelf && !isHostAI) {
      sendJson(res, 403, { error: 'not-your-slot' });
      return;
    }
    const taken = room.slots.some((item, itemIndex) => item && itemIndex !== index && item.coin === coin);
    if (taken) {
      sendJson(res, 409, { error: 'coin-taken' });
      return;
    }
    target.coin = coin;
    broadcastRoom(room);
    sendJson(res, 200, { ok: true, coin, index, room: publicRoom(room) });
    return;
  }
  if (slot.type === 'host' && type === 'setting') {
    if (body.mode === 'turn' || body.mode === 'volley') room.mode = body.mode;
    if (body.arena && typeof body.arena === 'object') room.arena = body.arena;
    if (Array.isArray(body.personalityPool)) {
      room.personalityPool = cleanPersonalityPool(body.personalityPool);
    }
    broadcastRoom(room);
    sendJson(res, 200, {
      ok: true,
      mode: room.mode,
      arena: room.arena,
      personalityPool: room.personalityPool,
    });
    return;
  }
  if (slot.type === 'host' && type === 'ai') {
    const action = String(body.action || '');
    if (action === 'fill') {
      let index = nextEmptyIndex(room);
      while (index !== -1) {
        const coin = firstFreeCoin(room);
        if (!coin) break;
        room.slots[index] = {
          index,
          type: 'ai',
          name: `AI ${index + 1}`,
          coin,
          token: null,
          connected: true,
          res: null,
        };
        index = nextEmptyIndex(room);
      }
    } else {
      const index = Math.max(0, Math.min(MAX_SLOTS - 1, Number(body.index)));
      if (index === 0) {
        sendJson(res, 400, { error: 'host-slot' });
        return;
      }
      if (action === 'add') {
        if (room.slots[index]) {
          sendJson(res, 409, { error: 'slot-occupied' });
          return;
        }
        const coin = firstFreeCoin(room);
        if (!coin) {
          sendJson(res, 409, { error: 'coins-full' });
          return;
        }
        room.slots[index] = {
          index,
          type: 'ai',
          name: `AI ${index + 1}`,
          coin,
          token: null,
          connected: true,
          res: null,
        };
      } else if (action === 'remove') {
        if (!room.slots[index] || room.slots[index].type !== 'ai') {
          sendJson(res, 400, { error: 'not-ai' });
          return;
        }
        room.slots[index] = null;
      } else {
        sendJson(res, 400, { error: 'unknown-ai-action' });
        return;
      }
    }
    broadcastRoom(room);
    sendJson(res, 200, { ok: true, room: publicRoom(room) });
    return;
  }
  if (slot.type === 'host' && type === 'start') {
    room.phase = 'playing';
    room.mode = cleanMode(body.config && body.config.mode ? body.config.mode : room.mode);
    if (body.config && body.config.arena && typeof body.config.arena === 'object') {
      room.arena = body.config.arena;
    }
    room.config = body.config || null;
    room.lastSnapshot = null;
    for (const guest of tokenSlots(room)) {
      if (guest.type !== 'guest') continue;
      sendEvent(guest, {
        type: 'start',
        config: room.config,
        room: publicRoom(room),
      });
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  if (slot.type === 'host' && type === 'reset-room') {
    room.phase = 'result';
    room.lastSnapshot = null;
    room.config = null;
    if (body.arena && typeof body.arena === 'object') room.arena = body.arena;
    if (body.mode === 'turn' || body.mode === 'volley') room.mode = body.mode;
    broadcast(room, {
      type: 'room-reset',
      room: publicRoom(room),
    });
    sendJson(res, 200, { ok: true, room: publicRoom(room) });
    return;
  }
  if (slot.type === 'host' && type === 'return-room') {
    if (room.phase !== 'result') {
      sendJson(res, 200, { ok: true, ignored: true, room: publicRoom(room) });
      return;
    }
    room.phase = 'lobby';
    room.lastSnapshot = null;
    broadcastRoom(room);
    sendJson(res, 200, { ok: true, room: publicRoom(room) });
    return;
  }
  if (slot.type === 'guest' && (type === 'shot' || type === 'lock' || type === 'skill' || type === 'curve')) {
    if (room.phase !== 'playing') {
      sendJson(res, 403, { error: 'not-playing' });
      return;
    }
    const forward = {
      type,
      slot: slot.index,
      name: slot.name,
      coin: slot.coin,
    };
    if (type === 'shot' || type === 'lock') {
      forward.angle = Number(body.angle) || 0;
      forward.power = Math.max(0, Math.min(1, Number(body.power) || 0));
    } else if (type === 'curve') {
      forward.right = !!body.right;
      forward.left = !!body.left;
    } else {
      forward.action = body.action === 'recall' ? 'recall'
        : (body.action === 'anchor' ? 'anchor' : 'mark');
    }
    sendToHost(room, forward);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (slot.type === 'host' && type === 'snapshot') {
    if (room.phase !== 'playing') {
      sendJson(res, 403, { error: 'not-playing' });
      return;
    }
    room.lastSnapshot = body.snapshot || null;
    for (const guest of tokenSlots(room)) {
      if (guest.type !== 'guest') continue;
      sendEvent(guest, { type: 'snapshot', snapshot: room.lastSnapshot });
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  if (slot.type === 'host' && type === 'result') {
    for (const guest of tokenSlots(room)) {
      if (guest.type !== 'guest') continue;
      sendEvent(guest, {
        type: 'result',
        result: body.result || 'defeat',
        winnerId: body.winnerId || null,
        stats: body.stats || null,
      });
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  if (slot.type === 'host' && type === 'rematch') {
    room.phase = 'playing';
    room.mode = cleanMode(body.config && body.config.mode ? body.config.mode : room.mode);
    if (body.config && body.config.arena && typeof body.config.arena === 'object') {
      room.arena = body.config.arena;
    }
    room.lastSnapshot = null;
    room.config = body.config || room.config;
    for (const guest of tokenSlots(room)) {
      if (guest.type !== 'guest') continue;
      sendEvent(guest, {
        type: 'rematch',
        config: room.config,
      });
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 400, { error: 'unknown-action' });
}

async function handleJoin(req, res, code) {
  const room = rooms.get(code);
  if (!room) {
    sendJson(res, 404, { error: 'room-not-found' });
    return;
  }
  if (room.phase !== 'lobby') {
    sendJson(res, 409, { error: 'already-started' });
    return;
  }
  const index = nextEmptyIndex(room);
  if (index === -1) {
    sendJson(res, 409, { error: 'room-full' });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid-body' });
    return;
  }
  const preferred = cleanCoin(body.coin);
  const coin = firstFreeCoin(room, preferred);
  if (!coin) {
    sendJson(res, 409, { error: 'room-full' });
    return;
  }
  const guest = {
    index,
    type: 'guest',
    name: cleanName(body.name),
    coin,
    token: makeToken(),
    connected: false,
    res: null,
  };
  room.slots[index] = guest;
  touch(room);
  broadcast(room, {
    type: 'room-updated',
    room: publicRoom(room),
  }, guest.token);
  sendJson(res, 200, {
    token: guest.token,
    role: 'guest',
    slot: index,
    assignedCoin: coin,
    coinAdjusted: !!(preferred && preferred !== coin),
    room: publicRoom(room),
  });
}

async function handleCreate(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid-body' });
    return;
  }
  if (rooms.size >= 500) {
    sendJson(res, 503, { error: 'server-busy' });
    return;
  }
  const code = makeCode();
  const host = makeHost(body.name, body.coin);
  const room = {
    code,
    phase: 'lobby',
    mode: cleanMode(body.mode),
    arena: body.arena || null,
    personalityPool: cleanPersonalityPool(body.personalityPool),
    slots: new Array(MAX_SLOTS).fill(null),
    config: null,
    lastSnapshot: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  room.slots[0] = host;
  rooms.set(code, room);
  sendJson(res, 200, {
    code,
    token: host.token,
    role: 'host',
    slot: 0,
    room: publicRoom(room),
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (error) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const pathname = url.pathname;
  if (pathname === '/api/info' && req.method === 'GET') {
    sendJson(res, 200, {
      port: PORT,
      lan: lanAddresses(),
      host: os.hostname(),
    });
    return;
  }
  if (pathname === '/api/rooms' && req.method === 'POST') {
    handleCreate(req, res).catch(() => sendJson(res, 500, { error: 'server-error' }));
    return;
  }
  const joinMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]{4,8})\/join$/i);
  if (joinMatch && req.method === 'POST') {
    handleJoin(req, res, joinMatch[1].toUpperCase()).catch(() => sendJson(res, 500, { error: 'server-error' }));
    return;
  }
  const actionMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]{4,8})\/action$/i);
  if (actionMatch && req.method === 'POST') {
    const actionUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    actionUrl.searchParams.set('code', actionMatch[1].toUpperCase());
    handleAction(req, res, actionUrl).catch(() => sendJson(res, 500, { error: 'server-error' }));
    return;
  }
  if (pathname === '/api/events' && req.method === 'GET') {
    handleEvents(req, res, url);
    return;
  }
  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'not-found' });
    return;
  }
  serveStatic(req, res, pathname);
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyConnected = tokenSlots(room).some((slot) => slot.connected);
    if (now - room.lastActivity > ROOM_TTL_MS || (!anyConnected && now - room.lastActivity > 3 * 60 * 1000)) {
      removeRoom(room, 'expired');
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`EDGE COIN online server: http://127.0.0.1:${PORT}/`);
  console.log(`Static root: ${ROOT}`);
});
