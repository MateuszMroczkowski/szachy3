const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const PAL_COUNT = 15;
const VALID_MODES = new Set(["classic", "big"]);
const ALLOWED_TOTAL_MINUTES = new Set([30, 60, 120, 180]);
const DEFAULT_TOTAL_MINUTES = 120;

function normalizeMode(mode) {
  return VALID_MODES.has(mode) ? mode : "classic";
}

function normalizeTotalMinutes(mins) {
  const n = Number(mins);
  return ALLOWED_TOTAL_MINUTES.has(n) ? n : DEFAULT_TOTAL_MINUTES;
}

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? genCode() : code;
}

function createClockState(now = Date.now(), totalMinutes = DEFAULT_TOTAL_MINUTES) {
  const mins = normalizeTotalMinutes(totalMinutes);
  const perPlayerMs = Math.floor((mins * 60 * 1000) / 3);
  return {
    gameStartAt: now,
    gameElapsedMs: 0,
    totalMinutes: mins,
    perPlayerMs,
    remainingMs: [perPlayerMs, perPlayerMs, perPlayerMs],
    activeTurn: 0,
    lastTickAt: now,
    running: true
  };
}

function syncClocks(room, now = Date.now(), isGameOver = false) {
  if (!room.clock) {
    room.clock = createClockState(now, room.totalMinutes || DEFAULT_TOTAL_MINUTES);
  }
  const clk = room.clock;
  if (!Array.isArray(clk.remainingMs)) {
    const base = clk.perPlayerMs || Math.floor((DEFAULT_TOTAL_MINUTES * 60 * 1000) / 3);
    clk.remainingMs = [base, base, base];
  }
  if (clk.running && typeof clk.lastTickAt === "number") {
    const delta = Math.max(0, now - clk.lastTickAt);
    clk.gameElapsedMs += delta;
    if (
      typeof clk.activeTurn === "number" &&
      clk.activeTurn >= 0 &&
      clk.activeTurn <= 2
    ) {
      clk.remainingMs[clk.activeTurn] = Math.max(0, (clk.remainingMs[clk.activeTurn] || 0) - delta);
    }
  }
  clk.lastTickAt = now;
  if (isGameOver) {
    clk.running = false;
  }
}

function getClockSnapshot(room, now = Date.now()) {
  if (!room.clock) {
    room.clock = createClockState(now, room.totalMinutes || DEFAULT_TOTAL_MINUTES);
  }
  const clk = room.clock;
  const base = clk.perPlayerMs || Math.floor((DEFAULT_TOTAL_MINUTES * 60 * 1000) / 3);
  const remBase = Array.isArray(clk.remainingMs) ? clk.remainingMs : [base, base, base];
  const extra = clk.running && typeof clk.lastTickAt === "number"
    ? Math.max(0, now - clk.lastTickAt)
    : 0;

  const remainingMs = [0, 1, 2].map(idx => {
    const cur = remBase[idx] ?? base;
    return clk.activeTurn === idx && clk.running ? Math.max(0, cur - extra) : Math.max(0, cur);
  });

  return {
    gameElapsedMs: (clk.gameElapsedMs || 0) + extra,
    totalMinutes: clk.totalMinutes || DEFAULT_TOTAL_MINUTES,
    perPlayerMs: base,
    remainingMs,
    activeTurn: clk.activeTurn,
    running: !!clk.running,
    syncedAt: now
  };
}

function getRoomState(room, now = Date.now()) {
  return {
    code: room.code,
    mode: normalizeMode(room.mode),
    totalMinutes: normalizeTotalMinutes(room.totalMinutes),
    hostId: room.hostId,
    seats: room.seats.map(s => (s ? { id: s.id, name: s.name } : null)),
    cols: room.cols,
    mv: room.mv,
    drawOfferBy: room.drawOfferBy,
    isDraw: room.isDraw,
    clock: getClockSnapshot(room, now)
  };
}

io.on("connection", socket => {
  let currentRoom = null;

  socket.on("joinRoom", ({ roomCode, name, preferredSeat, preferredColor, gameMode, totalMinutes }, cb) => {
    const cleanName = (name || "Gracz").trim().slice(0, 18) || "Gracz";
    socket.data.name = cleanName;
    let code = (roomCode || "").trim().toUpperCase();
    let room;
    const now = Date.now();

    if (!code) {
      code = genCode();
      const mins = normalizeTotalMinutes(totalMinutes);
      room = {
        code,
        mode: normalizeMode(gameMode),
        totalMinutes: mins,
        hostId: socket.id,
        seats: [null, null, null],
        cols: [0, 1, 2],
        mv: [],
        drawOfferBy: null,
        isDraw: false,
        clock: createClockState(now, mins)
      };
      rooms.set(code, room);
    } else {
      room = rooms.get(code);
      if (!room) return cb({ error: "Nie znaleziono pokoju o takim kodzie." });
      syncClocks(room, now, !!room.isDraw);
    }

    currentRoom = room;
    socket.join(code);

    let seat = -1;
    if (preferredSeat >= 0 && preferredSeat <= 2 && !room.seats[preferredSeat]) {
      seat = preferredSeat;
    } else {
      seat = room.seats.findIndex(s => s === null);
    }

    if (seat !== -1) {
      room.seats[seat] = { id: socket.id, name: cleanName };
      if (
        typeof preferredColor === "number" &&
        preferredColor >= 0 &&
        preferredColor < PAL_COUNT &&
        !room.cols.includes(preferredColor)
      ) {
        room.cols[seat] = preferredColor;
      }
    }

    const snap = getRoomState(room, now);
    cb({ ok: true, seat, state: snap });
    io.to(code).emit("roomUpdate", snap);
  });

  socket.on("takeSeat", seatIdx => {
    if (!currentRoom || seatIdx < 0 || seatIdx > 2) return;
    if (currentRoom.seats[seatIdx]) return;
    const now = Date.now();
    syncClocks(currentRoom, now, !!currentRoom.isDraw);
    const old = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    const oldName = old !== -1 ? currentRoom.seats[old]?.name : null;
    if (old !== -1) currentRoom.seats[old] = null;
    currentRoom.seats[seatIdx] = { id: socket.id, name: socket.data.name || oldName || "Gracz" };
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("setName", name => {
    socket.data.name = (name || "Gracz").trim().slice(0, 18) || "Gracz";
    if (!currentRoom) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat !== -1) {
      currentRoom.seats[seat].name = socket.data.name;
      const now = Date.now();
      syncClocks(currentRoom, now, !!currentRoom.isDraw);
      io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
    }
  });

  socket.on("changeColor", colIdx => {
    if (!currentRoom || typeof colIdx !== "number" || colIdx < 0 || colIdx >= PAL_COUNT) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (currentRoom.cols.includes(colIdx)) return;
    currentRoom.cols[seat] = colIdx;
    const now = Date.now();
    syncClocks(currentRoom, now, !!currentRoom.isDraw);
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("makeMove", (moveData, nextMeta) => {
    if (!currentRoom || currentRoom.isDraw) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (!Array.isArray(moveData) || moveData.length < 2) return;
    const now = Date.now();
    syncClocks(currentRoom, now, false);
    currentRoom.drawOfferBy = null;
    currentRoom.mv.push([moveData[0], moveData[1], moveData[2] || null]);

    if (nextMeta && typeof nextMeta === "object") {
      if (
        typeof nextMeta.nextTurn === "number" &&
        nextMeta.nextTurn >= 0 &&
        nextMeta.nextTurn <= 2
      ) {
        currentRoom.clock.activeTurn = nextMeta.nextTurn;
      }
      if (nextMeta.gameOver) {
        currentRoom.clock.running = false;
      } else {
        currentRoom.clock.running = true;
      }
    }

    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("offerDraw", () => {
    if (!currentRoom || currentRoom.isDraw) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    const now = Date.now();
    syncClocks(currentRoom, now, false);
    if (currentRoom.drawOfferBy === null) {
      currentRoom.drawOfferBy = seat;
    } else if (currentRoom.drawOfferBy === seat) {
      currentRoom.drawOfferBy = null;
    } else {
      currentRoom.isDraw = true;
      currentRoom.drawOfferBy = null;
      currentRoom.clock.running = false;
    }
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("resetGame", () => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    const now = Date.now();
    currentRoom.mv = [];
    currentRoom.drawOfferBy = null;
    currentRoom.isDraw = false;
    currentRoom.clock = createClockState(now, currentRoom.totalMinutes || DEFAULT_TOTAL_MINUTES);
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const now = Date.now();
    syncClocks(currentRoom, now, !!currentRoom.isDraw);
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat !== -1) currentRoom.seats[seat] = null;
    if (currentRoom.drawOfferBy === seat) currentRoom.drawOfferBy = null;

    if (currentRoom.hostId === socket.id) {
      const next = currentRoom.seats.find(s => s !== null);
      if (next) currentRoom.hostId = next.id;
    }

    if (currentRoom.seats.every(s => s === null)) {
      const code = currentRoom.code;
      setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.seats.every(s => s === null)) rooms.delete(code);
      }, 5 * 60 * 1000);
    } else {
      io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
