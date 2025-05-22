const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- Configuration ---
// If you want your local development server to run on port 10000 by default,
// change the default from 3001 to 10000 here.
// Render will still provide its own PORT via process.env.PORT when deployed.
const PORT = process.env.PORT || 10000; // << MODIFIED FOR LOCAL PORT 10000

// CRITICAL: When deploying (e.g., to Render), set the APP_BASE_URL environment variable
// to your public application URL.
// Example on Render: KEY: APP_BASE_URL, VALUE: https://your-app-name.onrender.com
// If APP_BASE_URL is not set locally, it defaults to localhost based on the PORT.
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

const UPLOADS_DIR_NAME = 'uploads';
const UPLOADS_PATH = path.join(__dirname, UPLOADS_DIR_NAME);

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_PATH)) {
  fs.mkdirSync(UPLOADS_PATH, { recursive: true });
  console.log(`Created '${UPLOADS_DIR_NAME}' directory at ${UPLOADS_PATH}.`);
} else {
  console.log(`'${UPLOADS_DIR_NAME}' directory already exists at ${UPLOADS_PATH}`);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*', // Configure for your frontend's origin in production
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Serve uploaded files statically from UPLOADS_PATH at /<UPLOADS_DIR_NAME> URL path
app.use(`/${UPLOADS_DIR_NAME}`, express.static(UPLOADS_PATH));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_PATH);
  },
  filename: (req, file, cb) => {
    // Sanitize originalname and make filename unique
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9); // More unique
    cb(null, `${uniqueSuffix}-${safeOriginalName}`);
  }
});

// Allowed MIME types for chat attachments
const ALLOWED_MIME_PATTERNS_CHAT = [
    'image/', // e.g. image/jpeg, image/png
    'application/pdf',
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-powerpoint', // .ppt
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'text/plain', // .txt
    'application/zip',
    'application/x-rar-compressed', // .rar
    'application/octet-stream' // Generic fallback, use with caution
];

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const isAllowed = ALLOWED_MIME_PATTERNS_CHAT.some(pattern => {
        if (pattern.endsWith('/')) { // For type prefixes like 'image/'
            return file.mimetype.startsWith(pattern);
        }
        return file.mimetype === pattern; // For specific types like 'application/pdf'
    });

    if (isAllowed) {
      cb(null, true);
    } else {
      console.warn(`Rejected file type: ${file.mimetype} for file: ${file.originalname}`);
      cb(new Error(`File type '${file.mimetype}' is not allowed.`), false);
    }
  },
  limits: {
    fileSize: 15 * 1024 * 1024 // 15 MB limit (adjust as needed)
  }
});

app.get('/', (req, res) => {
  res.send(`🚀 AcharyaConnect Chat Server is running. Access files at ${APP_BASE_URL}/${UPLOADS_DIR_NAME}/your-file-name`);
});

// API route for chat file uploads
app.post('/upload', (req, res) => {
  upload.array('files', 5)(req, res, (err) => { // Max 5 files per upload
    if (err instanceof multer.MulterError) {
      console.error('Multer error during upload:', err);
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) { // Handles errors from fileFilter or other non-Multer issues
      console.error('Non-Multer error during upload:', err);
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded or all files were rejected by the filter.' });
    }

    const filesDataWithFullUrl = req.files.map(file => ({
        name: file.originalname,
        url: `${APP_BASE_URL}/${UPLOADS_DIR_NAME}/${file.filename}`, // Uses APP_BASE_URL
        type: file.mimetype,
        size: file.size
      }));

    console.log(`Files uploaded successfully: [${req.files.map(f => `'${f.originalname}'`).join(', ')}]`);
    res.status(200).json({ files: filesDataWithFullUrl });
  });
});

// --- Socket.IO Logic ---
const chatHistories = {};
const roomUsers = {};
const MAX_HISTORY_LENGTH = 100;

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join room', ({ taskId, user }) => {
    if (!taskId || !user || !user.auid || !user.name) {
      const missing = [];
      if (!taskId) missing.push("taskId");
      if (!user) missing.push("user object");
      else {
        if (!user.auid) missing.push("user.auid");
        if (!user.name) missing.push("user.name");
      }
      console.error(`join room: Incomplete data for socket ${socket.id}. Missing: ${missing.join(', ')}`, { taskId, user });
      socket.emit('error message', { message: `Failed to join room. Missing required data: ${missing.join(', ')}.` });
      return;
    }

    socket.userData = user;
    socket.join(taskId);
    console.log(`User ${user.name} (AUID: ${user.auid}, Socket: ${socket.id}) joined room: ${taskId}`);

    if (!roomUsers[taskId]) roomUsers[taskId] = {};
    roomUsers[taskId][socket.id] = user;
    io.to(taskId).emit('user joined', { taskId, user });

    if (!chatHistories[taskId]) chatHistories[taskId] = [];
    socket.emit('chat history', chatHistories[taskId]);
  });

  socket.on('chat message', ({ taskId, sender, message, files }) => {
    if (!taskId || !sender || !sender.auid || !sender.name) {
      console.error(`chat message: Incomplete data for socket ${socket.id}`, { taskId, sender });
      socket.emit('error message', { message: 'Cannot send message. Missing task ID or sender information.' });
      return;
    }

    const msgData = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
    const fileNames = msgData.files && Array.isArray(msgData.files) ? msgData.files.map(f => f.name).join(', ') : 'none';
    console.log(`Message to task ${taskId} by ${sender.name}: text='${msgData.message.substring(0,30)}...', files: [${fileNames}]`);
  });

  socket.on('disconnect', (reason) => {
    const user = socket.userData;
    console.log(`User disconnected: ${socket.id}. Reason: ${reason}.`);

    socket.rooms.forEach(room => {
      if (room !== socket.id && user) {
        io.to(room).emit('user left', { taskId: room, user });
        console.log(`User ${user.name} (AUID: ${user.auid}) auto-left room ${room} due to disconnect.`);
        if (roomUsers[room] && roomUsers[room][socket.id]) {
          delete roomUsers[room][socket.id];
          if (Object.keys(roomUsers[room]).length === 0) {
            console.log(`Task room ${room} is now empty (user list).`);
          }
        }
      } else if (room !== socket.id && !user) {
        const genericUserName = `User ${socket.id.substring(0,6)}`;
        const genericUserAuid = `socket_${socket.id.substring(0,6)}`;
        io.to(room).emit('user left', { taskId: room, user: { name: genericUserName, auid: genericUserAuid }});
        console.log(`Socket ID ${socket.id} (no AUID info) auto-left room ${room} due to disconnect.`);
      }
    });
  });

  socket.on('error', (err) => {
    console.error(`Socket error for ${socket.id} (${socket.userData ? socket.userData.name : 'N/A'}):`, err.message, err.stack);
    socket.emit('error message', { message: `A server-side socket error occurred: ${err.message}.` });
  });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AcharyaConnect Chat Server is running!`);
  console.log(`   Listening on: http://0.0.0.0:${PORT}`);
  console.log(`   Accessible locally at: http://localhost:${PORT}`);
  console.log(`   Uploads directory physical path: ${UPLOADS_PATH}`);
  console.log(`   File URLs will be constructed using APP_BASE_URL.`);
  if (process.env.APP_BASE_URL) {
    console.log(`   APP_BASE_URL is SET via environment variable to: ${process.env.APP_BASE_URL}`);
  } else {
    console.log(`   APP_BASE_URL is NOT SET, defaulting to: ${APP_BASE_URL}`);
  }
  console.log(`   Serving static files from '/${UPLOADS_DIR_NAME}' route, pointing to '${UPLOADS_PATH}'`);
  console.log(`   Ensure your client uses the full URLs provided by the server for files.`);
  if (PORT === 10000 && APP_BASE_URL === `http://localhost:10000`){
      console.warn(`   >>> Server is configured for http://localhost:10000 locally. If file links fail, ensure this server is running and accessible, and no other process is expected on this port.`);
  }
});
