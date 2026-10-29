const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const logger = require('./utils/logger');
const { initSocketServer } = require('./services/consultAudio/socket.service');

const authRoutes = require('./routes/auth.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const vitalsRoutes = require('./routes/vitals.routes');
const questionnaireRoutes = require('./routes/questionnaire.routes');
const labReportsRoutes = require('./routes/labReports.routes');
const checklistRoutes = require('./routes/checklist.routes');
const postVisitRoutes = require('./routes/postVisit.routes');
const profileRoutes = require('./routes/profile.routes');
const ocrRoutes = require('./routes/ocr.routes');
const patientsRoutes = require('./routes/patients.routes');
const templatesRoutes = require('./routes/templates.routes');
const { consultRouter, timeRouter } = require('./routes/consultAudio.routes');

const app = express();
const server = http.createServer(app);
const corsOriginList = [env.clientAppUrl, 'http://localhost:5173', 'http://localhost:3000'];

// Initialize Socket.IO control channel
initSocketServer(server, {
  origin: corsOriginList,
  credentials: true,
});
app.server = server;

// Community must terminate before the identified care logger and error handler.
app.use('/api/community', cors({
  origin: [env.clientAppUrl, 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}), express.json({ limit: '64kb' }), require('./community/router').configuredRouter(), require('./community/internal').safeErrors);

app.use(requestLogger);
app.use(cors({
  origin: [env.clientAppUrl, 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  exposedHeaders: ['X-Request-Id'],
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API Resource Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/vitals', vitalsRoutes);
app.use('/api/questionnaire', questionnaireRoutes);
app.use('/api/lab-reports', labReportsRoutes);
app.use('/api/checklist', checklistRoutes);
app.use('/api/post-visit', postVisitRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/time', timeRouter);
app.use('/api/consults', consultRouter);

app.use((req, res) => res.status(404).json({ error: 'Endpoint not found', requestId: req.id }));
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception, shutting down', { err });
    process.exit(1);
  });

  server.listen(env.port, () => {
    logger.info(`MedBrief API listening on port ${env.port}`, {
      env: process.env.NODE_ENV || 'development',
      ocrServiceUrl: env.ocrServiceUrl,
      clientAppUrl: env.clientAppUrl,
    });
  });
}

module.exports = app;
