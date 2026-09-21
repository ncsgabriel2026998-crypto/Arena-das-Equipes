const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, "index.html");

  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404);
    return res.end("Not found");
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocket.Server({ server });

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message) {
  for (const player of room.players) {
    send(player, message);
  }
}

function roomState(room) {
  return {
    type: "room_state",
    code: room.code,
    hostId: room.hostId,
    players: [...room.players].map(player => ({
      id: player.id
    }))
  };
}

function broadcastState(room) {
  broadcast(room, roomState(room));
}

function newRoomCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function leaveRoom(ws) {
  const code = ws.roomCode;

  if (!code) return;

  const room = rooms.get(code);

  if (!room) return;

  room.players.delete(ws);
  ws.roomCode = "";

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }

  if (room.hostId === ws.id) {
    room.hostId = [...room.players][0].id;
  }

  broadcastState(room);
}

wss.on("connection", ws => {
  ws.id = Math.random()
    .toString(36)
    .slice(2, 10);

  ws.roomCode = "";

  send(ws, {
    type: "welcome",
    id: ws.id
  });

  ws.on("message", data => {
    let message;

    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.type === "create_room") {
      leaveRoom(ws);

      const code = newRoomCode();

      const room = {
        code,
        hostId: ws.id,
        players: new Set([ws]),
        started: false
      };

      rooms.set(code, room);
      ws.roomCode = code;

      broadcastState(room);
      return;
    }

    if (message.type === "join_room") {
      const code = String(message.code || "").toUpperCase();
      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: "error",
          message: "Sala não encontrada."
        });
      }

      if (room.started) {
        return send(ws, {
          type: "error",
          message: "A partida já começou."
        });
      }

      if (room.players.size >= 4) {
        return send(ws, {
          type: "error",
          message: "Sala cheia."
        });
      }

      leaveRoom(ws);

      room.players.add(ws);
      ws.roomCode = code;

      broadcastState(room);
      return;
    }

    if (message.type === "start_game") {
      const room = rooms.get(ws.roomCode);

      if (!room || room.hostId !== ws.id) {
        return;
      }

      if (room.players.size < 2) {
        return send(ws, {
          type: "error",
          message: "É preciso ter pelo menos 2 jogadores."
        });
      }

      room.started = true;

      broadcast(room, {
        type: "game_started",
        lootSeconds: 30
      });
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Arena das Equipes online na porta ${PORT}`);
});
