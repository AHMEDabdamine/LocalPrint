import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || "development";
const isDev = NODE_ENV === "development";
const PORT = process.env.PORT || (isDev ? 3001 : 3000);

// Path configuration
const DIST_DIR = path.join(__dirname, "dist");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(__dirname, "db.json");

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for development (allow frontend on different port)
if (isDev) {
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "http://localhost:5173");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DIST_DIR) && !isDev) {
  console.warn("⚠️  DIST_DIR does not exist. Run build first!");
}

/**
 * DATABASE PERSISTENCE LAYER
 */
let dbCache = {
  jobs: [],
  settings: {
    shopName: "PrintShop Hub",
    logoUrl: null,
    pricing: {
      colorPerPage: 10.0,
      blackWhitePerPage: 8.0,
    },
    discounts: {
      enabled: false,
      allowStacking: false,
      maxDiscount: null,
      rules: [],
    },
  },
};

const saveDB = () => {
  try {
    const data = JSON.stringify(dbCache, null, 2);
    console.log("💾 Saving database with data:", data);
    fs.writeFileSync(DB_FILE, data, "utf-8");
    console.log("✅ Database saved successfully to:", DB_FILE);
  } catch (err) {
    console.error("❌ Failed to save DB:", err);
  }
};

const loadDB = () => {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      if (data.trim()) {
        dbCache = JSON.parse(data);
        console.log("✅ Database loaded successfully");

        // Migration: Ensure pricing and discounts exist
        let needsSave = false;

        if (!dbCache.settings.pricing) {
          dbCache.settings.pricing = {
            colorPerPage: 10.0,
            blackWhitePerPage: 8.0,
          };
          needsSave = true;
          console.log("🔄 Added default pricing settings");
        }

        if (!dbCache.settings.discounts) {
          dbCache.settings.discounts = {
            enabled: false,
            allowStacking: false,
            maxDiscount: null,
            rules: [],
          };
          needsSave = true;
          console.log("🔄 Added default discount settings");
        }

        if (needsSave) {
          saveDB();
          console.log("✅ Database migration completed");
        }
      }
    } else {
      saveDB();
      console.log("✅ New database created");
    }
  } catch (err) {
    console.error("❌ Failed to load DB, using defaults:", err);
    saveDB();
  }
};

loadDB();

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Add file type validation if needed
    cb(null, true);
  },
});

/**
 * API ROUTES
 */

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Get local IP address
app.get("/api/local-ip", (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    let localIP = "localhost";

    // Find first non-internal IPv4 address
    for (const interfaceName of Object.keys(interfaces)) {
      const interfaceInfo = interfaces[interfaceName];
      if (interfaceInfo) {
        for (const iface of interfaceInfo) {
          if (iface.family === "IPv4" && !iface.internal) {
            localIP = iface.address;
            break;
          }
        }
        if (localIP !== "localhost") break;
      }
    }

    res.status(200).json({ ip: localIP });
  } catch (error) {
    console.error("Error getting local IP:", error);
    res.status(500).json({ ip: "localhost" });
  }
});

// Get all jobs
app.get("/api/jobs", (req, res) => {
  res.status(200).json(dbCache.jobs || []);
});

// Upload new job
app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    const metadata = JSON.parse(req.body.metadata);
    const newJob = {
      ...metadata,
      serverFileName: req.file.filename,
      uploadDate: new Date().toISOString(),
      fileSize: req.file.size,
      fileType: req.file.mimetype,
    };

    dbCache.jobs.push(newJob);
    saveDB();
    res.status(200).json({ success: true, job: newJob });
  } catch (err) {
    console.error("❌ Upload Error:", err);
    res.status(400).json({ success: false, error: "Invalid upload metadata" });
  }
});

// Update job file
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

    // Delete old file
    if (job.serverFileName) {
      const oldPath = path.join(UPLOADS_DIR, job.serverFileName);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (e) {
          console.warn("⚠️  Could not delete old file:", oldPath);
        }
      }
    }

    // Update job
    job.serverFileName = req.file.filename;
    job.fileSize = req.file.size;
    job.fileType = req.file.mimetype;

    saveDB();
    res.status(200).json({ success: true, job });
  } catch (err) {
    console.error("❌ Update File Error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Update job status
app.put("/api/jobs/:id/status", (req, res) => {
  const { status } = req.body;
  const job = dbCache.jobs.find((j) => j.id === req.params.id);

  if (job) {
    job.status = status;
    saveDB();
    res.status(200).json({ success: true, job });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

// Delete job
app.delete("/api/jobs/:id", (req, res) => {
  const index = dbCache.jobs.findIndex((j) => j.id === req.params.id);

  if (index !== -1) {
    const job = dbCache.jobs[index];
    const filePath = path.join(UPLOADS_DIR, job.serverFileName);

    // Delete physical file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.warn("⚠️  Could not delete physical file:", filePath);
    }

    dbCache.jobs.splice(index, 1);
    saveDB();
    res.status(200).json({ success: true });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

// Download/view file
app.get("/api/files/:filename", (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// Get settings
app.get("/api/settings", (req, res) => {
  // Migration: Ensure pricing and discounts exist
  let needsSave = false;

  if (!dbCache.settings.pricing) {
    dbCache.settings.pricing = {
      colorPerPage: 10.0,
      blackWhitePerPage: 8.0,
    };
    needsSave = true;
    console.log("🔄 Added default pricing settings");
  }

  if (!dbCache.settings.discounts) {
    dbCache.settings.discounts = {
      enabled: false,
      allowStacking: false,
      maxDiscount: null,
      rules: [],
    };
    needsSave = true;
    console.log("🔄 Added default discount settings");
  }

  if (needsSave) {
    saveDB();
    console.log("✅ Database migration completed");
  }

  res.status(200).json(dbCache.settings);
});

// Update settings
app.post("/api/settings", (req, res) => {
  try {
    // Update shop name
    if (req.body.shopName !== undefined) {
      dbCache.settings.shopName = req.body.shopName;
    }

    // Update pricing
    if (req.body.pricing !== undefined) {
      dbCache.settings.pricing = req.body.pricing;
    }

    // Update discounts
    if (req.body.discounts !== undefined) {
      dbCache.settings.discounts = req.body.discounts;
    }

    // Update logo URL if provided
    if (req.body.logoUrl !== undefined) {
      dbCache.settings.logoUrl = req.body.logoUrl;
    }

    saveDB();
    res.status(200).json({ success: true, settings: dbCache.settings });
  } catch (err) {
    console.error("❌ Settings update error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update settings" });
  }
});

// Upload logo
app.post("/api/settings/logo", upload.single("logo"), (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    // Delete old logo
    if (dbCache.settings.logoUrl) {
      const oldFilename = dbCache.settings.logoUrl.split("/").pop();
      const oldPath = path.join(UPLOADS_DIR, oldFilename);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (e) {
          console.warn("⚠️  Could not delete old logo");
        }
      }
    }

    const logoUrl = `/api/files/${req.file.filename}`;
    dbCache.settings.logoUrl = logoUrl;
    saveDB();
    res.status(200).json({ success: true, logoUrl });
  } catch (err) {
    console.error("❌ Logo upload error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * STATIC FILE SERVING & SPA ROUTING
 */

// Serve static files in production
if (!isDev) {
  app.use(
    express.static(DIST_DIR, {
      maxAge: "1d", // Cache static assets for 1 day
      etag: true,
    }),
  );
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", err.stack);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: isDev ? err.message : "Internal Server Error",
    });
  }
});

// SPA fallback (must be last)
if (!isDev) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "API endpoint not found" });
    }
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

/**
 * SERVER STARTUP
 */
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log("\n🚀 Server started successfully!");
  console.log(`📦 Environment: ${NODE_ENV}`);
  console.log(`🌐 Server URL: http://${HOST}:${PORT}`);

  if (isDev) {
    console.log(`🔧 Development mode - CORS enabled for http://localhost:5173`);
    console.log(`💡 Frontend should run on port 5173 (Vite default)`);
  } else {
    console.log(`📁 Serving static files from: ${DIST_DIR}`);
  }

  console.log(`📂 Uploads directory: ${UPLOADS_DIR}`);
  console.log(`💾 Database file: ${DB_FILE}\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n⏹️  SIGTERM received, shutting down gracefully...");
  saveDB();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n⏹️  SIGINT received, shutting down gracefully...");
  saveDB();
  process.exit(0);
});
