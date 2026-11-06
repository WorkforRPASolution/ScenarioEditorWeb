// shell-modified: WebManager@2f1eb0a server/app.js — 기능 라우터 21개를 편집기 라우터 하나로 바꿨다.
// SE_WEBMANAGER_DB=0 이면 WEBMANAGER 기록 저장을 끄고 상태 확인을 EARS 기준으로 한다(server/webManagerDb.js).
// 단독판은 로그인이 없어 CORS 앞에서 Host·쓰기 출처를 검사한다(server/localGuard.js).
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { httpLogger } = require('./shared/logger/httpLogger');
const { errorHandler, notFoundHandler } = require('./shared/middleware/errorHandler');
const { webManagerDbEnabled, disableWebManagerLog, healthWithoutWebManager } = require('./webManagerDb');
const { createLocalGuard } = require('./localGuard');
const { resolveListenAddress, isLoopbackHost } = require('./listen');

const webManagerDb = webManagerDbEnabled(process.env);
if (!webManagerDb) disableWebManagerLog(require('./shared/models/webmanagerLogModel'));

const app = express();

// 인증 없는 단독판이 루프백이 아닌 주소에 떠 있으면 쓰기 API 를 전부 막는다(컨트롤러 requireWrite·requireReviewer 가 본다).
app.locals.seWriteDisabled = !isLoopbackHost(resolveListenAddress(process.env).host);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API server
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
app.use(createLocalGuard({ allowedOrigins, allowedHosts: process.env.ALLOWED_HOSTS }));
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
  exposedHeaders: ['Content-Disposition', 'X-SE-Open-Stats']
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
  const status = await getHealthStatus();
  const health = webManagerDb ? status : healthWithoutWebManager(status);
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
