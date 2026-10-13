import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import oracledb from 'oracledb';
import { pool } from '../db.js';
import {
  authenticateAdminCredentials,
  clearAdminSessionCookie,
  createAdminSession,
  requireAdmin,
  setAdminSessionCookie,
  verifyAdminSession,
} from '../adminAuth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
const allowedStatuses = new Set([
  'SUBMITTED',
  'REVIEWING',
  'ON_HOLD',
  'ACCEPTED',
  'REJECTED',
]);

const getPayload = (row) => {
  if (!row) return row;
  if (typeof row.payload === 'string') {
    try {
      return { ...row, payload: JSON.parse(row.payload) };
    } catch {
      return row;
    }
  }
  return row;
};

const getApplicationDetail = async (connection, id) => {
  const appResult = await connection.execute(
    `SELECT
       application_id AS "id",
       application_number AS "application_number",
       status AS "status",
       payload AS "payload",
       created_at AS "created_at",
       updated_at AS "updated_at",
       submitted_at AS "submitted_at",
       reviewed_at AS "reviewed_at",
       reviewed_by AS "reviewed_by",
       review_note AS "review_note"
     FROM applications
     WHERE application_id = :id`,
    { id },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  if (appResult.rows.length === 0) return null;

  const [docsResult, auditResult] = await Promise.all([
    connection.execute(
      `SELECT
         document_id AS "id",
         document_type AS "document_type",
         original_name AS "original_name",
         mime_type AS "mime_type",
         size_bytes AS "size_bytes",
         created_at AS "created_at"
       FROM documents
       WHERE application_id = :id
       ORDER BY created_at`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ),
    connection.execute(
      `SELECT
         action AS "action",
         from_status AS "from_status",
         to_status AS "to_status",
         note AS "note",
         actor_type AS "actor_type",
         actor_username AS "actor_username",
         created_at AS "created_at"
       FROM application_audit_log
       WHERE application_id = :id
       ORDER BY created_at DESC`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ),
  ]);

  return {
    ...getPayload(appResult.rows[0]),
    documents: docsResult.rows,
    audit: auditResult.rows,
  };
};

// Simple in-memory login throttling for the development/admin portal.
const failedLogins = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const allowLoginAttempt = (ip) => {
  const now = Date.now();
  const existing = failedLogins.get(ip);
  if (!existing || existing.resetAt <= now) {
    failedLogins.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  return existing.count < MAX_ATTEMPTS;
};

const recordFailedLogin = (ip) => {
  const current = failedLogins.get(ip) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
  current.count += 1;
  failedLogins.set(ip, current);
};

const clearFailedLogin = (ip) => failedLogins.delete(ip);

router.post('/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowLoginAttempt(ip)) {
    return res.status(429).json({
      message: 'Too many failed login attempts. Try again later.',
    });
  }

  const { username, password } = req.body || {};
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !authenticateAdminCredentials(username, password)
  ) {
    recordFailedLogin(ip);
    return res.status(401).json({ message: 'Invalid administrator credentials.' });
  }

  clearFailedLogin(ip);
  setAdminSessionCookie(res, createAdminSession(username));
  return res.json({ username, role: 'administrator' });
});

router.post('/logout', (_req, res) => {
  clearAdminSessionCookie(res);
  return res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('admin_session='))
    ?.split('=')[1];
  const session = verifyAdminSession(token ? decodeURIComponent(token) : null);

  if (!session) return res.status(401).json({ authenticated: false });
  return res.json({ authenticated: true, username: session.username });
});

router.use(requireAdmin);

router.get('/stats', async (_req, res, next) => {
  try {
    const connection = await pool.getConnection();
    try {
      const result = await connection.execute(
        `SELECT
           COUNT(*) AS "total",
           SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS "draft",
           SUM(CASE WHEN status = 'SUBMITTED' THEN 1 ELSE 0 END) AS "submitted",
           SUM(CASE WHEN status = 'REVIEWING' THEN 1 ELSE 0 END) AS "reviewing",
           SUM(CASE WHEN status = 'ON_HOLD' THEN 1 ELSE 0 END) AS "on_hold",
           SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) AS "accepted",
           SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS "rejected"
         FROM applications`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return res.json(result.rows[0]);
    } finally {
      await connection.close();
    }
  } catch (error) {
    next(error);
  }
});

router.get('/applications', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(req.query.pageSize || '20', 10) || 20));
    const offset = (page - 1) * pageSize;

    if (status && status !== 'ALL' && !new Set(['DRAFT', ...allowedStatuses]).has(status)) {
      return res.status(400).json({ message: 'Invalid status filter.' });
    }

    const connection = await pool.getConnection();
    try {
      const result = await connection.execute(
        `SELECT
           application_id AS "id",
           application_number AS "application_number",
           status AS "status",
           JSON_VALUE(payload, '$.accountTitleEnglish') AS "account_title",
           JSON_VALUE(payload, '$.officeEmail') AS "office_email",
           JSON_VALUE(payload, '$.bankName') AS "bank_name",
           created_at AS "created_at",
           submitted_at AS "submitted_at",
           reviewed_at AS "reviewed_at",
           reviewed_by AS "reviewed_by",
           COUNT(*) OVER() AS "total_count"
         FROM applications
         WHERE (:status = 'ALL' OR :status IS NULL OR status = :status)
           AND (
             :search IS NULL OR :search = '' OR
             UPPER(application_number) LIKE UPPER(:searchPattern) OR
             UPPER(JSON_VALUE(payload, '$.accountTitleEnglish')) LIKE UPPER(:searchPattern) OR
             UPPER(JSON_VALUE(payload, '$.officeEmail')) LIKE UPPER(:searchPattern) OR
             UPPER(JSON_VALUE(payload, '$.tinNumber')) LIKE UPPER(:searchPattern)
           )
         ORDER BY created_at DESC
         OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        {
          status: status || 'ALL',
          search: search || '',
          searchPattern: `%${search}%`,
          offset,
          pageSize,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const rows = result.rows;
      const total = rows.length ? Number(rows[0].total_count) : 0;
      return res.json({
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        applications: rows.map(({ total_count: _total, ...row }) => row),
      });
    } finally {
      await connection.close();
    }
  } catch (error) {
    next(error);
  }
});

router.get('/applications/:id', async (req, res, next) => {
  try {
    const connection = await pool.getConnection();
    try {
      const detail = await getApplicationDetail(connection, req.params.id);
      if (!detail) return res.status(404).json({ message: 'Application not found.' });
      return res.json(detail);
    } finally {
      await connection.close();
    }
  } catch (error) {
    next(error);
  }
});

router.post('/applications/:id/status', async (req, res, next) => {
  try {
    const status = typeof req.body?.status === 'string'
      ? req.body.status.trim().toUpperCase()
      : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

    if (!allowedStatuses.has(status)) {
      return res.status(400).json({
        message: 'Status must be SUBMITTED, REVIEWING, ON_HOLD, ACCEPTED, or REJECTED.',
      });
    }

    if ((status === 'ACCEPTED' || status === 'REJECTED') && !note) {
      return res.status(400).json({
        message: 'A decision note is required when accepting or rejecting an application.',
      });
    }

    const connection = await pool.getConnection();
    try {
      const current = await connection.execute(
        `SELECT status AS "status", application_number AS "application_number"
         FROM applications
         WHERE application_id = :id`,
        { id: req.params.id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      if (current.rows.length === 0) {
        return res.status(404).json({ message: 'Application not found.' });
      }

      const fromStatus = current.rows[0].status;
      if (fromStatus === 'DRAFT') {
        return res.status(409).json({
          message: 'A draft application must be submitted before it can be reviewed.',
        });
      }

      if (fromStatus === status) {
        return res.status(409).json({ message: `Application is already ${status}.` });
      }

      const applicationIsDecision = status === 'ACCEPTED' || status === 'REJECTED';
      await connection.execute(
        `UPDATE applications
         SET status = :status,
             updated_at = SYSTIMESTAMP,
             reviewed_at = CASE WHEN :isDecision = 1 THEN SYSTIMESTAMP ELSE reviewed_at END,
             reviewed_by = CASE WHEN :isDecision = 1 THEN :reviewedBy ELSE reviewed_by END,
             review_note = CASE WHEN :hasNote = 1 THEN :note ELSE review_note END
         WHERE application_id = :id`,
        {
          status,
          isDecision: applicationIsDecision ? 1 : 0,
          reviewedBy: req.admin.username,
          hasNote: note ? 1 : 0,
          note: note || null,
          id: req.params.id,
        },
        { autoCommit: false },
      );

      await connection.execute(
        `INSERT INTO application_audit_log (
           audit_id,
           application_id,
           actor_type,
           actor_username,
           action,
           from_status,
           to_status,
           note,
           created_at
         ) VALUES (
           :auditId,
           :applicationId,
           'ADMIN',
           :username,
           'STATUS_CHANGE',
           :fromStatus,
           :toStatus,
           :note,
           SYSTIMESTAMP
         )`,
        {
          auditId: crypto.randomUUID(),
          applicationId: req.params.id,
          username: req.admin.username,
          fromStatus,
          toStatus: status,
          note: note || null,
        },
        { autoCommit: false },
      );

      await connection.commit();
      return res.json({
        id: req.params.id,
        application_number: current.rows[0].application_number,
        from_status: fromStatus,
        status,
        reviewed_by: applicationIsDecision ? req.admin.username : null,
        review_note: note || null,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  } catch (error) {
    next(error);
  }
});

router.get('/applications/:applicationId/documents/:documentId', async (req, res, next) => {
  try {
    const connection = await pool.getConnection();
    try {
      const result = await connection.execute(
        `SELECT
           stored_name AS "stored_name",
           original_name AS "original_name",
           mime_type AS "mime_type"
         FROM documents
         WHERE document_id = :documentId
           AND application_id = :applicationId`,
        {
          documentId: req.params.documentId,
          applicationId: req.params.applicationId,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Document not found.' });
      }

      const row = result.rows[0];
      const filePath = path.resolve(uploadDir, row.stored_name);
      if (path.dirname(filePath) !== path.resolve(uploadDir) || !fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'Stored document file not found.' });
      }

      res.type(row.mime_type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${String(row.original_name || 'document').replaceAll('"', '')}"`,
      );
      return res.sendFile(filePath);
    } finally {
      await connection.close();
    }
  } catch (error) {
    next(error);
  }
});

export default router;
