import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Path configuration
const UPLOADS_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(__dirname, "db.json");

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

/**
 * DATABASE PERSISTENCE LAYER
 */
let dbCache = {
  jobs: [],
  settings: { shopName: "PrintShop Hub", logoUrl: null },
};

const saveDB = () => {
  try {
    const data = JSON.stringify(dbCache, null, 2);
    fs.writeFileSync(DB_FILE, data, "utf-8");
  } catch (err) {
    console.error("Failed to save DB:", err);
  }
};

const loadDB = () => {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      if (data.trim()) {
        dbCache = JSON.parse(data);
      }
    } else {
      saveDB();
    }
  } catch (err) {
    console.error("Failed to load DB, using defaults:", err);
    saveDB();
  }
};

loadDB();

app.use(express.json({ limit: "50mb" }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// API Routes
app.get("/api/jobs", (req, res) => {
  res.status(200).json(dbCache.jobs || []);
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) throw new Error("No file uploaded");
    const metadata = JSON.parse(req.body.metadata);
    const newJob = {
      ...metadata,
      serverFileName: req.file.filename,
      uploadDate: new Date().toISOString(),
    };

    dbCache.jobs.push(newJob);
    saveDB();
    res.status(200).json({ success: true, job: newJob });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(400).json({ success: false, error: "Invalid upload metadata" });
  }
});

// Update an existing job's file (Replacing the original)
app.post("/api/jobs/:id/file", upload.single("file"), (req, res) => {
  try {
    const jobId = req.params.id;
    const job = dbCache.jobs.find((j) => j.id === jobId);

    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    // Delete the old file from disk
    if (job.serverFileName) {
      const oldPath = path.join(UPLOADS_DIR, job.serverFileName);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (e) {
          console.warn("Could not delete old file:", oldPath);
        }
      }
    }

    // Update job metadata with new file info
    job.serverFileName = req.file.filename;
    job.fileSize = req.file.size;
    job.fileType = req.file.mimetype;

    saveDB();
    res.status(200).json({ success: true, job });
  } catch (err) {
    console.error("Update File Error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.put("/api/jobs/:id/status", (req, res) => {
  const { status } = req.body;
  const job = dbCache.jobs.find((j) => j.id === req.params.id);
  if (job) {
    job.status = status;
    saveDB();
    res.status(200).json({ success: true });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

app.delete("/api/jobs/:id", (req, res) => {
  const index = dbCache.jobs.findIndex((j) => j.id === req.params.id);
  if (index !== -1) {
    const job = dbCache.jobs[index];
    const filePath = path.join(UPLOADS_DIR, job.serverFileName);

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.warn("Could not delete physical file:", filePath);
    }

    dbCache.jobs.splice(index, 1);
    saveDB();
    res.status(200).json({ success: true });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

app.get("/api/files/:filename", (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

app.get("/api/settings", (req, res) => {
  res.status(200).json(dbCache.settings);
});

app.post("/api/settings", (req, res) => {
  dbCache.settings.shopName = req.body.shopName || dbCache.settings.shopName;
  saveDB();
  res.status(200).json({ success: true });
});

// Logo Upload Route
app.post("/api/settings/logo", upload.single("logo"), (req, res) => {
  try {
    if (!req.file) throw new Error("No file uploaded");

    // Delete old logo if exists
    if (dbCache.settings.logoUrl) {
      const oldFilename = dbCache.settings.logoUrl.split("/").pop();
      const oldPath = path.join(UPLOADS_DIR, oldFilename);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (e) {}
      }
    }

    const logoUrl = `/api/files/${req.file.filename}`;
    dbCache.settings.logoUrl = logoUrl;
    saveDB();
    res.status(200).json({ success: true, logoUrl });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Serve static files
app.use(express.static(__dirname));

// Final Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// BEST - explicit catch-all for SPA routing
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

// Explicitly bind to 0.0.0.0 to allow access from other devices on the network
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
