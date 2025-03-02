import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import sequelize from '../models/database';
import logger from '../utils/logger';
import { Server } from 'http';

// Create Express router
const router = express.Router();

/**
 * Basic health check endpoint
 * Returns 200 OK if the server is running
 */
router.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'orderbook-ws-server'
  });
});

/**
 * Detailed health check endpoint
 * Checks database connectivity and returns more detailed status
 */
router.get('/detailed', (req: Request, res: Response, next: NextFunction) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'orderbook-ws-server',
    checks: {
      database: {
        status: 'ok',
        message: 'Connected to database'
      }
    },
    uptime: process.uptime()
  };
  
  sequelize.authenticate()
    .then(() => {
      res.status(200).json(health);
    })
    .catch((error) => {
      health.status = 'error';
      health.checks.database = {
        status: 'error',
        message: 'Database connection error'
      };
      logger.error('Health check failed - database connection error', { error });
      res.status(503).json(health);
    });
});

/**
 * Create Express app
 */
export const createHealthApp = (): express.Application => {
  const app = express();
  
  // Middleware
  app.use(cors());
  app.use(express.json());
  
  // Routes
  app.use('/health', router);
  
  return app;
};

/**
 * Start the health check API server
 * Returns a Promise that resolves with the server instance or rejects with an error
 */
export const startHealthServer = (port: number): Promise<Server> => {
  const app = createHealthApp();
  
  return new Promise((resolve, reject) => {
    try {
      const server = app
        .listen(port, () => {
          logger.info(`Health check API running on port ${port}`);
          resolve(server);
        })
        .on('error', (error: any) => {
          if (error.code === 'EADDRINUSE') {
            logger.error(`Port ${port} is already in use for health API. Health check API will not be available.`);
          } else {
            logger.error('Health check API server error:', { error });
          }
          reject(error);
        });
    } catch (error) {
      logger.error('Failed to start health check API:', { error });
      reject(error);
    }
  });
}; 