import winston from 'winston';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define level colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to Winston
winston.addColors(colors);

// Define the format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// Define the format for file output (JSON for easier parsing)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.json(),
);

// Get log level from environment or default to 'info'
const level = process.env.LOG_LEVEL || 'info';

// Create the logger instance
const logger = winston.createLogger({
  level,
  levels,
  format: winston.format.json(),
  defaultMeta: { service: 'orderbook-ws-server' },
  transports: [
    // Write logs with level 'error' to `error.log`
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      format: fileFormat,
    }),
    // Write all logs to `combined.log` 
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      format: fileFormat,
    }),
  ],
});

// If we're not in production, also log to the console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

/**
 * Wrapper for log method to provide enhanced context
 * @param level Log level
 * @param message Log message
 * @param meta Additional metadata
 */
function log(level: string, message: string, meta: any = {}) {
  logger.log(level, message, meta);
}

// Export a simplified interface
export default {
  error: (message: string, meta?: any) => log('error', message, meta),
  warn: (message: string, meta?: any) => log('warn', message, meta),
  info: (message: string, meta?: any) => log('info', message, meta),
  http: (message: string, meta?: any) => log('http', message, meta),
  debug: (message: string, meta?: any) => log('debug', message, meta),
  
  // Stream for Morgan HTTP logger (for Express if added later)
  stream: {
    write: (message: string) => {
      logger.http(message.trim());
    },
  },
}; 