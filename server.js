const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const MAP_WIDTH = 2400;
const MAP_HEIGHT = 1600;

const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404);
    return res.end("Not found");
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });

  fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
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

function gameState(room) {
  return {
    type: "game_state",
    players: [...room.players].map(player => ({
      id: player.id,
      x: player.x,
      y: player.y,
      hp: player.hp,
      ammo: player.ammo,
      medkits: player.medkits
    })),
    loot: room.loot
  };
}

function leaveRoom(ws) {
  if (!ws.roomCode) return;

  const room = rooms.get(ws.roomCode);

  if (!room) return;

  room.players.delete(ws);
  ws.roomCode = "";

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === ws.id) {
    room.hostId = [...room.players][0].id;
  }

  broadcast(room, roomState(room));
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

  ws.on("message", raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    let room;

    if (message.type === "create_room") {
      leaveRoom(ws);

      room = {
        code: newRoomCode(),
        hostId: ws.id,
        players: new Set([ws]),
        started: false,
        loot: []
      };

      rooms.set(room.code, room);
      ws.roomCode = room.code;

      broadcast(room, roomState(room));
      return;
    }

    if (message.type === "join_room") {
      const code = String(message.code || "").toUpperCase();

      room = rooms.get(code);

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

      if (room.players.size >= MAX_PLAYERS) {
        return send(ws, {
          type: "error",
          message: "Sala cheia."
        });
      }

      leaveRoom(ws);

      room.players.add(ws);
      ws.roomCode = room.code;

      broadcast(room, roomState(room));
      return;
    }

    room = rooms.get(ws.roomCode);

    if (message.type === "start_game") {
      if (!room || room.hostId !== ws.id) {
        return send(ws, {
          type: "error",
          message: "Sem permissão."
        });
      }

      if (room.players.size < 2) {
        return send(ws, {
          type: "error",
          message: "É preciso ter pelo menos 2 jogadores."
        });
      }

      room.started = true;

      let index = 0;

      for (const player of room.players) {
        player.x = 400 + (index % 2) * 1600;
        player.y = 400 + Math.floor(index / 2) * 800;
        player.hp = 100;
        player.ammo = 12;
        player.medkits = 1;
        index++;
      }

      room.loot = [
        { id: 1, x: 700, y: 500, kind: "ammo" },
        { id: 2, x: 1700, y: 500, kind: "ammo" },
        { id: 3, x: 1200, y: 1200, kind: "medkit" },
        { id: 4, x: 500, y: 1250, kind: "medkit" }
      ];

      broadcast(room, {
        type: "game_started",
        seconds: 30
      });

      broadcast(room, gameState(room));
      return;
    }

    if (!room || !room.started) {
      return;
    }

    const player = ws;

    if (message.type === "move") {
      let dx = Number(message.dx) || 0;
      let dy = Number(message.dy) || 0;

      const length = Math.hypot(dx, dy) || 1;
      const speed = 9;

      player.x = Math.max(
        30,
        Math.min(
          MAP_WIDTH - 30,
          player.x + (dx / length) * speed
        )
      );

      player.y = Math.max(
        30,
        Math.min(
          MAP_HEIGHT - 30,
          player.y + (dy / length) * speed
        )
      );

      for (let i = room.loot.length - 1; i >= 0; i--) {
        const item = room.loot[i];

        if (
          Math.hypot(
            item.x - player.x,
            item.y - player.y
          ) < 55
        ) {
          if (item.kind === "medkit") {
            player.medkits++;
          } else {
            player.ammo += 6;
          }

          room.loot.splice(i, 1);
        }
      }
    }

    if (
      message.type === "heal" &&
      player.medkits > 0 &&
      player.hp < 100
    ) {
      player.medkits--;
      player.hp = Math.min(100, player.hp + 35);
    }

    if (
      message.type === "attack" &&
      player.ammo > 0
    ) {
      player.ammo--;

      for (const target of room.players) {
        if (
          target !== player &&
          target.hp > 0 &&
          Math.hypot(
            target.x - player.x,
            target.y - player.y
          ) < 190
        ) {
          target.hp = Math.max(0, target.hp - 25);
        }
      }
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.started) {
      broadcast(room, gameState(room));
    }
  }
}, 100);

server.listen(PORT, () => {
  console.log(
    "Arena das Equipes online na porta " + PORT
  );
});
