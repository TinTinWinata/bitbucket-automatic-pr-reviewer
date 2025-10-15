import winston from "winston";
import "winston-daily-rotate-file";
import dotenv from "dotenv";
dotenv.config();

// Environment variables with defaults
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_FILE_RETENTION_DAYS = process.env.LOG_FILE_RETENTION_DAYS || "30";
const LOG_MAX_FILE_SIZE = process.env.LOG_MAX_FILE_SIZE || "20m";
const LOG_ENABLE_CONSOLE = process.env.LOG_ENABLE_CONSOLE !== "false";
const LOG_ENABLE_FILE = process.env.LOG_ENABLE_FILE !== "false";
const NODE_ENV = process.env.NODE_ENV || "development";

// Determine log level based on environment
const getLogLevel = () => {
  if (LOG_LEVEL !== "info") {
    return LOG_LEVEL; // Use explicitly set log level
  }
  
  // Default environment-based levels
  switch (NODE_ENV) {
    case "production":
      return "warn";
    case "development":
      return "debug";
    case "test":
      return "error";
    default:
      return "info";
  }
};

// Common log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(
    (info) => {
      const { timestamp, level, message, stack } = info;
      return `${timestamp} [${level.toUpperCase()}]: ${message}${stack ? `\n${stack}` : ""}`;
    }
  )
);

// Console format with colors for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.printf(
    (info) => {
      const { timestamp, level, message, stack } = info;
      return `${timestamp} [${level}]: ${message}${stack ? `\n${stack}` : ""}`;
    }
  )
);

// Configure transports based on environment variables
const transports = [];

// File transport (if enabled)
if (LOG_ENABLE_FILE) {
  const fileRotateTransport = new winston.transports.DailyRotateFile({
    filename: "logs/app-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: LOG_MAX_FILE_SIZE,
    maxFiles: `${LOG_FILE_RETENTION_DAYS}d`,
    format: logFormat,
  });

  // Error handling for file transport
  fileRotateTransport.on("error", (error) => {
    console.error("Logger file transport error:", error);
  });

  transports.push(fileRotateTransport);
}

// Console transport (if enabled)
if (LOG_ENABLE_CONSOLE) {
  transports.push(
    new winston.transports.Console({
      format: NODE_ENV === "production" ? logFormat : consoleFormat,
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: getLogLevel(),
  format: logFormat,
  transports,
  // Prevent Winston from exiting on uncaught exceptions in production
  exitOnError: NODE_ENV !== "production",
});

// Add metadata about logger configuration
logger.info("Logger initialized", {
  level: getLogLevel(),
  environment: NODE_ENV,
  fileLogging: LOG_ENABLE_FILE,
  consoleLogging: LOG_ENABLE_CONSOLE,
  fileRetentionDays: LOG_FILE_RETENTION_DAYS,
  maxFileSize: LOG_MAX_FILE_SIZE,
});

export default logger;
