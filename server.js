import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import os from "os";
import { PDFDocument } from "pdf-lib";

import db, { getSettings, updateSetting } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || "development";
const isDev = NODE_ENV === "development";
const PORT = process.env.PORT || (isDev ? 3001 : 3000);

// Path configuration
const DIST_DIR = path.join(__dirname, "dist");
const UPLOADS_DIR = path.join(__dirname, "uploads");

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
 * PDF Page Count Helper — uses pdf-lib for accurate counting.
 */

/**
 * PDF Page Count Helper — uses pdf-lib for accurate counting.
 * Handles encrypted and malformed PDFs gracefully.
 *
 * @param {string} filePath - Absolute path to the PDF file on disk.
 * @returns {Promise<number|null>} Page count, or null if the file cannot be read.
 */
const getPdfPageCount = async (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);

    // ignoreEncryption: true  — prevents a crash on password-protected PDFs
    //   (page count is still readable even for encrypted docs)
    // updateMetadata: false   — skip rewriting metadata; we only need page count
    const pdfDoc = await PDFDocument.load(fileBuffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    console.log(
      `📄 PDF page count for ${path.basename(filePath)}: ${pageCount}`,
    );
    return pageCount;
  } catch (err) {
    console.error(
      `❌ Error reading PDF page count for ${path.basename(filePath)}:`,
      err.message,
    );
    return null;
  }
};

// Backfill missing pageCount for existing PDF jobs (runs once at startup)
const backfillPageCounts = async () => {
  const pdfJobsMissingCount = db.prepare(`
    SELECT * FROM jobs 
    WHERE fileType = 'application/pdf' 
    AND (pageCount IS NULL OR pageCount = 0)
  `).all();

  if (pdfJobsMissingCount.length === 0) {
    console.log("✅ All PDF jobs already have page counts.");
    return;
  }

  console.log(
    `📚 Backfilling page counts for ${pdfJobsMissingCount.length} PDF job(s)...`,
  );

  const updateStmt = db.prepare('UPDATE jobs SET pageCount = ? WHERE id = ?');

  for (const job of pdfJobsMissingCount) {
    if (!job.serverFileName) {
      console.warn(`  ⚠️  Job ${job.id} has no serverFileName — skipping.`);
      continue;
    }
    const filePath = path.join(UPLOADS_DIR, job.serverFileName);
    if (fs.existsSync(filePath)) {
      const count = await getPdfPageCount(filePath);
      if (count !== null) {
        updateStmt.run(count, job.id);
        console.log(`  ✅ ${job.fileName}: ${count} page(s)`);
      } else {
        console.warn(
          `  ⚠️  Could not count pages for ${job.fileName} — file may be corrupted.`,
        );
      }
    } else {
      console.warn(
        `  ⚠️  File not found for job ${job.id}: ${job.serverFileName}`,
      );
    }
  }
};

// Run backfill (non-blocking — won't block server startup)
backfillPageCounts().catch((err) => console.error("❌ Backfill error:", err));

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

// Get all jobs
app.get("/api/jobs", (req, res) => {
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY uploadDate DESC').all();
  // Map SQLite flat columns back to printPreferences object for frontend compatibility
  const formattedJobs = jobs.map(job => ({
    ...job,
    printPreferences: {
      colorMode: job.colorMode,
      copies: job.copies
    }
  }));
  res.status(200).json(formattedJobs);
});

// Upload new job
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    const metadata = JSON.parse(req.body.metadata);
    const filePath = path.join(UPLOADS_DIR, req.file.filename);

    // Get page count for PDF files
    let pageCount = null;
    if (req.file.mimetype === "application/pdf") {
      pageCount = await getPdfPageCount(filePath);
    }

    const newJob = {
      ...metadata,
      serverFileName: req.file.filename,
      uploadDate: new Date().toISOString(),
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      pageCount: pageCount,
    };

    const insertStmt = db.prepare(`
      INSERT INTO jobs (
        id, customerName, phoneNumber, notes, fileName, fileType, 
        fileSize, uploadDate, status, serverFileName, pageCount, 
        colorMode, copies
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      newJob.id,
      newJob.customerName,
      newJob.phoneNumber,
      newJob.notes,
      newJob.fileName,
      newJob.fileType,
      newJob.fileSize,
      newJob.uploadDate,
      newJob.status,
      newJob.serverFileName,
      newJob.pageCount,
      newJob.printPreferences?.colorMode || 'color',
      newJob.printPreferences?.copies || 1
    );

    res.status(200).json({ success: true, job: newJob });
  } catch (err) {
    console.error("❌ Upload Error:", err);
    res.status(400).json({ success: false, error: "Invalid upload metadata" });
  }
});

// Update job file
app.post("/api/jobs/:id/file", upload.single("file"), async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);

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

    // Get page count for PDF files
    let pageCount = null;
    if (req.file.mimetype === "application/pdf") {
      const filePath = path.join(UPLOADS_DIR, req.file.filename);
      pageCount = await getPdfPageCount(filePath);
    }

    // Update job in DB
    const updateStmt = db.prepare(`
      UPDATE jobs 
      SET serverFileName = ?, fileSize = ?, fileType = ?, pageCount = ? 
      WHERE id = ?
    `);
    updateStmt.run(req.file.filename, req.file.size, req.file.mimetype, pageCount, jobId);

    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    res.status(200).json({ success: true, job: updatedJob });
  } catch (err) {
    console.error("❌ Update File Error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Update job status
app.put("/api/jobs/:id/status", (req, res) => {
  const { status } = req.body;
  const jobId = req.params.id;
  
  const result = db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, jobId);

  if (result.changes > 0) {
    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    res.status(200).json({ success: true, job: updatedJob });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

// Update job print preferences (colorMode, copies)
app.put("/api/jobs/:id/preferences", (req, res) => {
  const jobId = req.params.id;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  
  if (!job) {
    return res.status(404).json({ success: false, error: "Job not found" });
  }

  const { colorMode, copies } = req.body;
  let finalColorMode = job.colorMode;
  let finalCopies = job.copies;

  if (colorMode === "color" || colorMode === "blackWhite") {
    finalColorMode = colorMode;
  }

  const parsedCopies = parseInt(copies, 10);
  if (!isNaN(parsedCopies) && parsedCopies >= 1 && parsedCopies <= 100) {
    finalCopies = parsedCopies;
  }

  db.prepare('UPDATE jobs SET colorMode = ?, copies = ? WHERE id = ?')
    .run(finalColorMode, finalCopies, jobId);

  const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  console.log(
    `✏️  Updated preferences for job ${jobId}: ${finalColorMode}, ${finalCopies} cop(ies)`,
  );
  res.status(200).json({ 
    success: true, 
    job: {
      ...updatedJob,
      printPreferences: { colorMode: finalColorMode, copies: finalCopies }
    } 
  });
});

// Delete job
app.delete("/api/jobs/:id", (req, res) => {
  const jobId = req.params.id;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);

  if (job) {
    const filePath = path.join(UPLOADS_DIR, job.serverFileName);

    // Delete physical file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.warn("⚠️  Could not delete physical file:", filePath);
    }

    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
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
  res.status(200).json(getSettings());
});

// Update settings
app.post("/api/settings", (req, res) => {
  try {
    if (req.body.shopName !== undefined) {
      updateSetting('shopName', req.body.shopName);
    }
    if (req.body.pricing && typeof req.body.pricing === "object") {
      const currentSettings = getSettings();
      const newPricing = {
        colorPerPage:
          parseFloat(req.body.pricing.colorPerPage) ||
          currentSettings.pricing?.colorPerPage ||
          30.0,
        blackWhitePerPage:
          parseFloat(req.body.pricing.blackWhitePerPage) ||
          currentSettings.pricing?.blackWhitePerPage ||
          15.0,
      };
      updateSetting('pricing', newPricing);
    }
    // Also support general setting updates if passed
    if (req.body.discounts !== undefined) {
      updateSetting('discounts', req.body.discounts);
    }

    res.status(200).json({ success: true, settings: getSettings() });
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

    const settings = getSettings();
    // Delete old logo
    if (settings.logoUrl) {
      const oldFilename = settings.logoUrl.split("/").pop();
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
    updateSetting('logoUrl', logoUrl);
    res.status(200).json({ success: true, logoUrl });
  } catch (err) {
    console.error("❌ Logo upload error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get local IP address
app.get("/api/local-ip", (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    let ips = [];

    // Collect all non-internal IPv4 addresses with interface names
    for (const name of Object.keys(interfaces)) {
      const networkInterface = interfaces[name];
      if (networkInterface) {
        for (const interfaceInfo of networkInterface) {
          if (interfaceInfo.family === "IPv4" && !interfaceInfo.internal) {
            ips.push({
              address: interfaceInfo.address,
              interface: name,
              isWifi:
                name.toLowerCase().includes("wi-fi") ||
                name.toLowerCase().includes("wlan"),
              isEthernet:
                name.toLowerCase().includes("ethernet") ||
                name.toLowerCase().includes("eth"),
            });
          }
        }
      }
    }

    console.log("🔍 Available network interfaces:", ips);

    let selectedIP = null;

    // Priority 1: Prefer IPs with common gateway patterns (.1.90, .1.100, .0.1, .1.1)
    const commonPatterns = [".1.90", ".1.100", ".0.1", ".1.1"];
    for (const pattern of commonPatterns) {
      const patternIP = ips.find((ip) => ip.address.endsWith(pattern));
      if (patternIP) {
        selectedIP = patternIP.address;
        console.log("✅ Selected common pattern IP:", selectedIP);
        break;
      }
    }

    // Priority 2: Look for WiFi interfaces (most common for mobile access)
    if (!selectedIP) {
      const wifiIP = ips.find(
        (ip) => ip.isWifi && ip.address.startsWith("192.168."),
      );
      if (wifiIP) {
        selectedIP = wifiIP.address;
        console.log("✅ Selected WiFi IP:", selectedIP);
      }
    }

    // Priority 3: Look for Ethernet interfaces
    if (!selectedIP) {
      const ethernetIP = ips.find(
        (ip) => ip.isEthernet && ip.address.startsWith("192.168."),
      );
      if (ethernetIP) {
        selectedIP = ethernetIP.address;
        console.log("✅ Selected Ethernet IP:", selectedIP);
      }
    }

    // Priority 4: Any 192.168.x.x address
    if (!selectedIP) {
      const lanIP = ips.find((ip) => ip.address.startsWith("192.168."));
      if (lanIP) {
        selectedIP = lanIP.address;
        console.log("✅ Selected first LAN IP:", selectedIP);
      }
    }

    // Priority 5: Any non-internal IP
    if (!selectedIP && ips.length > 0) {
      selectedIP = ips[0].address;
      console.log("✅ Selected first available IP:", selectedIP);
    }

    // Fallback to localhost
    if (!selectedIP) {
      selectedIP = "localhost";
      console.log("⚠️  Fallback to localhost");
    }

    console.log("🌐 Final selected IP:", selectedIP);
    res.status(200).json({ ip: selectedIP });
  } catch (err) {
    console.error("❌ Error getting local IP:", err);
    res.status(500).json({ error: "Failed to get local IP" });
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
  console.log(`💾 SQLite database: ${path.join(__dirname, 'database.sqlite')}\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n⏹️  SIGTERM received, shutting down gracefully...");
  db.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n⏹️  SIGINT received, shutting down gracefully...");
  db.close();
  process.exit(0);
});
