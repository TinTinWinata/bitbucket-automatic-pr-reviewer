'use strict';

const winston = require('winston');
require('winston-daily-rotate-file');

const NODE_ENV = process.env.NODE_ENV || 'development';

let defaultLogger = null;

function getLogLevelFromConfig(loggingConfig) {
  const level = (loggingConfig && loggingConfig.level) || 'info';
  if (level !== 'info') return level;
  switch (NODE_ENV) {
    case 'production':
      return 'warn';
    case 'development':
      return 'debug';
    case 'test':
      return 'error';
    default:
      return 'info';
  }
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(info => {
    const { timestamp, level, message, stack } = info;
    return `${timestamp} [${level.toUpperCase()}]: ${message}${stack ? `\n${stack}` : ''}`;
  }),
);

const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(info => {
    const { timestamp, level, message, stack } = info;
    return `${timestamp} [${level}]: ${message}${stack ? `\n${stack}` : ''}`;
  }),
);

/**
 * Create and set the default logger from config. Call once at startup (e.g. from index.js).
 * @param {Object} loggingConfig - { level, fileRetentionDays, maxFileSize, enableConsole, enableFile }
 * @returns {winston.Logger} The logger instance
 */
function createLogger(loggingConfig) {
  const level = getLogLevelFromConfig(loggingConfig);
  const fileRetentionDays = (loggingConfig && loggingConfig.fileRetentionDays) || '30';
  const maxFileSize = (loggingConfig && loggingConfig.maxFileSize) || '20m';
  const enableConsole = loggingConfig ? loggingConfig.enableConsole !== false : true;
  const enableFile = loggingConfig ? loggingConfig.enableFile !== false : true;

  const transports = [];

  if (enableFile) {
    const fileRotateTransport = new winston.transports.DailyRotateFile({
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: maxFileSize,
      maxFiles: `${fileRetentionDays}d`,
      format: logFormat,
    });
    fileRotateTransport.on('error', error => {
      console.error('Logger file transport error:', error);
    });
    transports.push(fileRotateTransport);
  }

  if (enableConsole) {
    transports.push(
      new winston.transports.Console({
        format: NODE_ENV === 'production' ? logFormat : consoleFormat,
      }),
    );
  }

  const logger = winston.createLogger({
    level,
    format: logFormat,
    transports,
    exitOnError: NODE_ENV !== 'production',
  });

  logger.info('Logger initialized', {
    level,
    environment: NODE_ENV,
    fileLogging: enableFile,
    consoleLogging: enableConsole,
    fileRetentionDays,
    maxFileSize,
  });

  defaultLogger = logger;
  return logger;
}

function getLogger() {
  return defaultLogger;
}

module.exports = {
  createLogger,
  getLogger,
};

Object.defineProperty(module.exports, 'default', {
  get() {
    return defaultLogger;
  },
  enumerable: true,
});
