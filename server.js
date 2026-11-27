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

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? genCode() : code;
}

function getRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    seats: room.seats.map(s => (s ? { id: s.id, name: s.name } : null)),
    cols: room.cols,
    mv: room.mv,
    drawOfferBy: room.drawOfferBy,
    isDraw: room.isDraw
  };
}

io.on("connection", socket => {
  let currentRoom = null;

  socket.on("joinRoom", ({ roomCode, name, preferredSeat, preferredColor }, cb) => {
    const cleanName = (name || "Gracz").trim().slice(0, 18) || "Gracz";
    socket.data.name = cleanName;
    let code = (roomCode || "").trim().toUpperCase();
    let room;

    if (!code) {
      code = genCode();
      room = {
        code,
        hostId: socket.id,
        seats: [null, null, null],
        cols: [0, 1, 2],
        mv: [],
        drawOfferBy: null,
        isDraw: false
      };
      rooms.set(code, room);
    } else {
      room = rooms.get(code);
      if (!room) return cb({ error: "Nie znaleziono pokoju o takim kodzie." });
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

    cb({ ok: true, seat, state: getRoomState(room) });
    io.to(code).emit("roomUpdate", getRoomState(room));
  });

  socket.on("takeSeat", seatIdx => {
    if (!currentRoom || seatIdx < 0 || seatIdx > 2) return;
    if (currentRoom.seats[seatIdx]) return;
    const old = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    const oldName = old !== -1 ? currentRoom.seats[old]?.name : null;
    if (old !== -1) currentRoom.seats[old] = null;
    currentRoom.seats[seatIdx] = { id: socket.id, name: socket.data.name || oldName || "Gracz" };
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("setName", name => {
    socket.data.name = (name || "Gracz").trim().slice(0, 18) || "Gracz";
    if (!currentRoom) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat !== -1) {
      currentRoom.seats[seat].name = socket.data.name;
      io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
    }
  });

  socket.on("changeColor", colIdx => {
    if (!currentRoom || typeof colIdx !== "number" || colIdx < 0 || colIdx >= PAL_COUNT) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (currentRoom.cols.includes(colIdx)) return;
    currentRoom.cols[seat] = colIdx;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("makeMove", moveData => {
    if (!currentRoom || currentRoom.isDraw) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (!Array.isArray(moveData) || moveData.length < 2) return;
    currentRoom.drawOfferBy = null;
    currentRoom.mv.push([moveData[0], moveData[1], moveData[2] || null]);
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("offerDraw", () => {
    if (!currentRoom || currentRoom.isDraw) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (currentRoom.drawOfferBy === null) {
      currentRoom.drawOfferBy = seat;
    } else if (currentRoom.drawOfferBy === seat) {
      currentRoom.drawOfferBy = null;
    } else {
      currentRoom.isDraw = true;
      currentRoom.drawOfferBy = null;
    }
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("resetGame", () => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    currentRoom.mv = [];
    currentRoom.drawOfferBy = null;
    currentRoom.isDraw = false;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
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
      io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
