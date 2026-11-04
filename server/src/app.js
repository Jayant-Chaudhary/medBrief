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
const maternityRoutes = require('./routes/maternity.routes');
const assistantRoutes = require('./routes/assistant.routes');
const medicationDecisionRoutes = require('./routes/medicationDecision.routes');

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
app.use('/api/maternity', maternityRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/decision-support', medicationDecisionRoutes);

app.use((req, res) => res.status(404).json({ error: 'Endpoint not found', requestId: req.id }));
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  const { checkFfmpegInstalled } = require('./utils/audioConverter');
  const transcriptionWorker = require('./services/consultAudio/transcriptionWorker');
  const audioCache = require('./services/consultAudio/audioCache.service');
  const orchestratorService = require('./services/consultAudio/orchestrator.service');

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception, shutting down', { err });
    process.exit(1);
  });

  const gracefulShutdown = () => {
    logger.info('Shutting down server, stopping background workers...');
    transcriptionWorker.stopWorker();
    orchestratorService.stop();
    audioCache.close();
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  server.listen(env.port, async () => {
    logger.info(`MedBrief API listening on port ${env.port}`, {
      env: process.env.NODE_ENV || 'development',
      ocrServiceUrl: env.ocrServiceUrl,
      clientAppUrl: env.clientAppUrl,
    });

    // Check ffmpeg availability
    await checkFfmpegInstalled();

    const assistantConfig = require('./config/assistant.config');
    logger.info(`Assistant agent loop is ${assistantConfig.agentLoop ? 'on' : 'off'}`, {
      agentLoop: assistantConfig.agentLoop,
    });

    // Start background transcription worker and orchestrator
    void audioCache.start();
    transcriptionWorker.startWorker();
    void orchestratorService.start();
  });
}

module.exports = app;
