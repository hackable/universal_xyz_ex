import dotenv from 'dotenv';
import { testConnection, initDatabase } from './models/database';
import { OrderbookContract } from './blockchain/contract';
import { OrderbookWebSocketServer } from './websocket/server';
import OrderService from './services/order.service';
import logger from './utils/logger';
import { startHealthServer } from './api/health';

// Load environment variables
dotenv.config();

// Constants
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '8081', 10);
const ORDERBOOK_CONTRACT_ADDRESS = process.env.ORDERBOOK_CONTRACT_ADDRESS || '';
const PROVIDER_URL = process.env.PROVIDER_URL || 'http://localhost:8545';
const EXPIRY_CHECK_INTERVAL = parseInt(process.env.EXPIRY_CHECK_INTERVAL || '60000', 10); // 1 minute default
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS || '1000', 10);
const MAX_CONNECTIONS_PER_IP = parseInt(process.env.MAX_CONNECTIONS_PER_IP || '5', 10);
const MAX_MESSAGES_PER_IP = parseInt(process.env.MAX_MESSAGES_PER_IP || '30', 10);
const WS_PING_INTERVAL = parseInt(process.env.WS_PING_INTERVAL || '30000', 10); // 30 seconds default
const SUBSCRIPTION_LIMIT = parseInt(process.env.SUBSCRIPTION_LIMIT || '50', 10); // 50 items default
// Maximum port retry attempts if default port is in use
const MAX_PORT_RETRY_ATTEMPTS = parseInt(process.env.MAX_PORT_RETRY_ATTEMPTS || '3', 10);

// Database configuration
const DB_FORCE_SYNC = process.env.DB_FORCE_SYNC === 'true';

// Event processing retry configuration
const EVENT_RETRY_MAX = parseInt(process.env.EVENT_RETRY_MAX || '5', 10);
const EVENT_RETRY_DELAY = parseInt(process.env.EVENT_RETRY_DELAY || '1000', 10); // 1 second
const EVENT_RETRY_MAX_DELAY = parseInt(process.env.EVENT_RETRY_MAX_DELAY || '60000', 10); // 1 minute

// Exit if required environment variables are missing
if (!ORDERBOOK_CONTRACT_ADDRESS) {
  logger.error('Missing required environment variable: ORDERBOOK_CONTRACT_ADDRESS');
  process.exit(1);
}

if (!PROVIDER_URL) {
  logger.error('Missing required environment variable: PROVIDER_URL');
  process.exit(1);
}

// Main application
async function main() {
  let wsServer: OrderbookWebSocketServer | null = null;
  let healthServer: any = null;
  let expiryInterval: NodeJS.Timeout | null = null;

  try {
    // Initialize database
    await testConnection();
    await initDatabase(DB_FORCE_SYNC);

    // Initialize blockchain contract with retry configuration
    const contract = new OrderbookContract(
      ORDERBOOK_CONTRACT_ADDRESS,
      PROVIDER_URL,
      {
        maxRetries: EVENT_RETRY_MAX,
        initialDelay: EVENT_RETRY_DELAY,
        maxDelay: EVENT_RETRY_MAX_DELAY
      }
    );

    // Start listening to blockchain events
    contract.startListening();

    // Initialize WebSocket server with rate limiting and other settings
    // Try multiple ports if initial port is in use
    let currentPort = WS_PORT;
    let attempt = 0;
    let wsInitialized = false;

    while (!wsInitialized && attempt < MAX_PORT_RETRY_ATTEMPTS) {
      try {
        wsServer = new OrderbookWebSocketServer(
          currentPort,
          contract,
          {
            maxConnections: MAX_CONNECTIONS,
            maxConnectionsPerIP: MAX_CONNECTIONS_PER_IP,
            maxMessagesPerIP: MAX_MESSAGES_PER_IP,
            pingInterval: WS_PING_INTERVAL,
            subscriptionLimit: SUBSCRIPTION_LIMIT
          }
        );
        wsInitialized = true;
      } catch (error: any) {
        if (error.code === 'EADDRINUSE' && attempt < MAX_PORT_RETRY_ATTEMPTS - 1) {
          attempt++;
          currentPort++;
          logger.warn(`Port ${currentPort - 1} is in use, trying port ${currentPort} (attempt ${attempt}/${MAX_PORT_RETRY_ATTEMPTS})`);
        } else {
          // If it's not an address-in-use error or we've exhausted retries, re-throw
          throw error;
        }
      }
    }

    // Start health check API
    try {
      healthServer = await startHealthServer(HEALTH_PORT);
      logger.info(`Health check API running on port ${HEALTH_PORT}`);
    } catch (error: any) {
      // Just log the error but continue - health API is not critical
      if (error.code === 'EADDRINUSE') {
        logger.warn(`Health API port ${HEALTH_PORT} is in use. Health check API will not be available.`);
      } else {
        logger.warn('Failed to start health check API:', { error });
      }
    }

    // Set up periodic expiry check for orders
    expiryInterval = setInterval(async () => {
      try {
        const expiredCount = await OrderService.updateExpiredOrders();
        if (expiredCount > 0) {
          logger.info(`Updated ${expiredCount} expired orders`);
        }
      } catch (error) {
        logger.error('Error updating expired orders:', { error });
      }
    }, EXPIRY_CHECK_INTERVAL);

    // Handle process termination
    const cleanupAndExit = () => {
      logger.info('Shutting down gracefully...');
      if (expiryInterval) {
        clearInterval(expiryInterval);
        expiryInterval = null;
      }
      contract.stopListening();
      if (wsServer) {
        wsServer.close();
      }
      if (healthServer) {
        healthServer.close(() => {
          logger.info('Health check API server closed');
        });
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanupAndExit);
    process.on('SIGTERM', cleanupAndExit);

    logger.info(`Orderbook WebSocket server running on port ${currentPort}`);
    logger.info(`Rate limits: ${MAX_CONNECTIONS_PER_IP} connections and ${MAX_MESSAGES_PER_IP} messages per IP`);
    logger.info(`Maximum server connections: ${MAX_CONNECTIONS}`);
    logger.info(`WebSocket ping interval: ${WS_PING_INTERVAL}ms`);
    logger.info(`Subscription limit per client: ${SUBSCRIPTION_LIMIT}`);
  } catch (error) {
    logger.error('Failed to start the application:', { error });
    
    // Clean up resources
    if (expiryInterval) {
      clearInterval(expiryInterval);
    }
    if (wsServer) {
      wsServer.close();
    }
    if (healthServer) {
      healthServer.close();
    }
    
    process.exit(1);
  }
}

// Start the application
main(); 