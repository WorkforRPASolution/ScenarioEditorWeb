// shell-modified: WebManager@2f1eb0a server/index.js — 기능 require·초기화 13개(권한 동기화 포함)·EQP Redis·cron·분산 락 해제를 뺐다.
// 단독판은 127.0.0.1 에 바인딩한다(server/listen.js). SE_WEBMANAGER_DB=0 이면 EARS 만 연결한다(server/webManagerDb.js).
require('dotenv').config();
const { createLogger } = require('./shared/logger');
const app = require('./app');
const { connectDB, closeConnections, earsConnection, webManagerConnection } = require('./shared/db/connection');
const { connectRedis, closeRedis } = require('./shared/db/redisConnection');
const { resolveListenAddress } = require('./listen');
const { webManagerDbEnabled, connectEarsOnly, connectWebDbOnly } = require('./webManagerDb');

const serverLog = createLogger('server');
const { port: PORT, host: HOST } = resolveListenAddress(process.env);

const startServer = async () => {
  try {
    if (webManagerDbEnabled(process.env)) await connectDB();
    else {
      await connectEarsOnly(earsConnection, process.env);
      await connectWebDbOnly(webManagerConnection, process.env);
    }
    await connectRedis();

    const server = app.listen(PORT, HOST, () => {
      serverLog.info(`Server running on http://${HOST}:${PORT}`);
    });

    let isShuttingDown = false

    const gracefulShutdown = async (signal) => {
      if (isShuttingDown) return
      isShuttingDown = true
      serverLog.info(`${signal} received. Shutting down gracefully...`)

      const forceTimer = setTimeout(() => {
        serverLog.error('Forced shutdown: timeout exceeded')
        process.exit(1)
      }, 10000)
      forceTimer.unref()

      try {
        server.close()
        server.closeAllConnections()
        await closeConnections()
        await closeRedis()
        process.exit(0)
      } catch (err) {
        serverLog.error(`Error during shutdown: ${err.message}`)
        process.exit(1)
      }
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  } catch (error) {
    serverLog.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
