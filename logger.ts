import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: [
      'headers.authorization',
      'headers["x-api-key"]',
      'req.headers.authorization',
      '*.bearer',
      '*.*.bearer',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'nexus-orchestrator' },
});

export default logger;
