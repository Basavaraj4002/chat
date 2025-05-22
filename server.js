 const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // To ensure the uploads directory exists

// --- Configuration ---
const PORT = process.env.PORT || 3001; // Use environment variable for port or default
// IMPORTANT: Set this environment variable on your Render service!
// e.g., https://your-app-name.onrender.com
const APP_BASE_URL = process.env.APP_BASE_URL || http://localhost:${PORT};
const UPLOADS_DIR_NAME = 'uploads'; // Name of the directory for chat file uploads
const UPLOADS_PATH = path.join(__dirname, UPLOADS_DIR_NAME); // Absolute path to uploads

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_PATH)) {
  fs.mkdirSync(UPLOADS_PATH, { recursive: true });
  console.log(Created uploads directory at ${UPLOADS_PATH});
} else {
  console.log(Uploads directory already exists at ${UPLOADS_PATH});
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*', // Allow specific origin or all
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Serve uploaded files as static assets FROM THE CORRECT PATH
// The URL path will be /uploads/filename.jpg (or whatever UPLOADS_DIR_NAME is)
app.use(/${UPLOADS_DIR_NAME}, express.static(UPLOADS_PATH));

// Configure Multer for file uploads (for chat attachments)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_PATH); // Save to the absolute path
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent path traversal and other issues
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, ${Date.now()}-${safeOriginalName});
  }
});

// Allowed MIME types from client's handleFileSelection
const ALLOWED_MIME_PATTERNS_CHAT = [
    'image/', // Covers jpg, png, gif, webp, bmp, svg
    'application/pdf',
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-powerpoint', // .ppt
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'text/plain', // .txt
    'application/zip',
    'application/x-rar-compressed' // .rar
];

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_PATTERNS_CHAT.some(pattern => file.mimetype.startsWith(pattern))) {
      cb(null, true);
    } else {
      cb(new Error(File type not allowed: ${file.mimetype}. Allowed types include images, PDFs, Office documents, text files, and archives.), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit (consistent with client)
  }
});

app.get('/', (req, res) => {
  res.send(Chat server running. File uploads will be available at ${APP_BASE_URL}/${UPLOADS_DIR_NAME}/your-file-name);
});

// API route for file uploads (for chat)
app.post('/upload', (req, res) => {
  // Assuming client sends 'files' as the field name for multiple files
  upload.array('files', 5)(req, res, (err) => { // Max 5 files, can be adjusted
    if (err instanceof multer.MulterError) {
      console.error('Multer error:', err);
      return res.status(400).json({ error: Upload error: ${err.message} });
    } else if (err) {
      console.error('Unknown upload error:', err);
      return res.status(400).json({ error: err.message || 'Invalid file type or an unknown error occurred.' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files were uploaded or files were rejected.' });
    }

    const filesData = req.files.map(file => ({
      name: file.originalname,
      url: ${APP_BASE_URL}/${UPLOADS_DIR_NAME}/${file.filename}, // Absolute URL
      type: file.mimetype,
      size: file.size
    }));
    // Client expects response in { files: [...] } structure
    res.json({ files: filesData });
  });
});

// --- In-memory store for chat histories and user data in rooms ---
const chatHistories = {}; // { taskId: [messageObject, ...] }
const roomUsers = {};     // { taskId: { socketId: userData, ... } }
const MAX_HISTORY_LENGTH = 100; // Keep last 100 messages per room

io.on('connection', (socket) => {
  console.log(A user connected: ${socket.id});

  socket.on('join room', ({ taskId, user }) => {
    if (!taskId) {
      console.error(join room: taskId is missing for socket ${socket.id});
      socket.emit('error message', { message: 'Task ID is required to join a room.' });
      return;
    }
    if (!user || !user.auid || !user.name) {
        console.error(join room: user data is incomplete for socket ${socket.id}, user);
        socket.emit('error message', { message: 'User information (AUID, Name) is required to join a room.' });
        return;
    }

    // Store user data on the socket for easy access on disconnect
    socket.userData = user;
    // Store current room for simplified disconnect logic if user is only in one "active" chat
    // socket.currentRoomId = taskId; // This might be an oversimplification if client allows multiple bg rooms

    socket.join(taskId);
    console.log(User ${user.name} (${socket.id}) joined task room: ${taskId});

    // Add user to roomUsers list
    if (!roomUsers[taskId]) {
      roomUsers[taskId] = {};
    }
    roomUsers[taskId][socket.id] = user;

    // Notify others in the room
    // socket.to(taskId).emit('user joined', { taskId, user }); // Emit to others in the room
    // The client JS checks if the joined user is not the current user before showing system message.
    // So, broadcasting to all including self, and client handles it.
    io.to(taskId).emit('user joined', { taskId, user });


    // Initialize chat history for the room if it doesn't exist
    if (!chatHistories[taskId]) {
      chatHistories[taskId] = [
        // { id: sys-${Date.now()}, sender: { name: 'System' }, message: Welcome to task ${taskId}!, timestamp: new Date(), files: [], taskId: taskId, system: true }
      ]; // Start with empty or a system welcome message
    }
    socket.emit('chat history', chatHistories[taskId]);
  });

  socket.on('chat message', ({ taskId, sender, message, files }) => {
    if (!taskId) {
      console.error(chat message: taskId is missing for socket ${socket.id});
      socket.emit('error message', { message: 'Task ID is required to send a message.' });
      return;
    }
    if (!sender || !sender.auid || !sender.name) {
        console.error(chat message: sender data is incomplete for socket ${socket.id}, sender);
        socket.emit('error message', { message: 'Sender information (AUID, Name) is required.' });
        return;
    }

    const msgData = {
      id: msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}, // Unique message ID
      sender, // This is the facultyInfo object from client
      message: message || '', // Ensure message is at least an empty string
      files: files || [], // Ensure files is an array
      timestamp: new Date(),
      taskId: taskId
    };

    // Store message in history
    if (!chatHistories[taskId]) {
      chatHistories[taskId] = [];
    }
    chatHistories[taskId].push(msgData);
    if (chatHistories[taskId].length > MAX_HISTORY_LENGTH) {
      chatHistories[taskId].splice(0, chatHistories[taskId].length - MAX_HISTORY_LENGTH);
    }

    // Emit to everyone in the room including the sender
    io.to(taskId).emit('chat message', msgData);
    console.log(Message to task ${taskId} by ${sender.name}:, { message: msgData.message, files: msgData.files.length });
  });

  socket.on('disconnect', () => {
    const userName = socket.userData ? socket.userData.name : 'Unknown';
    console.log(User ${userName} (${socket.id}) disconnected);

    socket.rooms.forEach(room => {
      if (room !== socket.id && socket.userData) { // room is a taskId
        io.to(room).emit('user left', { taskId: room, user: socket.userData });
        console.log(Sent 'user left' for ${socket.userData.name} to room ${room});

        // Clean up from roomUsers
        if (roomUsers[room] && roomUsers[room][socket.id]) {
          delete roomUsers[room][socket.id];
          if (Object.keys(roomUsers[room]).length === 0) {
            console.log(Task room ${room} is now empty (user list).);
            // delete roomUsers[room]; // If you want to remove the room entry from roomUsers entirely
            // Decide if chat history for an empty room should be cleared
            // delete chatHistories[room]; // Uncomment to clear history when room becomes empty
          }
        }
      }
    });
  });

  // General socket error
  socket.on('error', (err) => {
    console.error(Socket error for ${socket.id} (${socket.userData ? socket.userData.name : 'N/A'}):, err.message);
    // Optionally, inform the client if the error is critical for their session
    socket.emit('error message', { message: A server-side socket error occurred: ${err.message}. You might need to refresh or reconnect. });
  });
});

server.listen(PORT, () => {
  console.log(Server is running on port ${PORT});
  console.log(App base URL is configured as: ${APP_BASE_URL});
  console.log(Static files served from ${UPLOADS_PATH} at /${UPLOADS_DIR_NAME});
});
