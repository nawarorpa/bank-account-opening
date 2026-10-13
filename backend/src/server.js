import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import './db.js';
import applicationRoutes from './routes/applicationRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const adminDir = path.resolve(__dirname, '..', 'public', 'admin');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'investor-bank-account-opening-api' });
});

app.use('/api/applications', applicationRoutes);
app.use('/api/admin', adminRoutes);

if (fs.existsSync(adminDir)) {
  app.use('/admin', express.static(adminDir, { extensions: ['html'] }));
}

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'File exceeds the 5 MB limit.' });
  }

  if (error?.message?.includes('Only PDF')) {
    return res.status(415).json({ message: error.message });
  }

  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error.'
    : (error?.message || 'Internal server error.');

  return res.status(500).json({ message });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Investor bank account opening API running on http://0.0.0.0:${port}`);
  console.log(`Admin portal available at http://localhost:${port}/admin/`);
});

const shutdown = async (signal) => {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
