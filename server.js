 const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
require('dotenv').config(); // Load environment variables

const PORT = process.env.PORT || 3000;
const APP_BASE_URL =
  process.env.NODE_ENV === 'production'
    ? 'https://chat-1-fnv7.onrender.com'
    : `http://localhost:${PORT}`;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('uploads')); // Serve uploaded files as static assets

// Configure Multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`); // Unique filename
    }
  }),
  fileFilter: (req, file, cb) => {
    // Accept only images and PDFs
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDFs are allowed.'));
    }
  }
});

app.get('/', (req, res) => {
  res.send('Chat server running...');
});

// API route for file uploads
app.post('/upload', upload.array('files'), (req, res) => {
  const files = req.files.map(file => ({
    name: file.originalname,
    url: `${APP_BASE_URL}/${file.filename}`,
    type: file.mimetype,
    size: file.size
  }));
  res.json(files);
});

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('joinTask', (taskId) => {
    socket.join(taskId);
    console.log(`User joined task: ${taskId}`);

    // Send dummy previous messages
    socket.emit('previousMessages', [
      { sender: 'faculty', message: 'Welcome to the task chat!', timestamp: new Date() }
    ]);
  });

  socket.on('sendMessage', ({ taskId, sender, message, files }) => {
    const msgData = {
      sender,
      message,
      files: files || [], // Include files if provided
      timestamp: new Date()
    };

    io.to(taskId).emit('newMessage', msgData);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on ${APP_BASE_URL}`);
});
