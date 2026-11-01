// shell-modified: WebManager@2f1eb0a server/app.js — 기능 라우터 21개를 편집기 라우터 하나로 바꿨다.
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { httpLogger } = require('./shared/logger/httpLogger');
const { errorHandler, notFoundHandler } = require('./shared/middleware/errorHandler');

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API server
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition']
}));

// HTTP request logging
app.use(httpLogger);

// Body parser
app.use(express.json({ limit: '10mb' }));

// Response compression (SSE excluded via filter)
app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type')?.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  }
}));

// Routes
const { asyncHandler } = require('./shared/middleware/errorHandler');
const { getHealthStatus } = require('./shared/utils/healthCheck');
app.get('/api/health', asyncHandler(async (req, res) => {
  const health = await getHealthStatus();
  res.status(health.status === 'down' ? 503 : 200).json(health);
}));

// Feature routes
app.use('/api/scenario-editor', require('./features/scenario-editor/routes'));

// Production: Serve static files from client/dist
if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDistPath));

  // SPA fallback: serve index.html for all non-API routes
  app.get('*splat', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
