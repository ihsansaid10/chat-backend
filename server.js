const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Menyimpan data room: { "ROOMCODE": { roomName: "Nama Room" } }
const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('User terhubung:', socket.id);

  // Event: Cek apakah kode room valid
  socket.on('check-room-code', (code) => {
    if (rooms[code]) {
      socket.emit('check-room-response', { 
        valid: true, 
        roomCode: code, 
        roomName: rooms[code].roomName 
      });
    } else {
      socket.emit('check-room-response', { 
        valid: false, 
        message: 'Kode Room tidak ditemukan!' 
      });
    }
  });

  // Event: Buat Room Baru
  socket.on('create-room', ({ roomName, username }) => {
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = { roomName };

    socket.join(roomCode);
    socket.emit('room-created', { roomCode, roomName });
    console.log(`Room "${roomName}" (${roomCode}) dibuat oleh ${username}`);
  });

  // Event: Join Room
  socket.on('join-room', ({ roomCode, username }) => {
    if (rooms[roomCode]) {
      socket.join(roomCode);
      socket.emit('room-joined', { 
        roomCode, 
        roomName: rooms[roomCode].roomName 
      });
      socket.to(roomCode).emit('user-connected', username);
      console.log(`${username} bergabung ke room ${roomCode}`);
    }
  });

  // Event: Kirim Pesan Chat
  socket.on('send-message', ({ roomCode, username, message }) => {
    io.to(roomCode).emit('receive-message', {
      username,
      message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('disconnect', () => {
    console.log('User terputus:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));