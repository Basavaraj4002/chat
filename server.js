 const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // To ensure the uploads directory exists

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`; // Corrected
const UPLOADS_DIR_NAME = 'uploads';
const UPLOADS_PATH = path.join(__dirname, UPLOADS_DIR_NAME);

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_PATH)) {
  fs.mkdirSync(UPLOADS_PATH, { recursive: true });
  console.log(`Created uploads directory at ${UPLOADS_PATH}`); // Corrected
} else {
  console.log(`Uploads directory already exists at ${UPLOADS_PATH}`); // Corrected
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
app.use(`/${UPLOADS_DIR_NAME}`, express.static(UPLOADS_PATH)); // Corrected

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_PATH);
  },
  filename: (req, file, cb) => {
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, `${Date.now()}-${safeOriginalName}`); // Corrected
  }
});

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
    'application/x-rar-compressed'
];

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Check if the file's mimetype OR its originalname's extension matches allowed patterns
    // This helps with files that might have a generic mimetype like application/octet-stream
    const isMimeTypeAllowed = ALLOWED_MIME_PATTERNS_CHAT.some(pattern => {
        if (pattern.endsWith('/')) { // e.g. 'image/'
            return file.mimetype.startsWith(pattern);
        }
        return file.mimetype === pattern;
    });

    if (isMimeTypeAllowed) {
      cb(null, true);
    } else {
      // Try to infer from extension if mimetype is too generic (like application/octet-stream)
      // This is a fallback and less secure than relying purely on mimetype.
      const ext = path.extname(file.originalname).toLowerCase();
      let allowedByExtension = false;
      if (ext === '.doc' && ALLOWED_MIME_PATTERNS_CHAT.includes('application/msword')) allowedByExtension = true;
      else if (ext === '.docx' && ALLOWED_MIME_PATTERNS_CHAT.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) allowedByExtension = true;
      else if (ext === '.xls' && ALLOWED_MIME_PATTERNS_CHAT.includes('application/vnd.ms-excel')) allowedByExtension = true;
      else if (ext === '.xlsx' && ALLOWED_MIME_PATTERNS_CHAT.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) allowedByExtension = true;
      // ... add more extension checks if needed for very generic mimetypes

      if (allowedByExtension) {
        console.warn(`File ${file.originalname} with generic mimetype ${file.mimetype} allowed based on extension ${ext}.`);
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed: ${file.mimetype} (for ${file.originalname}). Allowed types include images, PDFs, Office documents, text files, and archives.`), false); // Corrected
      }
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.get('/', (req, res) => {
  res.send(`Chat server running. File uploads will be available at ${APP_BASE_URL}/${UPLOADS_DIR_NAME}/your-file-name`); // Corrected
});

app.post('/upload', (req, res) => {
  upload.array('files', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer error:', err);
      return res.status(400).json({ error: `Upload error: ${err.message}` }); // Corrected
    } else if (err) {
      console.error('Unknown upload error:', err);
      return res.status(400).json({ error: err.message || 'Invalid file type or an unknown error occurred.' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files were uploaded or files were rejected.' });
    }

    const filesData = req.files.map(file => ({
      name: file.originalname,
      url: `${APP_BASE_URL}/${UPLOADS_DIR_NAME}/${file.filename}`, // Corrected
      type: file.mimetype,
      size: file.size
    }));
    res.json({ files: filesData }); // Client expects { files: [...] }
  });
});

const chatHistories = {};
const roomUsers = {};
const MAX_HISTORY_LENGTH = 100;

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`); // Corrected

  socket.on('join room', ({ taskId, user }) => {
    if (!taskId) {
      console.error(`join room: taskId is missing for socket ${socket.id}`); // Corrected
      socket.emit('error message', { message: 'Task ID is required to join a room.' });
      return;
    }
    if (!user || !user.auid || !user.name) {
        console.error(`join room: user data is incomplete for socket ${socket.id}`, user); // Corrected
        socket.emit('error message', { message: 'User information (AUID, Name) is required to join a room.' });
        return;
    }

    socket.userData = user;
    socket.join(taskId);
    console.log(`User ${user.name} (${socket.id}) joined task room: ${taskId}`); // Corrected

    if (!roomUsers[taskId]) {
      roomUsers[taskId] = {};
    }
    roomUsers[taskId][socket.id] = user;

    io.to(taskId).emit('user joined', { taskId, user });

    if (!chatHistories[taskId]) {
      chatHistories[taskId] = [];
    }
    socket.emit('chat history', chatHistories[taskId]);
  });

  socket.on('chat message', ({ taskId, sender, message, files }) => {
    if (!taskId) {
      console.error(`chat message: taskId is missing for socket ${socket.id}`); // Corrected
      socket.emit('error message', { message: 'Task ID is required to send a message.' });
      return;
    }
    if (!sender || !sender.auid || !sender.name) {
        console.error(`chat message: sender data is incomplete for socket ${socket.id}`, sender); // Corrected
        socket.emit('error message', { message: 'Sender information (AUID, Name) is required.' });
        return;
    }

    const msgData = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, // Corrected
      sender,
      message: message || '',
      files: files || [],
      timestamp: new Date(),
      taskId: taskId
    };

    if (!chatHistories[taskId]) {
      chatHistories[taskId] = [];
    }
    chatHistories[taskId].push(msgData);
    if (chatHistories[taskId].length > MAX_HISTORY_LENGTH) {
      chatHistories[taskId].splice(0, chatHistories[taskId].length - MAX_HISTORY_LENGTH);
    }

    io.to(taskId).emit('chat message', msgData);
    console.log(`Message to task ${taskId} by ${sender.name}:`, { message: msgData.message, files: msgData.files ? msgData.files.length : 0 }); // Corrected files access
  });

  socket.on('disconnect', () => {
    const userName = socket.userData ? socket.userData.name : 'Unknown';
    console.log(`User ${userName} (${socket.id}) disconnected`); // Corrected

    socket.rooms.forEach(room => {
      if (room !== socket.id && socket.userData) {
        io.to(room).emit('user left', { taskId: room, user: socket.userData });
        console.log(`Sent 'user left' for ${socket.userData.name} to room ${room}`); // Corrected

        if (roomUsers[room] && roomUsers[room][socket.id]) {
          delete roomUsers[room][socket.id];
          if (Object.keys(roomUsers[room]).length === 0) {
            console.log(`Task room ${room} is now empty (user list).`); // Corrected
            // Optional: delete roomUsers[room];
            // Optional: delete chatHistories[room]; // If history for empty rooms should be cleared
          }
        }
      }
    });
  });

  socket.on('error', (err) => {
    console.error(`Socket error for ${socket.id} (${socket.userData ? socket.userData.name : 'N/A'}):`, err.message); // Corrected
    socket.emit('error message', { message: `A server-side socket error occurred: ${err.message}. You might need to refresh or reconnect.` }); // Corrected
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`); // Corrected
  console.log(`App base URL is configured as: ${APP_BASE_URL}`); // Corrected
  console.log(`Static files served from ${UPLOADS_PATH} at /${UPLOADS_DIR_NAME}`); // Corrected
  console.log("Ensure your Render Disk is mounted at the UPLOADS_PATH for persistent file uploads if deploying.");
});
