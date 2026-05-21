# PrintShop Hub

A local print shop management web application built with React 19, TypeScript, and Vite on the frontend, and Express 5 with SQLite on the backend. Supports bilingual Arabic/English interface, file upload with automatic PDF page counting, dynamic pricing with discount rules, Gmail email-to-print integration, and a full admin dashboard.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Scripts](#scripts)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Database](#database)
- [Authentication](#authentication)
- [i18n](#i18n)
- [Gmail Integration](#gmail-integration)
- [Deployment](#deployment)
- [Docker](#docker)
- [Project Structure](#project-structure)

---

## Features

- **File Upload** -- Drag-and-drop or click to upload PDF, DOCX, XLSX, XLS, PPTX, PPT, JPEG, PNG files. 50 MB limit per file.
- **PDF Page Counting** -- Automatic page count extraction using pdf-lib with graceful handling of encrypted PDFs.
- **Dynamic Pricing** -- Per-page pricing based on paper type (normal, glossy, cardboard, etc.) and color mode (color or black-and-white).
- **Discount Rules Engine** -- Create discount rules with percentage or fixed amount, conditions on page count or total amount, priority ordering, and maximum cap.
- **Admin Dashboard** -- Manage jobs (status updates, delete, preview), configure shop settings (name, logo, paper types, pricing), manage discount rules, change admin password.
- **Gmail Email-to-Print** -- Connect a Gmail account via OAuth 2.0, poll for unread emails with print-ready attachments, import them as print jobs, and send automated replies.
- **Image Editor** -- Crop and perspective-cut images directly in the browser before submitting.
- **QR Code Access** -- Displays a QR code pointing to the local server URL for easy mobile access.
- **Keyboard Shortcuts** -- Ctrl+K for admin login, Ctrl+U for upload page, Escape to go back.
- **Bilingual Interface** -- Full Arabic and English support with RTL layout switching.

---

## Tech Stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Frontend   | React 19, TypeScript, Vite 6                        |
| Styling    | Tailwind CSS 3 (via npm), shadcn/ui components      |
| Backend    | Express 5 (ESM)                                     |
| Database   | SQLite via better-sqlite3 (WAL mode)                |
| PDF        | pdf-lib                                             |
| Auth       | scrypt password hashing, Google OAuth 2.0           |
| File Upload| Multer                                              |
| QR Code    | qrcode                                              |
| Icons      | lucide-react                                        |

---

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode (frontend on port 5000, backend on port 3001)
npm run dev

# Build for production
npm run build

# Run in production mode (serves built frontend + API on port 3000)
npm start
```

### Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

```
NODE_ENV=development
PORT=3001
GMAIL_REDIRECT_URI=http://localhost:3001/api/gmail/callback
```

In development, the Vite dev server proxies `/api` requests to `localhost:3001`, so you only need to access `http://localhost:5000`.

---

## Scripts

| Script        | Description                                          |
|---------------|------------------------------------------------------|
| `npm run dev`   | Run both Vite (port 5000) and Express (port 3001) concurrently |
| `npm run build` | Build the frontend with Vite to `dist/`               |
| `npm start`     | Production server: serves `dist/` + API on port 3000  |
| `npm run frontend` | Run Vite dev server only                           |
| `npm run backend`  | Run Express server only                            |
| `npm run server`   | Run Express server only (alias for backend)         |

---

## Configuration

### Default Admin Password

The default admin password is `admin123`. On first login attempt, it is hashed using scrypt and stored in the `settings` table. Change it from the admin dashboard Settings tab.

### Paper Types

Three default paper types are seeded on first run:

| Name (EN) | Name (AR) | Color (per page) | B&W (per page) |
|-----------|-----------|-------------------|-----------------|
| Normal    | عادي      | 30 DZD            | 15 DZD          |
| Glossy    | لامع      | 50 DZD            | 50 DZD          |
| Cardboard | كرتون     | 40 DZD            | 40 DZD          |

Paper types can be managed from the admin dashboard Settings tab.

### Discount Rules

Discount rules support:
- **Discount type**: `percent` (percentage off) or `fixed` (fixed amount off)
- **Condition type**: `pages` (threshold on page count) or `amount` (threshold on total amount)
- **Priority**: Rules are ordered by priority; higher priority rules apply first
- **Max cap**: Optional maximum discount amount for percentage rules

---

## API Reference

All API routes are prefixed with `/api`.

### Health & Network

| Method | Route          | Description                              |
|--------|----------------|------------------------------------------|
| GET    | `/api/health`    | Health check with status, env, timestamp |
| GET    | `/api/local-ip`  | Local network IP for QR code generation  |

### Jobs

| Method | Route                  | Description                              |
|--------|------------------------|------------------------------------------|
| GET    | `/api/jobs`              | List all jobs, ordered by upload date descending |
| POST   | `/api/upload`            | Upload a file with JSON metadata (multipart/form-data) |
| POST   | `/api/jobs/:id/file`     | Replace file for an existing job          |
| PUT    | `/api/jobs/:id/status`   | Update job status (PENDING, READY, PRINTED) |
| PUT    | `/api/jobs/:id/preferences` | Update colorMode, copies, paperType    |
| DELETE | `/api/jobs/:id`          | Delete a job and its file                 |
| GET    | `/api/files/*`           | Serve uploaded files                      |

### Settings

| Method | Route               | Description                              |
|--------|---------------------|------------------------------------------|
| GET    | `/api/settings`       | Get all settings including paper types    |
| POST   | `/api/settings`       | Update shop name, paper types, pricing, discounts |
| POST   | `/api/settings/logo`  | Upload a new shop logo                   |
| POST   | `/api/settings/password` | Change admin password                  |

### Authentication

| Method | Route               | Description                              |
|--------|---------------------|------------------------------------------|
| POST   | `/api/auth/verify`    | Verify admin password                     |

### Discount Rules

| Method | Route                        | Description                |
|--------|------------------------------|----------------------------|
| GET    | `/api/discount-rules`          | List all discount rules     |
| GET    | `/api/discount-rules/active`   | List active discount rules  |
| POST   | `/api/discount-rules`          | Create a discount rule      |
| PUT    | `/api/discount-rules/:id`      | Update a discount rule      |
| DELETE | `/api/discount-rules/:id`      | Delete a discount rule      |

### Paper Types

| Method | Route                  | Description              |
|--------|------------------------|--------------------------|
| GET    | `/api/paper-types`       | List all paper types      |
| POST   | `/api/paper-types`       | Create a paper type       |
| PUT    | `/api/paper-types/:id`   | Update a paper type       |
| DELETE | `/api/paper-types/:id`   | Delete a paper type       |

### Gmail

| Method | Route                            | Description                              |
|--------|----------------------------------|------------------------------------------|
| GET    | `/api/gmail/status`                | Gmail connection status                  |
| GET    | `/api/gmail/auth`                  | Get OAuth authorization URL              |
| GET    | `/api/gmail/callback`              | OAuth callback handler                   |
| POST   | `/api/gmail/disconnect`            | Disconnect Gmail and stop polling        |
| POST   | `/api/gmail/poll`                  | Manually trigger a poll cycle            |
| GET    | `/api/gmail/poll-status`           | Polling health (last polled, is polling) |
| GET    | `/api/gmail/pending`               | List pending emails                      |
| POST   | `/api/gmail/import`                | Import selected email attachments as jobs|
| DELETE | `/api/gmail/pending/:id`           | Discard a pending email                  |
| POST   | `/api/gmail/pending/:id/restore`   | Restore a discarded pending email        |
| GET    | `/api/gmail/attachment/:pendingId/:index` | Fetch attachment data (rate limited)|
| GET    | `/api/gmail/settings`              | Get Gmail OAuth settings                 |
| POST   | `/api/gmail/settings`              | Save Gmail OAuth settings                |

---

## Architecture

```
Browser --> Vite Dev Server (port 5000) --> Proxy /api --> Express (port 3001)
                                                                     |
                                                              better-sqlite3
                                                              (database.sqlite)
                                                                     |
                                                            +-- jobs
                                                            +-- settings
                                                            +-- paper_types
                                                            +-- discount_rules
                                                            +-- gmail_account
                                                            +-- processed_emails
                                                            +-- gmail_pending
```

In production, Vite builds to `dist/` and Express serves both the static files and the API on a single port (3000).

### Frontend Routing

Hash-based routing (no router library):
- Empty hash (`""`) -- Upload view (customer-facing)
- `#admin` -- Admin dashboard

### Key Frontend Files

| File | Purpose |
|------|---------|
| `App.tsx` | Root component: language toggle, admin login, hash-based view switching |
| `views/UploadView.tsx` | Customer upload form, pricing display, recent uploads, QR code |
| `views/AdminView.tsx` | Admin dashboard with Jobs, Settings, and Email tabs |
| `services/storageService.ts` | HTTP client wrapping all API calls |
| `utils/pricingUtils.ts` | Pricing calculation and discount engine |
| `constants.tsx` | Translation strings and allowed file types |
| `types.ts` | TypeScript type definitions |

---

## Database

SQLite database at `database.sqlite` using better-sqlite3 with WAL mode enabled.

### Tables

**jobs** -- Print job records

| Column         | Type    | Default    |
|----------------|---------|------------|
| id             | TEXT    | UUID       |
| customerName   | TEXT    | ''         |
| phoneNumber    | TEXT    | ''         |
| notes          | TEXT    | ''         |
| fileName       | TEXT    |            |
| fileType       | TEXT    |            |
| fileSize       | INTEGER |            |
| uploadDate     | TEXT    |            |
| status         | TEXT    | 'PENDING'  |
| serverFileName | TEXT    |            |
| pageCount      | INTEGER |            |
| colorMode      | TEXT    | 'color'    |
| copies         | INTEGER | 1          |
| paperType      | TEXT    | 'normal'   |
| source         | TEXT    | 'upload'   |
| customerEmail  | TEXT    | ''         |

**settings** -- Key-value store for shop configuration

| Column | Type |
|--------|------|
| key    | TEXT PK |
| value  | TEXT |

**paper_types** -- Per-page pricing configuration

| Column           | Type    | Default |
|------------------|---------|---------|
| id               | TEXT    |         |
| name             | TEXT    |         |
| nameAr           | TEXT    | ''      |
| colorPerPage     | REAL    | 30      |
| blackWhitePerPage| REAL    | 15      |
| sortOrder        | INTEGER | 0       |

**discount_rules** -- Discount rules engine

| Column          | Type    |
|-----------------|---------|
| id              | TEXT    |
| name            | TEXT    |
| discount_type   | TEXT    |
| discount_value  | REAL    |
| condition_type  | TEXT    |
| threshold       | INTEGER |
| max_discount_cap| REAL    |
| priority        | INTEGER |
| is_active       | INTEGER |
| created_at      | TEXT    |

**gmail_account** -- Connected Gmail account (singleton, id=1)

| Column        | Type    |
|---------------|---------|
| gmail_email   | TEXT    |
| access_token  | TEXT    | (encrypted AES-256-GCM) |
| refresh_token | TEXT    | (encrypted AES-256-GCM) |
| token_expiry  | TEXT    |
| connected_at  | TEXT    |
| is_active     | INTEGER |

**processed_emails** -- Deduplication table for Gmail polling

| Column           | Type    |
|------------------|---------|
| id               | INTEGER PK AUTO |
| gmail_message_id | TEXT UNIQUE |
| processed_at     | TEXT    |

**gmail_pending** -- Queue of emails awaiting import

| Column           | Type    |
|------------------|---------|
| id               | INTEGER PK AUTO |
| gmail_message_id | TEXT UNIQUE |
| email_from       | TEXT    |
| email_address    | TEXT    |
| subject          | TEXT    |
| body_preview     | TEXT    |
| attachment_meta  | TEXT    | (JSON) |
| received_at      | TEXT    |
| fetched_at       | TEXT    |
| discarded_at     | TEXT    |

---

## Authentication

Admin authentication uses a password stored in the `settings` table with key `admin_password`. The password is hashed using `crypto.scryptSync` with a 16-byte random salt and compared using `timingSafeEqual`. On the frontend, admin status is stored in `localStorage.ps_is_admin` as a boolean string. There is no session middleware or token-based auth -- the admin login is checked fresh on each API call to `/api/auth/verify`.

---

## i18n

The application supports English and Arabic. Language is controlled by the `localStorage` key `ps_language` (`"en"` or `"ar"`). Arabic uses RTL layout via `<html dir="rtl">`. Translations are stored in a single `TRANSLATIONS` object in `constants.tsx` with 62 keys, each having `en` and `ar` fields.

---

## Gmail Integration

The Gmail email-to-print feature allows customers to send print jobs directly via email.

### Setup

1. Go to the Google Cloud Console, create a project, and enable the Gmail API.
2. Create OAuth 2.0 credentials (Web application type) with the redirect URI set to `http://your-server:3000/api/gmail/callback`.
3. In the admin dashboard under the Email tab, enter the Client ID and Client Secret.
4. Click Connect to start the OAuth flow.

### How It Works

1. The server polls the connected Gmail inbox at a configurable interval (default 60 seconds) for unread emails.
2. Emails with supported attachment types (PDF, PNG, JPEG, DOCX) are added to a pending queue.
3. From the admin dashboard, you can review pending emails, select which to import, and configure per-attachment options (copies, color mode, paper type).
4. On import, files are saved, print jobs are created, the email is marked as read, and an optional auto-reply is sent.
5. Auto-reply templates support placeholders: `{shopName}`, `{fileName}`, `{fileCount}`, `{estimatedPrice}`.

### Rate Limiting

Attachment downloads are rate-limited to 30 requests per minute per IP address.

---

## Deployment

### Production Build

```bash
npm run build
npm start
```

This serves the built frontend from `dist/` and the API on port 3000. Make sure `NODE_ENV` is set to `production` in `.env`.

### Notes

- The `uploads/` directory is auto-created on server start. It is gitignored.
- The SQLite database file (`database.sqlite`) is auto-created on first run. It should be backed up regularly.
- The application listens on `0.0.0.0` by default, making it accessible from other devices on the local network.

---

## Docker

> Warning: The Dockerfile is currently incomplete and non-functional.

```dockerfile
FROM node:18
WORKDIR app/
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
```

Expects an automated build script.

---

## Project Structure

```
.
├── App.tsx                       # Root React component
├── index.tsx                     # React entry point
├── index.html                    # Vite entry HTML
├── index.css                     # Tailwind imports and CSS variables
├── server.js                     # Express backend (all API routes)
├── db.js                         # SQLite database layer
├── types.ts                      # TypeScript type definitions
├── constants.tsx                 # i18n translations and constants
├── vite.config.ts                # Vite build configuration
├── tailwind.config.js            # Tailwind CSS configuration
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # Dependencies and scripts
├── .env                          # Environment variables
├── .env.example                  # Environment variable template
├── components/                   # React components
│   ├── ImageEditor.tsx           # Image cropping and perspective correction
│   ├── LanguageToggle.tsx        # EN/AR language toggle
│   ├── ConfirmDialog.tsx         # Confirmation modal
│   ├── Toast.tsx                 # Toast notification component
│   ├── ToastContainer.tsx        # Toast management container
│   ├── button.tsx                # shadcn button
│   ├── card.tsx                  # shadcn card
│   ├── dialog.tsx                # shadcn dialog (Radix)
│   ├── alert-dialog.tsx          # shadcn alert dialog (Radix)
│   ├── input.tsx                 # shadcn input
│   ├── label.tsx                 # shadcn label (Radix)
│   ├── select.tsx                # shadcn select (Radix)
│   ├── textarea.tsx              # shadcn textarea
│   ├── toast.tsx                 # shadcn toast (Radix)
│   ├── toaster.tsx               # shadcn toaster
│   └── use-toast.ts              # shadcn toast hook
├── views/
│   ├── UploadView.tsx            # Customer upload page
│   └── AdminView.tsx             # Admin dashboard (Jobs, Settings, Email)
├── services/
│   ├── storageService.ts         # Frontend HTTP API client
│   ├── gmailService.js           # Google Gmail API client
│   ├── gmailPolling.js           # Polling and import logic
│   └── attachmentService.js      # File saving for Gmail imports
├── utils/
│   ├── pricingUtils.ts           # Pricing calculation and discount engine
│   └── timeUtils.ts              # Relative time formatting
├── lib/
│   └── utils.ts                  # cn() utility (clsx + tailwind-merge)
├── public/                       # Static assets (fonts, favicon, etc.)
├── uploads/                      # Uploaded files (auto-created, gitignored)
├── dist/                         # Production build output
├── migrate-to-sqlite.js          # Legacy db.json migration script
├── GMAIL_EMAIL_TO_PRINT.md       # Gmail architecture documentation
├── INSTALLATION.md               # Windows installation guide
└── AGENTS.md                     # AI agent guide
```

---

## Windows Setup

`setup.bat` and `install.bat` are provided for Windows environments. See `INSTALLATION.md` for details.

---

## Data Migration

If upgrading from a legacy `db.json` file (the previous data store), run:

```bash
node migrate-to-sqlite.js
```

This migrates all jobs and settings to SQLite and backs up the old file as `db.json.bak_<timestamp>`.
