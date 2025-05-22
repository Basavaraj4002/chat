 const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- Configuration ---
const PORT = process.env.PORT || 3001;

// CRITICAL: Set this environment variable on your Render service!
// Example: KEY: APP_BASE_URL, VALUE: https://your-app-name.onrender.com
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`; // Corrected: Added backticks

const UPLOADS_DIR_NAME = 'uploads';
const UPLOADS_PATH = path.join(__dirname, UPLOADS_DIR_NAME);

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_PATH)) {
  fs.mkdirSync(UPLOADS_PATH, { recursive: true });
  console.log(`Created '${UPLOADS_DIR_NAME}' directory.`); // Corrected: Added backticks
} else {
  console.log(`'${UPLOADS_DIR_NAME}' directory already exists at ${UPLOADS_PATH}`); // Corrected: Added backticks
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

// Serve uploaded files statically
app.use(`/${UPLOADS_DIR_NAME}`, express.static(UPLOADS_PATH)); // Corrected: Added backticks

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_PATH);
  },
  filename: (req, file, cb) => {
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, `${Date.now()}-${safeOriginalName}`); // Corrected: Added backticks
  }
});

// Allowed MIME types for chat attachments
const ALLOWED_MIME_PATTERNS_CHAT = [
    'image/',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed',
    'application/octet-stream' // Be cautious with this, as it's very generic
];

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const isAllowed = ALLOWED_MIME_PATTERNS_CHAT.some(pattern => {
        if (pattern.endsWith('/')) {
            return file.mimetype.startsWith(pattern);
        }
        return file.mimetype === pattern;
    });

    if (isAllowed) {
      cb(null, true);
    } else {
      console.log(`Rejected file type: ${file.mimetype} for file: ${file.originalname}`); // Corrected: Added backticks
      cb(new Error(`File type not allowed: ${file.mimetype}. Check server configuration for allowed types.`), false); // Corrected: Added backticks
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit
  }
});

app.get('/', (req, res) => {
  res.send(`🚀 AcharyaConnect Chat Server is running. File uploads at ${APP_BASE_URL}/${UPLOADS_DIR_NAME}/your-file-name`); // Corrected: Added backticks
});

// API route for chat file uploads
app.post('/upload', (req, res) => {
  upload.array('files', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer error during upload:', err);
      return res.status(400).json({ error: `Upload error: ${err.message}` }); // Corrected: Added backticks
    } else if (err) {
      console.error('Non-Multer Error during upload:', err);
      return res.status(400).json({ error: err.message || 'Invalid file type or an unknown error occurred.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded or files were rejected.' });
    }

    const filesDataWithFullUrl = req.files.map(file => ({
        name: file.originalname,
        url: `${APP_BASE_URL}/${UPLOADS_DIR_NAME}/${file.filename}`, // FULL URL // Corrected: Added backticks
        type: file.mimetype,
        size: file.size
      }));

    console.log(`Files uploaded successfully: [ ${req.files.map(f => `'${f.originalname}'`).join(', ')} ]`); // Corrected: Added backticks
    res.json({ files: filesDataWithFullUrl });
  });
});

// --- Socket.IO Logic ---
const chatHistories = {};
const roomUsers = {};
const MAX_HISTORY_LENGTH = 100;

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`); // Corrected: Added backticks

  socket.on('join room', ({ taskId, user }) => {
    if (!taskId || !user || !user.auid || !user.name) {
      const missing = [];
      if (!taskId) missing.push("taskId");
      if (!user) missing.push("user object");
      else {
        if (!user.auid) missing.push("user.auid");
        if (!user.name) missing.push("user.name");
      }
      console.error(`join room: Incomplete data for socket ${socket.id}. Missing: ${missing.join(', ')}`, { taskId, user }); // Corrected: Added backticks
      socket.emit('error message', { message: `Failed to join room. Missing: ${missing.join(', ')}.` }); // Corrected: Added backticks
      return;
    }

    socket.userData = user;
    socket.join(taskId);
    console.log(`User ${user.name} (AUID: ${user.auid}, Socket: ${socket.id}) joined room: ${taskId}`); // Corrected: Added backticks


    if (!roomUsers[taskId]) roomUsers[taskId] = {};
    roomUsers[taskId][socket.id] = user;

    io.to(taskId).emit('user joined', { taskId, user });

    if (!chatHistories[taskId]) chatHistories[taskId] = [];
    socket.emit('chat history', chatHistories[taskId]);
  });

  socket.on('chat message', ({ taskId, sender, message, files }) => {
    if (!taskId || !sender || !sender.auid || !sender.name) {
      console.error(`chat message: Incomplete data for socket ${socket.id}`, { taskId, sender }); // Corrected: Added backticks
      socket.emit('error message', { message: 'Cannot send message. Missing task ID or sender info.' });
      return;
    }

    const msgData = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, // Corrected: Added backticks
      sender,
      message: message || '',
      files: files || [],
      timestamp: new Date(),
      taskId: taskId
    };

    if (!chatHistories[taskId]) chatHistories[taskId] = [];
    chatHistories[taskId].push(msgData);
    if (chatHistories[taskId].length > MAX_HISTORY_LENGTH) {
      chatHistories[taskId].splice(0, chatHistories[taskId].length - MAX_HISTORY_LENGTH);
    }

    io.to(taskId).emit('chat message', msgData);
    console.log(`Message to task ${taskId} by ${sender.name}:`, { text: msgData.message.substring(0,50) + (msgData.message.length > 50 ? "..." : ""), files: msgData.files ? msgData.files.map(f=>f.name) : [] }); // Corrected to handle msgData.files potentially being undefined/null before map
  });

  socket.on('disconnect', (reason) => {
    const user = socket.userData;
    console.log(`User disconnected: ${socket.id}. Reason: ${reason}.`); // Corrected: Added backticks

    socket.rooms.forEach(room => {
      if (room !== socket.id && user) {
        io.to(room).emit('user left', { taskId: room, user });
        console.log(`User ${user.name} (AUID: ${user.auid}) auto-left room ${room} due to disconnect.`); // Corrected: Added backticks

        if (roomUsers[room] && roomUsers[room][socket.id]) {
          delete roomUsers[room][socket.id];
          if (Object.keys(roomUsers[room]).length === 0) {
            // console.log(`Task room ${room} is now empty. Consider clearing history.`);
            // delete roomUsers[room];
            // delete chatHistories[room];
          }
        }
      } else if (room !== socket.id && !user) {
        const genericUserName = `User ${socket.id.substring(0,6)}`;
        const genericUserAuid = `socket_${socket.id.substring(0,6)}`;
        io.to(room).emit('user left', { taskId: room, user: { name: genericUserName, auid: genericUserAuid }});
        console.log(`User with socket ID ${socket.id} (no AUID info) auto-left room ${room} due to disconnect.`); // Corrected: Added backticks
      }
    });
  });

  socket.on('error', (err) => {
    console.error(`Socket error for ${socket.id} (${socket.userData ? socket.userData.name : 'N/A'}):`, err.message, err.stack); // Corrected: Added backticks
    socket.emit('error message', { message: `Server socket error: ${err.message}.` }); // Corrected: Added backticks
  });
});

server.listen(PORT, '0.0.0.0', () => { // Listen on 0.0.0.0 for Render compatibility
  console.log(`🚀 AcharyaConnect Chat Server is running on http://0.0.0.0:${PORT}`); // Corrected: Added backticks
  console.log(`File uploads will be served from ${APP_BASE_URL}/${UPLOADS_DIR_NAME}`); // Corrected: Added backticks
  console.log(`Ensure APP_BASE_URL environment variable is set correctly on your hosting (e.g., Render) to your public URL: ${APP_BASE_URL}`); // Corrected: Added backticks
  console.log(`Uploads physical path: ${UPLOADS_PATH}`); // Added for clarity
});
