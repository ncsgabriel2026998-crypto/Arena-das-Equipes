const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let file = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(__dirname, file);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end("Not found");
  }

  const ext = path.extname(filePath);
  const type = ext === ".html" ? "text/html" : "text/plain";

  res.writeHead(200, {
    "Content-Type": type
  });

  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message) {
  for (const ws of room.players) {
    send(ws, message);
  }
}

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      players: new Set(),
      positions: new Map()
    });
  }

  return rooms.get(id);
}

wss.on("connection", (ws) => {

  ws.on("message", (raw) => {

    let message;

    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "join") {

      const roomId = String(message.room || "").toUpperCase();

      if (!roomId) return;

      const room = getRoom(roomId);

      if (room.players.size >= 4) {
        send(ws, {
          type: "error",
          message: "Sala cheia"
        });
        return;
      }

      ws.room = roomId;

      ws.playerId =
        message.playerId ||
        Math.random().toString(36).slice(2);

      room.players.add(ws);

      send(ws, {
        type: "joined",
        room: roomId,
        playerId: ws.playerId
      });

      broadcast(room, {
        type: "count",
        count: room.players.size
      });
    }

    if (message.type === "location" && ws.room) {

      const room = rooms.get(ws.room);

      if (!room) return;

      room.positions.set(ws.playerId, {
        lat: message.lat,
        lon: message.lon
      });

      broadcast(room, {
        type: "positions",
        positions: [
          ...room.positions
        ].map(([id, position]) => ({
          id,
          ...position
        }))
      });
    }
  });

  ws.on("close", () => {

    if (!ws.room) return;

    const room = rooms.get(ws.room);

    if (!room) return;

    room.players.delete(ws);
    room.positions.delete(ws.playerId);

    broadcast(room, {
      type: "positions",
      positions: [
        ...room.positions
      ].map(([id, position]) => ({
        id,
        ...position
      }))
    });

    if (room.players.size === 0) {
      rooms.delete(ws.room);
    }
  });
});

server.listen(PORT, () => {
  console.log("Arena das Equipes online na porta " + PORT);
});
