 const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const fs = require("fs");

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Serve uploaded files statically
app.use("/uploads", express.static(uploadsDir));

// Multer setup for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// Set base URL dynamically
const APP_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://chat-1-fnv7.onrender.com"
    : http://localhost:${PORT};

// Upload endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const fileUrl = ${APP_BASE_URL}/uploads/${req.file.filename};
  res.status(200).json({ url: fileUrl });
});

// Start the server
app.listen(PORT, () => {
  console.log(🚀 Server running at ${APP_BASE_URL});
});
