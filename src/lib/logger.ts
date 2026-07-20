type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const CONSOLE_METHOD: Record<LogLevel, keyof Console> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
}

class Logger {
  trace = (message: string, ...args: unknown[]): void => {
    this.log('trace', message, ...args)
  }

  debug = (message: string, ...args: unknown[]): void => {
    this.log('debug', message, ...args)
  }

  info = (message: string, ...args: unknown[]): void => {
    this.log('info', message, ...args)
  }

  warn = (message: string, ...args: unknown[]): void => {
    this.log('warn', message, ...args)
  }

  error = (message: string, ...args: unknown[]): void => {
    this.log('error', message, ...args)
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (import.meta.env.DEV) {
      const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`
      const method = CONSOLE_METHOD[level] as
        'debug' | 'info' | 'warn' | 'error'
      console[method](prefix, message, ...args)
      return
    }

    if (level === 'warn' || level === 'error') {
      this.forwardToBackend(level, message, args)
    }
  }

  private forwardToBackend(
    level: 'warn' | 'error',
    message: string,
    args: unknown[],
  ): void {
    void (async () => {
      try {
        const { warn: logWarn, error: logError } =
          await import('@tauri-apps/plugin-log')
        const fullMessage =
          args.length > 0 ? `${message} ${JSON.stringify(args)}` : message
        if (level === 'warn') logWarn(fullMessage)
        else logError(fullMessage)
      } catch {
        // Logging must never throw
      }
    })()
  }
}

export const logger = new Logger()
export const { trace, debug, info, warn, error } = logger
