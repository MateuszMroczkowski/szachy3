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

const MONO_DEFS = [
  { name: "START", type: "corner", price: 0, rent: 0, group: null },
  { name: "Brązowa I", type: "street", price: 60, rent: 6, group: "brown" },
  { name: "Kasa Społ.", type: "chest", price: 0, rent: 0, group: null },
  { name: "Brązowa II", type: "street", price: 60, rent: 10, group: "brown" },
  { name: "Podatek", type: "tax", price: 0, rent: 200, group: null },
  { name: "Kolej Pn.", type: "rail", price: 200, rent: 25, group: "rail" },
  { name: "Jasnonieb. I", type: "street", price: 100, rent: 12, group: "lblue" },
  { name: "Szansa", type: "chance", price: 0, rent: 0, group: null },
  { name: "Jasnonieb. II", type: "street", price: 100, rent: 12, group: "lblue" },
  { name: "Jasnonieb. III", type: "street", price: 120, rent: 16, group: "lblue" },
  { name: "WIĘZIENIE", type: "corner", price: 0, rent: 0, group: null },
  { name: "Różowa I", type: "street", price: 140, rent: 20, group: "pink" },
  { name: "Elektrownia", type: "util", price: 150, rent: 0, group: "util" },
  { name: "Różowa II", type: "street", price: 140, rent: 20, group: "pink" },
  { name: "Różowa III", type: "street", price: 160, rent: 24, group: "pink" },
  { name: "Kolej Wsch.", type: "rail", price: 200, rent: 25, group: "rail" },
  { name: "Pomarańcz. I", type: "street", price: 180, rent: 28, group: "orange" },
  { name: "Kasa Społ.", type: "chest", price: 0, rent: 0, group: null },
  { name: "Pomarańcz. II", type: "street", price: 180, rent: 28, group: "orange" },
  { name: "Pomarańcz. III", type: "street", price: 200, rent: 32, group: "orange" },
  { name: "PARKING", type: "corner", price: 0, rent: 0, group: null },
  { name: "Czerwona I", type: "street", price: 220, rent: 36, group: "red" },
  { name: "Szansa", type:"chance", price: 0, rent: 0, group: null },
  { name: "Czerwona II", type: "street", price: 220, rent: 36, group: "red" },
  { name: "Czerwona III", type: "street", price: 240, rent: 40, group: "red" },
  { name: "Kolej Pd.", type: "rail", price: 200, rent: 25, group: "rail" },
  { name: "Żółta I", type: "street", price: 260, rent: 44, group: "yellow" },
  { name: "Żółta II", type: "street", price: 260, rent: 44, group: "yellow" },
  { name: "Wodociągi", type: "util", price: 150, rent: 0, group: "util" },
  { name: "Żółta III", type: "street", price: 280, rent: 48, group: "yellow" },
  { name: "DO WIĘZIENIA", type: "corner", price: 0, rent: 0, group: null },
  { name: "Zielona I", type: "street", price: 300, rent: 52, group: "green" },
  { name: "Zielona II", type: "street", price: 300, rent: 52, group: "green" },
  { name: "Kasa Społ.", type: "chest", price: 0, rent: 0, group: null },
  { name: "Zielona III", type: "street", price: 320, rent: 56, group: "green" },
  { name: "Kolej Zach.", type: "rail", price: 200, rent: 25, group: "rail" },
  { name: "Szansa", type: "chance", price: 0, rent: 0, group: null },
  { name: "Granatowa I", type: "street", price: 350, rent: 70, group: "dblue" },
  { name: "Podatek bog.", type: "tax", price: 0, rent: 100, group: null },
  { name: "Granatowa II", type: "street", price: 400, rent: 100, group: "dblue" }
];

const GROUP_TILES = {
  brown: [1, 3],
  lblue: [6, 8, 9],
  pink: [11, 13, 14],
  orange: [16, 18, 19],
  red: [21, 23, 24],
  yellow: [26, 27, 29],
  green: [31, 32, 34],
  dblue: [37, 39],
  rail: [5, 15, 25, 35],
  util: [12, 28]
};

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
    money: [1500, 1500, 1500, 1500],
    jailed: [false, false, false, false],
    bankrupt: [false, false, false, false],
    owners: Array(40).fill(null),
    turn: 0,
    hasRolled: false,
    canBuyTile: null,
    dice: [1, 1],
    rollSeq: 0,
    lastEvent: "Gra rozpoczęta — kolej Pionka 1."
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
  const m = room.monopoly;
  return {
    code: room.code,
    mode,
    totalMinutes: normalizeTotalMinutes(room.totalMinutes),
    hostId: room.hostId,
    seats: room.seats.map(s => (s ? { id: s.id, name: s.name } : null)),
    cols: room.cols,
    mv: room.mv,
    monopoly: {
      playerCount: m.playerCount,
      positions: [...m.positions],
      money: [...m.money],
      jailed: [...m.jailed],
      bankrupt: [...m.bankrupt],
      owners: [...m.owners],
      turn: m.turn,
      hasRolled: !!m.hasRolled,
      canBuyTile: m.canBuyTile,
      dice: [...m.dice],
      rollSeq: m.rollSeq || 0,
      lastEvent: m.lastEvent || ""
    },
    drawOfferBy: room.drawOfferBy,
    isDraw: room.isDraw,
    gameOver: !!room.gameOver,
    clock: getClockSnapshot(room, now)
  };
}

function nextActiveMonopolyTurn(mono, fromSeat) {
  const cnt = mono.playerCount;
  for (let step = 1; step <= cnt; step++) {
    const cand = (fromSeat + step) % cnt;
    if (!mono.bankrupt[cand]) return cand;
  }
  return fromSeat;
}

function countActiveMonopolyPlayers(mono) {
  let c = 0;
  for (let i = 0; i < mono.playerCount; i++) {
    if (!mono.bankrupt[i]) c++;
  }
  return c;
}

function computeRent(mono, tileIdx, diceSum, playerIdx) {
  const tile = MONO_DEFS[tileIdx];
  const owner = mono.owners[tileIdx];
  if (owner == null || owner === playerIdx || mono.bankrupt[owner]) return 0;
  if (tile.type === "rail") {
    const ownedRails = GROUP_TILES.rail.filter(i => mono.owners[i] === owner).length;
    return 25 * Math.pow(2, Math.max(0, ownedRails - 1));
  }
  if (tile.type === "util") {
    const ownedUtils = GROUP_TILES.util.filter(i => mono.owners[i] === owner).length;
    return diceSum * (ownedUtils >= 2 ? 10 : 4);
  }
  if (tile.type === "street" && tile.group && GROUP_TILES[tile.group]) {
    const grp = GROUP_TILES[tile.group];
    const fullSet = grp.every(i => mono.owners[i] === owner);
    return fullSet ? tile.rent * 2 : tile.rent;
  }
  return tile.rent || 0;
}

function applyCharge(mono, playerIdx, amount, creditorIdx = null) {
  const due = Math.max(0, Math.floor(amount));
  if (due <= 0) return;
  const curMoney = mono.money[playerIdx] || 0;
  if (curMoney >= due) {
    mono.money[playerIdx] = curMoney - due;
    if (creditorIdx != null && creditorIdx !== playerIdx && !mono.bankrupt[creditorIdx]) {
      mono.money[creditorIdx] = (mono.money[creditorIdx] || 0) + due;
    }
  } else {
    if (creditorIdx != null && creditorIdx !== playerIdx && !mono.bankrupt[creditorIdx]) {
      mono.money[creditorIdx] = (mono.money[creditorIdx] || 0) + curMoney;
    }
    mono.money[playerIdx] = 0;
    mono.bankrupt[playerIdx] = true;
    for (let i = 0; i < mono.owners.length; i++) {
      if (mono.owners[i] === playerIdx) {
        mono.owners[i] = creditorIdx != null && !mono.bankrupt[creditorIdx] ? creditorIdx : null;
      }
    }
  }
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

  socket.on("monopolyRoll", () => {
    if (!currentRoom || normalizeMode(currentRoom.mode) !== "monopoly") return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (!currentRoom.monopoly) currentRoom.monopoly = createMonopolyState(4);
    const mono = currentRoom.monopoly;
    if (countActiveMonopolyPlayers(mono) <= 1) return;
    if (mono.bankrupt[mono.turn]) {
      mono.turn = nextActiveMonopolyTurn(mono, mono.turn);
    }
    if (mono.hasRolled || mono.canBuyTile != null) return;

    const activePlayer = mono.turn;
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;
    const isDouble = d1 === d2;

    mono.dice = [d1, d2];
    mono.rollSeq = (mono.rollSeq || 0) + 1;
    mono.canBuyTile = null;

    if (mono.jailed[activePlayer]) {
      if (isDouble) {
        mono.jailed[activePlayer] = false;
        const startP = mono.positions[activePlayer] || 0;
        const nextP = (startP + sum) % 40;
        if (startP + sum >= 40) mono.money[activePlayer] = (mono.money[activePlayer] || 0) + 200;
        mono.positions[activePlayer] = nextP;
        const tile = MONO_DEFS[nextP];
        if (tile.type === "tax") {
          applyCharge(mono, activePlayer, tile.rent, null);
          mono.lastEvent = `Pionek ${activePlayer + 1} wyszedł dubletem (${d1}+${d2}) → ${tile.name} (-$${tile.rent}).`;
        } else if (["street", "rail", "util"].includes(tile.type)) {
          if (mono.owners[nextP] == null) {
            mono.canBuyTile = nextP;
            mono.lastEvent = `Pionek ${activePlayer + 1} wyszedł dubletem (${d1}+${d2}) na wolne pole ${tile.name} ($${tile.price}).`;
          } else {
            const rent = computeRent(mono, nextP, sum, activePlayer);
            applyCharge(mono, activePlayer, rent, mono.owners[nextP]);
            mono.lastEvent = `Pionek ${activePlayer + 1} zapłacił $${rent} czynszu na ${tile.name}.`;
          }
        } else {
          mono.lastEvent = `Pionek ${activePlayer + 1} wyszedł dubletem (${d1}+${d2}) → ${tile.name}.`;
        }
        mono.hasRolled = true;
      } else {
        mono.lastEvent = `Pionek ${activePlayer + 1} w więzieniu: rzut ${d1}+${d2} (brak dubletu).`;
        mono.hasRolled = true;
      }
      io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, Date.now()));
      return;
    }

    const startP = mono.positions[activePlayer] || 0;
    const rawDest = startP + sum;
    const passedStart = rawDest >= 40;
    const dest = rawDest % 40;
    if (passedStart) {
      mono.money[activePlayer] = (mono.money[activePlayer] || 0) + 200;
    }
    mono.positions[activePlayer] = dest;

    const tile = MONO_DEFS[dest];
    let msg = `Pionek ${activePlayer + 1} wyrzucił ${d1}+${d2} (${sum}) → ${tile.name}${passedStart ? " (+$200 START)" : ""}.`;

    if (dest === 30) {
      mono.positions[activePlayer] = 10;
      mono.jailed[activePlayer] = true;
      msg = `Pionek ${activePlayer + 1} wyrzucił ${d1}+${d2} → Idzie do więzienia!`;
    } else if (tile.type === "tax") {
      applyCharge(mono, activePlayer, tile.rent, null);
      msg += ` Podatek -$${tile.rent}.`;
    } else if (["street", "rail", "util"].includes(tile.type)) {
      if (mono.owners[dest] == null) {
        mono.canBuyTile = dest;
        msg += ` Dostępne do kupienia za $${tile.price}.`;
      } else {
        const rent = computeRent(mono, dest, sum, activePlayer);
        applyCharge(mono, activePlayer, rent, mono.owners[dest]);
        msg += ` Czynsz dla Pionka ${mono.owners[dest] + 1}: $${rent}.`;
      }
    }

    if (mono.bankrupt[activePlayer]) {
      msg += ` Pionek ${activePlayer + 1} zbankrutował!`;
      mono.canBuyTile = null;
      mono.hasRolled = true;
    } else if (isDouble && !mono.jailed[activePlayer] && mono.canBuyTile == null) {
      mono.hasRolled = false;
      msg += " Dublet — dodatkowy rzut!";
    } else {
      mono.hasRolled = true;
    }

    mono.lastEvent = msg;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, Date.now()));
  });

  socket.on("monopolyBuy", () => {
    if (!currentRoom || normalizeMode(currentRoom.mode) !== "monopoly") return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1 || !currentRoom.monopoly) return;
    const mono = currentRoom.monopoly;
    const idx = mono.canBuyTile;
    if (idx == null || mono.owners[idx] != null) return;
    const tile = MONO_DEFS[idx];
    const pIdx = mono.turn;
    if ((mono.money[pIdx] || 0) < tile.price) return;
    mono.money[pIdx] -= tile.price;
    mono.owners[idx] = pIdx;
    mono.canBuyTile = null;
    mono.lastEvent = `Pionek ${pIdx + 1} kupił ${tile.name} za $${tile.price}.`;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, Date.now()));
  });

  socket.on("monopolySkipBuy", () => {
    if (!currentRoom || normalizeMode(currentRoom.mode) !== "monopoly") return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1 || !currentRoom.monopoly) return;
    const mono = currentRoom.monopoly;
    if (mono.canBuyTile == null) return;
    const tile = MONO_DEFS[mono.canBuyTile];
    mono.canBuyTile = null;
    mono.lastEvent = `Pionek ${mono.turn + 1} nie kupił ${tile.name}.`;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, Date.now()));
  });

  socket.on("monopolyPayBail", () => {
    if (!currentRoom || normalizeMode(currentRoom.mode) !== "monopoly") return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1 || !currentRoom.monopoly) return;
    const mono = currentRoom.monopoly;
    const pIdx = mono.turn;
    if (!mono.jailed[pIdx] || mono.hasRolled) return;
    if ((mono.money[pIdx] || 0) < 50) return;
    mono.money[pIdx] -= 50;
    mono.jailed[pIdx] = false;
    mono.lastEvent = `Pionek ${pIdx + 1} zapłacił $50 kaucji i wyszedł z więzienia.`;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom, Date.now()));
  });

  socket.on("monopolyEndTurn", () => {
    if (!currentRoom || normalizeMode(currentRoom.mode) !== "monopoly") return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1 || !currentRoom.monopoly) return;
    const mono = currentRoom.monopoly;
    if (!mono.hasRolled && !mono.bankrupt[mono.turn]) return;
    mono.canBuyTile = null;
    mono.hasRolled = false;
    mono.turn = nextActiveMonopolyTurn(mono, mono.turn);
    mono.lastEvent = `Tura Pionka ${mono.turn + 1}.`;
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
