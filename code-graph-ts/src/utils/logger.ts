type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info'

function log(level: LogLevel, msg: string, data?: unknown): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return
  const ts = new Date().toISOString()
  const line = data ? `[${ts}] ${level.toUpperCase()} ${msg}` : `[${ts}] ${level.toUpperCase()} ${msg}`
  if (level === 'error') {
    console.error(line, data ?? '')
  } else if (level === 'warn') {
    console.warn(line, data ?? '')
  } else {
    console.log(line, data ?? '')
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
}
