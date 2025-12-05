const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// Хранилище комнат
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    // Присоединение к комнате
    socket.on('join-room', ({ roomId, userName, userId }) => {
        console.log(`${userName} (${userId}) присоединяется к комнате ${roomId}`);
        
        socket.join(roomId);
        
        // Создаем комнату если ее нет
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                users: new Map(),
                callActive: false,
                creator: null
            });
        }
        
        const room = rooms.get(roomId);
        room.users.set(socket.id, { userId, userName, socketId: socket.id });
        
        // Сообщаем всем в комнате о новом пользователе
        socket.to(roomId).emit('user-joined', {
            userId,
            userName,
            socketId: socket.id
        });
        
        // Отправляем текущих пользователей новому участнику
        const users = Array.from(room.users.values());
        socket.emit('room-users', users);
    });

    // Начало звонка
    socket.on('start-call', ({ roomId, userName, userId }) => {
        console.log(`${userName} начинает звонок в комнате ${roomId}`);
        
        const room = rooms.get(roomId);
        if (room) {
            room.callActive = true;
            room.creator = userId;
            
            // Уведомляем всех о начале звонка
            socket.to(roomId).emit('incoming-call', {
                roomId,
                creatorId: userId,
                creatorName: userName
            });
        }
    });

    // Принятие звонка
    socket.on('accept-call', ({ roomId, userName, userId }) => {
        console.log(`${userName} принял звонок в комнате ${roomId}`);
        
        const room = rooms.get(roomId);
        if (room && room.creator) {
            const creator = Array.from(room.users.values())
                .find(u => u.userId === room.creator);
            
            if (creator) {
                io.to(creator.socketId).emit('call-accepted', {
                    userId,
                    userName
                });
            }
        }
    });

    // WebRTC сигналинг
    socket.on('offer', ({ to, offer, roomId, from, userName }) => {
        console.log(`Offer от ${userName} к ${to}`);
        socket.to(to).emit('offer', {
            offer,
            from: socket.id,
            userId: from,
            userName
        });
    });

    socket.on('answer', ({ to, answer, roomId, from }) => {
        console.log(`Answer от ${from} к ${to}`);
        socket.to(to).emit('answer', {
            answer,
            from: socket.id,
            userId: from
        });
    });

    socket.on('ice-candidate', ({ to, candidate, roomId, from }) => {
        socket.to(to).emit('ice-candidate', {
            candidate,
            from: socket.id,
            userId: from
        });
    });

    // Отключение микрофона
    socket.on('toggle-mute', ({ roomId, userId, muted }) => {
        socket.to(roomId).emit('user-muted', {
            userId,
            muted
        });
    });

    // Завершение звонка
    socket.on('end-call', ({ roomId, userId }) => {
        console.log(`Пользователь ${userId} завершает звонок в комнате ${roomId}`);
        
        const room = rooms.get(roomId);
        if (room) {
            room.callActive = false;
            socket.to(roomId).emit('call-ended', { userId });
        }
    });

    // Отключение пользователя
    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        
        // Находим и удаляем пользователя из всех комнат
        rooms.forEach((room, roomId) => {
            if (room.users.has(socket.id)) {
                const user = room.users.get(socket.id);
                room.users.delete(socket.id);
                
                // Уведомляем остальных
                socket.to(roomId).emit('user-left', {
                    userId: user.userId,
                    userName: user.userName
                });
                
                // Если комната пуста, удаляем ее
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                }
            }
        });
    });
});

// Статус сервера
app.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        rooms: Array.from(rooms.keys()).length,
        connections: io.engine.clientsCount
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Ссылка: https://srv-d4phudvdiees738o8t30.render.com`);
});