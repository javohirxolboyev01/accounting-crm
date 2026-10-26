import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { errorHandler } from './common/errors';
import { config } from './config';
import { pool } from './db';
import { authRouter, meRouter } from './modules/auth';
import { clientsRouter } from './modules/clients';
import { auditRouter, dashboardRouter } from './modules/dashboard';
import { sseHandler } from './modules/events';
import { generatorRouter } from './modules/generator';
import { gridRouter } from './modules/grid';
import { notificationsRouter } from './modules/notifications';
import { settingsRouter } from './modules/settings';
import { sheetsRouter } from './modules/sheets/routes';
import { tasksRouter } from './modules/tasks';
import { usersRouter } from './modules/users';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    const r = await pool.query(`SELECT current_setting('TimeZone') AS tz`);
    res.json({ status: 'UP', db: 'UP', timezone: r.rows[0].tz, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/generator', generatorRouter);
  app.use('/api/monthly-grid', gridRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/sheets', sheetsRouter);
  app.get('/api/events', sseHandler);

  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Endpoint topilmadi', details: null });
  });
  app.use(errorHandler);
  return app;
}
