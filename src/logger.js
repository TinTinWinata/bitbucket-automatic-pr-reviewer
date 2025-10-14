import winston from "winston";
import "winston-daily-rotate-file";

// Daily Rotate File transport configuration
const fileRotateTransport = new winston.transports.DailyRotateFile({
  filename: "logs/app-%DATE%.log",     // name of the log file
  datePattern: "YYYY-MM-DD",           // date pattern
  zippedArchive: true,                 // compress old logs
  maxSize: "20m",                      // maximum size of log file
  maxFiles: "14d",                     // keep logs for 14 days
});

// Criação do logger
const logger = winston.createLogger({
  level: "info", // levels: error, warn, info, http, verbose, debug, silly
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      (info) => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`
    )
  ),
  transports: [
    fileRotateTransport,
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

export default logger;
