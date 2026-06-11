import express from 'express';
import * as http from 'http';
import * as path from 'path';
import { Server as IOServer } from 'socket.io';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { gameStore } from './gameStore';
import { Direction, GameSettings } from '../shared/types';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'pacmage-admin';
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 10000,
});

// Serve static client files
app.use('/screen', express.static(path.join(__dirname, '../../src/client/screen')));
app.use('/play', express.static(path.join(__dirname, '../../src/client/play')));
app.use('/admin', express.static(path.join(__dirname, '../../src/client/admin')));

// QR code endpoint
app.get('/qr.png', async (req, res) => {
  try {
    const url = `${PUBLIC_URL}/play`;
    const buf = await QRCode.toBuffer(url, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(500).send('QR error');
  }
});

// Redirect root to screen
app.get('/', (req, res) => res.redirect('/screen'));

// Wire game store callbacks
gameStore.setCallbacks({
  onBroadcast: (state) => io.emit('state:update', state),
  onChatEvent: (event) => io.emit('chat:event', event),
  onGameOver: () => io.emit('game:over'),
  onGameWon: () => io.emit('game:won'),
  onLevelTransition: (level) => io.emit('level:transition', level),
});

// Game loop: 15 Hz
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  gameStore.tick(now - lastTick);
  lastTick = now;
}, 1000 / 15);

const adminSockets = new Set<string>();

io.on('connection', (socket) => {
  // Send current state on connect
  socket.emit('state:update', gameStore.getPublicState());

  socket.on('player:join', ({ pseudo }: { pseudo: string }) => {
    const clean = String(pseudo).trim().slice(0, 20).replace(/[<>&"]/g, '');
    if (!clean) return;
    const token = crypto.randomBytes(16).toString('hex');
    gameStore.playerJoin(socket.id, clean, token);
    socket.emit('player:welcome', { id: socket.id, token, mode: 'democracy' });
  });

  socket.on('player:input', ({ dir }: { dir: Direction }) => {
    const validDirs: Direction[] = ['up', 'down', 'left', 'right'];
    if (!validDirs.includes(dir)) return;
    gameStore.playerInput(socket.id, dir);
  });

  socket.on('player:reconnect', ({ token }: { token: string }) => {
    const ok = gameStore.playerReconnect(socket.id, token);
    if (ok) {
      socket.emit('player:welcome', { id: socket.id, token, mode: 'democracy' });
    }
  });

  socket.on('admin:auth', ({ secret }: { secret: string }) => {
    if (secret === ADMIN_SECRET) {
      adminSockets.add(socket.id);
      socket.emit('state:update', gameStore.getPublicState());
    } else {
      socket.emit('admin:error', 'Secret invalide');
    }
  });

  socket.on('admin:start', () => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.start();
  });

  socket.on('admin:pause', () => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.pause();
  });

  socket.on('admin:reset', () => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.reset();
  });

  socket.on('admin:setMode', ({ mode }: { mode: 'democracy' | 'chaos' }) => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.setMode(mode);
  });

  socket.on('admin:setSettings', (data: Partial<GameSettings>) => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.setSettings(data);
  });

  socket.on('admin:kick', ({ playerId }: { playerId: string }) => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.kickPlayer(playerId);
  });

  socket.on('admin:forceLevel', ({ level }: { level: number }) => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.forceLevel(level);
  });

  socket.on('admin:forceNextLevel', () => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.forceNextLevel();
  });

  socket.on('admin:forceGameOver', () => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.forceGameOver();
  });

  socket.on('admin:forceWin', () => {
    if (!adminSockets.has(socket.id)) return;
    gameStore.forceWin();
  });

  socket.on('disconnect', () => {
    adminSockets.delete(socket.id);
    gameStore.playerDisconnect(socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pac-Mage server running on http://0.0.0.0:${PORT}`);
  console.log(`  /screen  → ${PUBLIC_URL}/screen`);
  console.log(`  /play    → ${PUBLIC_URL}/play`);
  console.log(`  /admin   → ${PUBLIC_URL}/admin`);
});

export { server, io };
