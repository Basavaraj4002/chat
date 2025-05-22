 const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- Configuration ---
const PORT = process.env.PORT || 3001; // Default local port

// Define APP_BASE_URL based on NODE_ENV
// Ensure NODE_ENV is 'production' on your Render service.
// Render typically sets NODE_ENV to 'production' automatically for Node.js services.
const APP_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://chat-1-fnv7.onrender.com" // YOUR PRODUCTION URL
    : `http://localhost:${PORT}`;         // Local development URL - CORRECTED TEMPLATE LITERAL

const UPLOADS_DIR_NAME = 'uploads';
const UPLOADS_PATH = path.join(__dirname, UPLOADS_DIR_NAME);

if (!fs.existsSync(UPLOADS_PATH)) {
  fs.mkdirSync(UPLOADS_PATH, { recursive: true });
  console.log(`Created '${UPLOADS_DIR_NAME}' directory.`); // CORRECTED
} else {
  console.log(`'${UPLOADS_DIR_NAME}' directory already exists at ${UPLOADS_PATH}`); // CORRECTED
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.use(`/${UPLOADS_DIR_NAME}`, express.static(UPLOADS_PATH)); // CORRECTED

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_PATH);
  },
  filename: (req, file, cb) => {
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${safeOriginalName}`); // CORRECTED (added more uniqueness)
  }
});

const ALLOWED_MIME_PATTERNS_CHAT = [
    'image/', 'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'application/zip', 'application/x-rar-compressed',
    'application/octet-stream'
];

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const isAllowed = ALLOWED_MIME_PATTERNS_CHAT.some(pattern =>
        pattern.endsWith('/') ? file.mimetype.startsWith(pattern) : file.mimetype === pattern
    );
    if (isAllowed) {
      cb(null, true);
    } else {
      console.warn(`Rejected file type: ${file.mimetype} for file: ${file.originalname}`); // CORRECTED + warn
      cb(new Error(`File type not allowed: ${file.mimetype}. Check server configuration for allowed types.`), false); // CORRECTED
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.get('/', (req, res) => {
  res.send(`🚀 AcharyaConnect Chat Server is running. File uploads at ${APP_BASE_URL}/${UPLOADS_DIR_NAME}/your-file-name`); // CORRECTED
});

app.post('/upload', (req, res) => {
  upload.array('files', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer error during upload:', err);
      return res.status(400).json({ error: `Upload error: ${err.message}` }); // CORRECTED
    } else if (err) {
      console.error('Non-Multer Error during upload:', err);
      return res.status(400).json({ error: err.message || 'Invalid file type or an unknown error occurred.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded or files were rejected.' });
    }

    const filesDataWithFullUrl = req.files.map(file => ({
        name: file.originalname,
        url: `${APP_BASE_URL}/${UPLOADS_DIR_NAME}/${file.filename}`, // CORRECTED
        type: file.mimetype,
        size: file.size
      }));

    console.log(`Files uploaded successfully: [ ${req.files.map(f => `'${f.originalname}'`).join(', ')} ]`); // CORRECTED
    res.json({ files: filesDataWithFullUrl });
  });
});

const chatHistories = {};
const roomUsers = {};
const MAX_HISTORY_LENGTH = 100;

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`); // CORRECTED

  socket.on('join room', ({ taskId, user }) => {
    if (!taskId || !user || !user.auid || !user.name) {
      const missing = [];
      if (!taskId) missing.push("taskId");
      if (!user) missing.push("user object"); else { if (!user.auid) missing.push("user.auid"); if (!user.name) missing.push("user.name"); }
      console.error(`join room: Incomplete data for socket ${socket.id}. Missing: ${missing.join(', ')}`, { taskId, user }); // CORRECTED
      socket.emit('error message', { message: `Failed to join room. Missing: ${missing.join(', ')}.` }); // CORRECTED
      return;
    }
    socket.userData = user;
    socket.join(taskId);
    console.log(`User ${user.name} (AUID: ${user.auid}, Socket: ${socket.id}) joined room: ${taskId}`); // CORRECTED

    if (!roomUsers[taskId]) roomUsers[taskId] = {};
    roomUsers[taskId][socket.id] = user;
    io.to(taskId).emit('user joined', { taskId, user });
    if (!chatHistories[taskId]) chatHistories[taskId] = [];
    socket.emit('chat history', chatHistories[taskId]);
  });

  socket.on('chat message', ({ taskId, sender, message, files }) => {
    if (!taskId || !sender || !sender.auid || !sender.name) {
      console.error(`chat message: Incomplete data for socket ${socket.id}`, { taskId, sender }); // CORRECTED
      socket.emit('error message', { message: 'Cannot send message. Missing task ID or sender info.' });
      return;
    }
    const msgData = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, // CORRECTED
      sender, message: message || '', files: files || [],
      timestamp: new Date(), taskId: taskId
    };
    if (!chatHistories[taskId]) chatHistories[taskId] = [];
    chatHistories[taskId].push(msgData);
    if (chatHistories[taskId].length > MAX_HISTORY_LENGTH) {
      chatHistories[taskId].splice(0, chatHistories[taskId].length - MAX_HISTORY_LENGTH);
    }
    io.to(taskId).emit('chat message', msgData);
    console.log(`Message to task ${taskId} by ${sender.name}:`, { text: msgData.message.substring(0,50) + (msgData.message.length > 50 ? "..." : ""), files: msgData.files ? msgData.files.map(f=>f.name) : [] }); // CORRECTED
  });

  socket.on('disconnect', (reason) => {
    const user = socket.userData;
    console.log(`User disconnected: ${socket.id}. Reason: ${reason}.`); // CORRECTED
    socket.rooms.forEach(room => {
      if (room !== socket.id && user) {
        io.to(room).emit('user left', { taskId: room, user });
        console.log(`User ${user.name} (AUID: ${user.auid}) auto-left room ${room} due to disconnect.`); // CORRECTED
        if (roomUsers[room] && roomUsers[room][socket.id]) delete roomUsers[room][socket.id];
        // Optional: cleanup empty roomUsers[room] and chatHistories[room] if desired
      } else if (room !== socket.id && !user) {
        const genericUserName = `User ${socket.id.substring(0,6)}`;
        const genericUserAuid = `socket_${socket.id.substring(0,6)}`;
        io.to(room).emit('user left', { taskId: room, user: { name: genericUserName, auid: genericUserAuid }}); // CORRECTED
        console.log(`User with socket ID ${socket.id} (no AUID) auto-left room ${room} due to disconnect.`); // CORRECTED
      }
    });
  });

  socket.on('error', (err) => {
    console.error(`Socket error for ${socket.id} (${socket.userData ? socket.userData.name : 'N/A'}):`, err.message, err.stack); // CORRECTED
    socket.emit('error message', { message: `Server socket error: ${err.message}.` }); // CORRECTED
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AcharyaConnect Chat Server is running on http://0.0.0.0:${PORT}`); // CORRECTED
  console.log(`   Uploads directory physical path: ${UPLOADS_PATH}`);
  console.log(`   Serving static files from '/${UPLOADS_DIR_NAME}' route`);
  console.log(`   Current NODE_ENV: '${process.env.NODE_ENV || 'undefined (development assumed)'}'`);
  console.log(`   APP_BASE_URL determined as: ${APP_BASE_URL}`);
  console.log(`   File uploads will be served using this APP_BASE_URL.`);

  if (process.env.NODE_ENV !== 'production' && APP_BASE_URL.includes('localhost')) {
    console.warn("   ----> DEVELOPMENT MODE: APP_BASE_URL is localhost. This is correct for local testing.");
  } else if (process.env.NODE_ENV === 'production' && APP_BASE_URL.includes('onrender.com')) {
    console.log("   ----> PRODUCTION MODE: APP_BASE_URL is set to production URL. This is correct for deployment.");
  } else if (process.env.NODE_ENV === 'production' && !APP_BASE_URL.includes('onrender.com')) {
    console.error("   🚨 CRITICAL WARNING: NODE_ENV is 'production', BUT APP_BASE_URL IS NOT THE EXPECTED PRODUCTION URL!");
    console.error(`   🚨 APP_BASE_URL is currently: ${APP_BASE_URL}. It should be your 'onrender.com' URL.`);
    console.error("   🚨 This will cause file links to be incorrect in production. Check your hardcoded production URL in server.js.");
  } else {
    console.warn("   ----> UNKNOWN MODE or MISCONFIGURATION: Check NODE_ENV and APP_BASE_URL logic.");
  }
});
