import { fetchUnreadEmails } from './gmailService.js';
import { saveAttachment } from './attachmentService.js';
import db, { getGmailAccount, isEmailProcessed, markEmailProcessed, isEmailPending, addPendingEmail, removePendingEmail, getPendingEmailById, getSettings } from '../db.js';

let pollingInterval = null;
const DEFAULT_INTERVAL_MS = 60 * 1000;

function extractBody(payload) {
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf8');
      }
    }
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result) return result;
    }
  }
  return '';
}

function extractAttachmentsMeta(payload) {
  const attachments = [];
  function walk(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }
  if (payload.parts) walk(payload.parts);
  return attachments;
}

function parseFromHeader(fromHeader) {
  const match = fromHeader.match(/^(.+?)\s*<(.+@.+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"/, '').replace(/"$/, ''), email: match[2] };
  }
  return { name: fromHeader || 'Unknown', email: fromHeader || '' };
}

function getHeader(headers, name) {
  const h = headers.find(h => h.name === name);
  return h ? h.value : '';
}

/**
 * Poll Gmail inbox — only fetches metadata and queues new emails for user review.
 */
export async function pollGmail() {
  const account = getGmailAccount();
  if (!account || !account.is_active) {
    return { error: 'No Gmail account connected' };
  }

  try {
    const emails = await fetchUnreadEmails();
    console.log(`📨 Gmail poll: found ${emails.length} unread email(s)`);

    let newCount = 0;
    let skippedCount = 0;

    for (const msg of emails) {
      const messageId = msg.id;

      if (isEmailProcessed(messageId) || isEmailPending(messageId)) {
        skippedCount++;
        continue;
      }

      const headers = msg.payload.headers;
      const fromHeader = getHeader(headers, 'From');
      const subject = getHeader(headers, 'Subject');
      const date = getHeader(headers, 'Date');
      const { name, email } = parseFromHeader(fromHeader);
      const body = extractBody(msg.payload);
      const attachments = extractAttachmentsMeta(msg.payload);

      addPendingEmail({
        gmailMessageId: messageId,
        from: name,
        emailAddress: email,
        subject,
        bodyPreview: body.substring(0, 500),
        attachmentMeta: attachments,
        receivedAt: date,
      });

      newCount++;
      if (attachments.length > 0) {
        console.log(`  📎 Queued "${subject}" from ${email} (${attachments.length} attachment(s))`);
      }
    }

    return { new: newCount, skipped: skippedCount };
  } catch (err) {
    console.error('❌ Gmail poll error:', err.message);
    return { error: err.message };
  }
}

/**
 * Import selected pending emails: download attachments and create print jobs.
 */
export async function importPendingEmails(pendingIds) {
  const account = getGmailAccount();
  if (!account || !account.is_active) {
    return { error: 'No Gmail account connected' };
  }

  const results = [];

  for (const id of pendingIds) {
    try {
      const pending = getPendingEmailById(id);
      if (!pending) {
        results.push({ id, error: 'Not found' });
        continue;
      }

      const jobs = [];

      for (const att of (pending.attachment_meta || [])) {
        try {
          const gmail = await (await import('./gmailService.js')).getGmailClient();
          const attResponse = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: pending.gmail_message_id,
            id: att.attachmentId,
          });

          const savedPath = await saveAttachment(att.filename, att.mimeType, attResponse.data.data, pending.gmail_message_id);
          if (!savedPath) continue;

          const jobId = `gmail_${pending.gmail_message_id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          db.prepare(`
            INSERT INTO jobs (
              id, customerName, customerEmail, notes, fileName, fileType,
              fileSize, uploadDate, status, serverFileName, pageCount,
              colorMode, copies, paperType, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            jobId,
            pending.email_from,
            pending.email_address,
            `From: ${pending.subject}\n\n${pending.body_preview}`,
            att.filename,
            att.mimeType,
            att.size || 0,
            new Date().toISOString(),
            'PENDING',
            savedPath,
            null,
            'color',
            1,
            'normal',
            'gmail',
          );

          jobs.push(jobId);
        } catch (err) {
          console.error(`  ❌ Failed to import attachment ${att.filename}:`, err.message);
        }
      }

      // Mark as read & processed
      try {
        const { markAsRead } = await import('./gmailService.js');
        await markAsRead(pending.gmail_message_id);
      } catch (err) {
        console.warn(`⚠️  Could not mark message ${pending.gmail_message_id} as read:`, err.message);
      }

      markEmailProcessed(pending.gmail_message_id);
      removePendingEmail(id);

      results.push({ id: pending.id, subject: pending.subject, jobs });
      console.log(`  ✅ Imported "${pending.subject}" → ${jobs.length} job(s)`);

      // Auto-reply using template
      try {
        const settings = getSettings();
        const { sendReply } = await import('./gmailService.js');
        const pricing = settings.pricing || {};
        const template = settings.gmailReplyTemplate || [
          `Thank you for your print request!`,
          ``,
          `We have received your file(s) and will process them shortly.`,
          jobs.length > 0 ? `Files received: {fileCount}` : '',
          `Estimated price: Starting from {estimatedPrice} per page (color)`,
          ``,
          `We will notify you when your prints are ready.`,
          ``,
          `Best regards,`,
          `{shopName}`,
        ].filter(Boolean).join('\n');
        const fileNames = jobs.map(j => {
          const row = db.prepare('SELECT fileName FROM jobs WHERE id = ?').get(j);
          return row ? row.fileName : '';
        }).filter(Boolean).join(', ');
        const replyBody = template
          .replace(/\{shopName\}/g, settings.shopName || 'Print Shop')
          .replace(/\{fileName\}/g, fileNames || 'your file')
          .replace(/\{fileCount\}/g, jobs.length.toString())
          .replace(/\{estimatedPrice\}/g, `${pricing.colorPerPage || 30}`);
        await sendReply(pending.gmail_message_id, replyBody);
        console.log(`  📧 Auto-reply sent for "${pending.subject}"`);
      } catch (err) {
        console.warn(`⚠️  Could not send auto-reply:`, err.message);
      }
    } catch (err) {
      console.error(`❌ Error importing email id=${id}:`, err.message);
      results.push({ id, error: err.message });
    }
  }

  return { imported: results };
}

/**
 * Discard a pending email without importing.
 */
export function discardPendingEmail(id) {
  removePendingEmail(id);
}

export function startPolling(intervalMs) {
  stopPolling();
  const ms = intervalMs || DEFAULT_INTERVAL_MS;
  console.log(`⏰ Starting Gmail polling every ${ms / 1000}s`);
  pollingInterval = setInterval(() => {
    pollGmail().catch(err => console.error('❌ Polling error:', err));
  }, ms);
}

export function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('⏹️  Gmail polling stopped');
  }
}

export function restartPolling(intervalMs) {
  stopPolling();
  const ms = intervalMs || DEFAULT_INTERVAL_MS;
  pollingInterval = setInterval(() => {
    pollGmail().catch(err => console.error('❌ Polling error:', err));
  }, ms);
  console.log(`⏰ Restarted Gmail polling every ${ms / 1000}s`);
}
