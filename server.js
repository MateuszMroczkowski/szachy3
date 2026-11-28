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
const VALID_MODES = new Set(["classic", "big", "monopoly"]);
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

function createClockState(now = Date.now(), totalMinutes = DEFAULT_TOTAL_MINUTES, started = false) {
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
    running: !!started
  };
}

function createMonopolyState(playerCount = 4) {
  const cnt = Math.max(2, Math.min(4, Number(playerCount) || 4));
  return {
    playerCount: cnt,
    positions: [0, 0, 0, 0],
    turn: 0,
    dice: [1, 1],
    rollSeq: 0,
    lastRollAt: 0,
    soloActiveSeat: 0
  };
}

function seatCountForMode(mode, room) {
  if (mode === "monopoly") {
    return room.monopoly?.playerCount || 4;
  }
  return 3;
}

function hasFullLobby(room) {
  const maxSeats = seatCountForMode(normalizeMode(room.mode), room);
  const activeSeats = room.seats.slice(0, maxSeats).filter(Boolean).length;
  return activeSeats >= maxSeats;
}

function maybeAutoStartClock(room, now = Date.now()) {
  if (normalizeMode(room.mode) === "monopoly") {
    if (room.clock) room.clock.running = false;
    return;
  }
  if (!room.clock) {
    room.clock = createClockState(now, room.totalMinutes || DEFAULT_TOTAL_MINUTES, false);
  }
  if (!room.isDraw && !room.gameOver && !room.clock.running && hasFullLobby(room)) {
    room.clock.running = true;
    room.clock.lastTickAt = now;
  }
}

function syncClocks(room, now = Date.now(), isGameOver = false) {
  if (!room.clock) {
    room.clock = createClockState(now, room.totalMinutes || DEFAULT_TOTAL_MINUTES, false);
  }
  const clk = room.clock;
  if (!Array.isArray(clk.remainingMs)) {
    const base = clk.perPlayerMs || Math.floor((DEFAULT_TOTAL_MINUTES * 60 * 1000) / 3);
    clk.remainingMs = [base, base, base];
  }
  if (clk.running && typeof clk.lastTickAt === "number" && normalizeMode(room.mode) !== "monopoly") {
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
    room.gameOver = true;
  }
}

function getClockSnapshot(room, now = Date.now()) {
  if (!room.clock) {
    room.clock = createClockState(now, room.totalMinutes || DEFAULT_TOTAL_MINUTES, false);
  }
  const clk = room.clock;
  const base = clk.perPlayerMs || Math.floor((DEFAULT_TOTAL_MINUTES * 60 * 1000) / 3);
  const remBase = Array.isArray(clk.remainingMs) ? clk.remainingMs : [base, base, base];
  const extra = clk.running && typeof clk.lastTickAt === "number" && normalizeMode(room.mode) !== "monopoly"
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
    running: !!(clk.running && normalizeMode(room.mode) !== "monopoly"),
    syncedAt: now
  };
}

function getRoomState(room, now = Date.now()) {
  const mode = normalizeMode(room.mode);
  if (!room.monopoly) {
    room.monopoly = createMonopolyState(4);
  }
  return {
    code: room.code,
    mode,
    totalMinutes: normalizeTotalMinutes(room.totalMinutes),
    hostId: room.hostId,
    seats: room.seats.map(s => (s ? { id: s.id, name: s.name } : null)),
    cols: room.cols,
    mv: room.mv,
    monopoly: {
      playerCount: room.monopoly.playerCount,
      positions: [...room.monopoly.positions],
      turn: room.monopoly.turn,
      dice: [...room.monopoly.dice],
      rollSeq: room.monopoly.rollSeq || 0,
      lastRollAt: room.monopoly.lastRollAt || 0,
      soloActiveSeat: room.monopoly.soloActiveSeat || 0
    },
    drawOfferBy: room.drawOfferBy,
    isDraw: room.isDraw,
    gameOver: !!room.gameOver,
    clock: getClockSnapshot(room, now)
  };
}

function makeInitialSeats() {
  return [null, null, null, null];
}

function makeInitialCols() {
  return [0, 1, 2, 4];
}

io.on("connection", socket => {
  let currentRoom = null;

  socket.on("joinRoom", ({ roomCode, name, preferredSeat, preferredColor, gameMode, totalMinutes, monopolyPlayers }, cb) => {
    const cleanName = (name || "Gracz").trim().slice(0, 18) || "Gracz";
    socket.data.name = cleanName;
    let code = (roomCode || "").trim().toUpperCase();
    let room;
    const now = Date.now();

    if (!code) {
      code = genCode();
      const mins = normalizeTotalMinutes(totalMinutes);
      const mode = normalizeMode(gameMode);
      room = {
        code,
        mode,
        totalMinutes: mins,
        hostId: socket.id,
        seats: makeInitialSeats(),
        cols: makeInitialCols(),
        mv: [],
        monopoly: createMonopolyState(monopolyPlayers || 4),
        drawOfferBy: null,
        isDraw: false,
        gameOver: false,
        clock: createClockState(now, mins, false)
      };
      rooms.set(code, room);
    } else {
      room = rooms.get(code);
      if (!room) return cb({ error: "Nie znaleziono pokoju o takim kodzie." });
      if (!Array.isArray(room.seats) || room.seats.length < 4) {
        room.seats = [...room.seats, null].slice(0, 4);
      }
      if (!Array.isArray(room.cols) || room.cols.length < 4) {
        room.cols = [room.cols[0] ?? 0, room.cols[1] ?? 1, room.cols[2] ?? 2, 4];
      }
      if (!room.monopoly) {
        room.monopoly = createMonopolyState(monopolyPlayers || 4);
      }
      syncClocks(room, now, !!(room.isDraw || room.gameOver));
    }

    currentRoom = room;
    socket.join(code);

    const maxSeats = seatCountForMode(normalizeMode(room.mode), room);
    let seat = -1;
    if (preferredSeat >= 0 && preferredSeat < maxSeats && !room.seats[preferredSeat]) {
      seat = preferredSeat;
    } else {
      for (let i = 0; i < maxSeats; i++) {
        if (!room.seats[i]) {
          seat = i;
          break;
        }
      }
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

    maybeAutoStartClock(room, now);
    const snap = getRoomState(room, now);
    cb({ ok: true, seat, state: snap });
    io.to(code).emit("roomUpdate", snap);
  });

  socket.on("takeSeat", seatIdx => {
    if (!currentRoom) return;
    const maxSeats = seatCountForMode(normalizeMode(currentRoom.mode), currentRoom);
    if (typeof seatIdx !== "number" || seatIdx < 0 || seatIdx >= maxSeats) return;
    if (currentRoom.seats[seatIdx]) return;
    const now = Date.now();
    syncClocks(currentRoom, now, !!(currentRoom.isDraw || currentRoom.gameOver));
    const old = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    const oldName = old !== -1 ? currentRoom.seats[old]?.name : null;
    if (old !== -1) currentRoom.seats[old] = null;
    currentRoom.seats[seatIdx] = { id: socket.id, name: socket.data.name || oldName || "Gracz" };
    if (normalizeMode(currentRoom.mode) === "monopoly") {
      currentRoom.monopoly.soloActiveSeat = seatIdx;
    }
    maybeAutoStartClock(currentRoom, now);
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("setName", name => {
    socket.data.name = (name || "Gracz").trim().slice(0, 18) || "Gracz";
    if (!currentRoom) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat !== -1) {
      currentRoom.seats[seat].name = socket.data.name;
      const now = Date.now();
      syncClocks(currentRoom, now, !!(currentRoom.isDraw || currentRoom.gameOver));
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
    syncClocks(currentRoom, now, !!(currentRoom.isDraw || currentRoom.gameOver));
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("changeTime", nextMinutes => {
    if (!currentRoom) return;
    const mins = normalizeTotalMinutes(nextMinutes);
    const now = Date.now();
    const wasRunning = !!(currentRoom.clock && currentRoom.clock.running);
    currentRoom.totalMinutes = mins;
    currentRoom.drawOfferBy = null;
    currentRoom.isDraw = false;
    currentRoom.gameOver = false;
    const isChess = normalizeMode(currentRoom.mode) !== "monopoly";
    currentRoom.clock = createClockState(now, mins, isChess && (wasRunning || hasFullLobby(currentRoom)));
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("changeMode", (nextMode, extraOpts = {}) => {
    if (!currentRoom) return;
    const mode = normalizeMode(nextMode);
    const now = Date.now();
    const prevMode = normalizeMode(currentRoom.mode);
    currentRoom.mode = mode;
    currentRoom.mv = [];
    currentRoom.drawOfferBy = null;
    currentRoom.isDraw = false;
    currentRoom.gameOver = false;
    const pCount = extraOpts && extraOpts.monopolyPlayers
      ? Math.max(2, Math.min(4, Number(extraOpts.monopolyPlayers) || 4))
      : (currentRoom.monopoly?.playerCount || 4);
    currentRoom.monopoly = createMonopolyState(pCount);

    if (mode === "monopoly") {
      currentRoom.clock = createClockState(now, currentRoom.totalMinutes || DEFAULT_TOTAL_MINUTES, false);
    } else {
      const shouldRun = hasFullLobby(currentRoom);
      currentRoom.clock = createClockState(now, currentRoom.totalMinutes || DEFAULT_TOTAL_MINUTES, shouldRun);
    }
    if (prevMode !== mode || extraOpts.monopolyPlayers) {
      io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
    }
  });

  socket.on("setMonopolyPlayers", count => {
    if (!currentRoom || normalizeMode(currentRoom.mode) !== "monopoly") return;
    const cnt = Math.max(2, Math.min(4, Number(count) || 4));
    const now = Date.now();
    currentRoom.monopoly = createMonopolyState(cnt);
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("monopolyRoll", targetSeatOverride => {
    if (!currentRoom || normalizeMode(currentRoom.mode) !== "monopoly") return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (!currentRoom.monopoly) currentRoom.monopoly = createMonopolyState(4);
    const mono = currentRoom.monopoly;
    const occupiedCount = currentRoom.seats.slice(0, mono.playerCount).filter(Boolean).length;
    const activePlayer = occupiedCount <= 1 && typeof targetSeatOverride === "number" && targetSeatOverride >= 0 && targetSeatOverride < mono.playerCount
      ? targetSeatOverride
      : mono.turn;

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const steps = d1 + d2;
    const prevPos = mono.positions[activePlayer] || 0;
    const nextPos = (prevPos + steps) % 40;

    mono.dice = [d1, d2];
    mono.positions[activePlayer] = nextPos;
    mono.soloActiveSeat = activePlayer;
    mono.turn = (activePlayer + 1) % mono.playerCount;
    mono.rollSeq = (mono.rollSeq || 0) + 1;
    mono.lastRollAt = Date.now();

    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, Date.now()));
  });

  socket.on("monopolySelectSoloSeat", seatIdx => {
    if (!currentRoom || normalizeMode(currentRoom.mode) !== "monopoly") return;
    if (!currentRoom.monopoly) currentRoom.monopoly = createMonopolyState(4);
    const mono = currentRoom.monopoly;
    if (typeof seatIdx !== "number" || seatIdx < 0 || seatIdx >= mono.playerCount) return;
    mono.soloActiveSeat = seatIdx;
    mono.turn = seatIdx;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, Date.now()));
  });

  socket.on("confirmStart", () => {
    if (!currentRoom) return;
    const now = Date.now();
    syncClocks(currentRoom, now, !!(currentRoom.isDraw || currentRoom.gameOver));
    if (!currentRoom.isDraw && !currentRoom.gameOver && normalizeMode(currentRoom.mode) !== "monopoly") {
      currentRoom.clock.running = true;
      currentRoom.clock.lastTickAt = now;
    }
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("makeMove", (moveData, nextMeta) => {
    if (!currentRoom || currentRoom.isDraw || currentRoom.gameOver) return;
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
        currentRoom.gameOver = true;
      } else {
        currentRoom.clock.running = true;
      }
    }

    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("offerDraw", () => {
    if (!currentRoom || currentRoom.isDraw || currentRoom.gameOver) return;
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
      currentRoom.gameOver = true;
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
    currentRoom.gameOver = false;
    const mode = normalizeMode(currentRoom.mode);
    currentRoom.monopoly = createMonopolyState(currentRoom.monopoly?.playerCount || 4);
    const shouldRun = mode !== "monopoly" && hasFullLobby(currentRoom);
    currentRoom.clock = createClockState(now, currentRoom.totalMinutes || DEFAULT_TOTAL_MINUTES, shouldRun);
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, now));
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const now = Date.now();
    syncClocks(currentRoom, now, !!(currentRoom.isDraw || currentRoom.gameOver));
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
