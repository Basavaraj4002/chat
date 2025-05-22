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
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const UPLOADS_DIR_NAME = 'uploads'; // Name of the directory
const UPLOADS_PATH = path.join(__dirname, UPLOADS_DIR_NAME); // Absolute path to uploads

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_PATH)) {
  fs.mkdirSync(UPLOADS_PATH, { recursive: true });
  console.log(`Created uploads directory at ${UPLOADS_PATH}`);
} else {
  console.log(`Uploads directory already exists at ${UPLOADS_PATH}`);
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
// The URL path will be /uploads/filename.jpg
app.use(`/${UPLOADS_DIR_NAME}`, express.static(UPLOADS_PATH));

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_PATH); // Save to the absolute path
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent path traversal and other issues
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, `${Date.now()}-${safeOriginalName}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDFs are allowed.'), false); // Pass false for rejection
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit
  }
});

app.get('/', (req, res) => {
  res.send(`Chat server running. File uploads will be available at ${APP_BASE_URL}/${UPLOADS_DIR_NAME}/your-file-name`);
});

// API route for file uploads
// Added error handling for Multer
app.post('/upload', (req, res) => {
  upload.array('files', 5)(req, res, (err) => { // Max 5 files
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading.
      console.error('Multer error:', err);
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      // An unknown error occurred when uploading (e.g., fileFilter error).
      console.error('Unknown upload error:', err);
      return res.status(400).json({ error: err.message || 'Invalid file type or an unknown error occurred.' });
    }

    // If `req.files` is undefined or empty, it means no files were processed
    // This can happen if fileFilter rejected all files or no files were sent.
    if (!req.files || req.files.length === 0) {
        // Check if an error was set by fileFilter but not caught as MulterError
        if (req.fileValidationError) {
            return res.status(400).json({ error: req.fileValidationError });
        }
        return res.status(400).json({ error: 'No files were uploaded or files were rejected.' });
    }

    const filesData = req.files.map(file => ({
      name: file.originalname,
      // Use APP_BASE_URL for constructing the public URL
      url: `${APP_BASE_URL}/${UPLOADS_DIR_NAME}/${file.filename}`,
      type: file.mimetype,
      size: file.size
    }));
    res.json(filesData);
  });
});

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.on('joinTask', (taskId) => {
    socket.join(taskId);
    console.log(`User ${socket.id} joined task: ${taskId}`);

    // Send dummy previous messages (in a real app, fetch from DB)
    socket.emit('previousMessages', [
      { id: `msg-${Date.now()}`, sender: 'System', message: `Welcome to task ${taskId}!`, timestamp: new Date(), files: [] }
    ]);
  });

  socket.on('sendMessage', ({ taskId, sender, message, files }) => {
    const msgData = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, // Unique message ID
      sender,
      message,
      files: files || [],
      timestamp: new Date()
    };

    // Emit to everyone in the room including the sender
    io.to(taskId).emit('newMessage', msgData);
    console.log(`Message to task ${taskId}:`, msgData);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`App base URL is configured as: ${APP_BASE_URL}`);
  console.log(`Static files served from ${UPLOADS_PATH} at /${UPLOADS_DIR_NAME}`);
});
