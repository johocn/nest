import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const maxFiles = process.env.LOG_MAX_FILES || '14d';
const maxSize = process.env.LOG_MAX_SIZE || '20m';
const logLevel = process.env.LOG_LEVEL || 'info';

function createTransport(filename: string, level: string) {
  return new DailyRotateFile({
    filename: `logs/${filename}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxFiles,
    maxSize,
    level,
  });
}

export const loggerTransports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
    ),
    level: logLevel,
  }),
  createTransport('app', 'info'),
  createTransport('error', 'error'),
  createTransport('login', 'info'),
  createTransport('item-change', 'info'),
  createTransport('combat', 'info'),
  createTransport('recharge', 'info'),
  createTransport('gm-operate', 'info'),
];

export const winstonInstance = winston.createLogger({
  format: logFormat,
  transports: loggerTransports,
});
