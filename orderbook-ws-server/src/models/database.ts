import { Sequelize } from 'sequelize';
import path from 'path';
import logger from '../utils/logger';

// Create a new Sequelize instance with SQLite
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../database.sqlite'),
  logging: false, // Set to console.log to see SQL queries
});

// Configuration for connection retry
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

// Test the connection with retry mechanism
export const testConnection = async (): Promise<void> => {
  let retries = 0;
  let lastError: any;
  let delay = INITIAL_RETRY_DELAY;

  while (retries < MAX_RETRIES) {
    try {
      await sequelize.authenticate();
      logger.info('Database connection has been established successfully.');
      return;
    } catch (error) {
      lastError = error;
      retries++;
      
      if (retries >= MAX_RETRIES) {
        logger.error(`Failed to connect to database after ${MAX_RETRIES} attempts`);
        break;
      }
      
      logger.warn(`Unable to connect to the database (attempt ${retries}/${MAX_RETRIES}). Retrying in ${delay / 1000} seconds...`);
      
      // Wait for the specified delay
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Exponential backoff with jitter
      delay = Math.min(delay * 1.5, 30000) * (0.8 + 0.4 * Math.random());
    }
  }
  
  // If we've exhausted all retries, throw the last error
  logger.error('Unable to connect to the database:', { error: lastError });
  throw lastError;
};

// Initialize database
export const initDatabase = async (forceSync: boolean = false): Promise<void> => {
  try {
    // Get current environment
    const nodeEnv = process.env.NODE_ENV || 'development';
    
    // Determine sync options based on environment
    let syncOptions = {};
    
    if (nodeEnv === 'production') {
      // In production, we don't want to alter tables automatically
      // Only force sync if explicitly requested (e.g., during migrations or first deployment)
      if (forceSync) {
        logger.warn('WARNING: Force sync requested in production environment!');
        syncOptions = { force: true };
      } else {
        // In production with no force flag, just check connection but don't sync
        logger.info('Production environment detected. Skipping automatic schema synchronization for safety.');
        return;
      }
    } else if (nodeEnv === 'test') {
      // In test environment, we want to recreate tables each time
      syncOptions = { force: true };
    } else {
      // In development, we can use alter:true to automatically adjust tables
      syncOptions = { alter: true };
    }
    
    // Log the sync mode
    if (Object.keys(syncOptions).length > 0) {
      logger.info(`Synchronizing database schema with options: ${JSON.stringify(syncOptions)}`);
      await sequelize.sync(syncOptions);
      logger.info('Database synchronized successfully.');
    }
  } catch (error) {
    logger.error('Failed to sync database:', { error });
    throw error;
  }
};

export default sequelize; 