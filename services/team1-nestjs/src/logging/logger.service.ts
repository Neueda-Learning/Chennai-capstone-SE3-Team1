import { Injectable, LoggerService, LogLevel, Scope } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export type LogSource =
  | 'app'
  | 'health'
  | 'database'
  | 'kafka'
  | 'orders'
  | 'market-data'
  | 'trade-events'
  | 'http'
  | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  context?: string;
  trace?: string;
  metadata?: Record<string, any>;
}

@Injectable({ scope: Scope.TRANSIENT })
export class MultiFileLogger implements LoggerService {
  private readonly logDir: string;
  private readonly writers: Map<LogSource, fs.WriteStream> = new Map();
  private readonly defaultLevels: LogLevel[] = [
    'log',
    'error',
    'warn',
    'debug',
    'verbose',
  ];

  constructor() {
    this.logDir = path.resolve(process.cwd(), 'logs');
    this.ensureLogDirectory();
    this.initializeWriters();
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    const sources: LogSource[] = [
      'app',
      'health',
      'database',
      'kafka',
      'orders',
      'market-data',
      'trade-events',
      'http',
      'error',
    ];

    for (const source of sources) {
      const sourceDir = path.join(this.logDir, source);
      if (!fs.existsSync(sourceDir)) {
        fs.mkdirSync(sourceDir, { recursive: true });
      }
    }
  }

  private initializeWriters(): void {
    const sources: LogSource[] = [
      'app',
      'health',
      'database',
      'kafka',
      'orders',
      'market-data',
      'trade-events',
      'http',
      'error',
    ];

    for (const source of sources) {
      const logFile = path.join(
        this.logDir,
        source,
        `${source}-${this.getDateString()}.log`,
      );
      const writer = fs.createWriteStream(logFile, { flags: 'a' });
      this.writers.set(source, writer);
    }
  }

  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getWriter(source: LogSource): fs.WriteStream {
    return this.writers.get(source) || this.writers.get('app')!;
  }

  private formatEntry(entry: LogEntry): string {
    const meta = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
    const ctx = entry.context ? ` [${entry.context}]` : '';
    const trace = entry.trace ? `\n${entry.trace}` : '';
    return `${entry.timestamp} [${entry.level.toUpperCase()}]${ctx} ${entry.message}${meta}${trace}\n`;
  }

  private write(
    source: LogSource,
    level: LogLevel,
    message: string,
    context?: string,
    metadata?: Record<string, any>,
    trace?: string,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      context,
      trace,
      metadata,
    };

    const writer = this.getWriter(source);
    writer.write(this.formatEntry(entry));

    if (level === 'error') {
      const errorWriter = this.getWriter('error');
      errorWriter.write(this.formatEntry(entry));
    }
  }

  log(message: string, context?: string, metadata?: Record<string, any>): void {
    this.write('app', 'log', message, context, metadata);
  }

  error(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    this.write('app', 'error', message, context, metadata, trace);
  }

  warn(
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    this.write('app', 'warn', message, context, metadata);
  }

  debug(
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    this.write('app', 'debug', message, context, metadata);
  }

  verbose(
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    this.write('app', 'verbose', message, context, metadata);
  }

  logFromSource(
    source: LogSource,
    level: LogLevel,
    message: string,
    context?: string,
    metadata?: Record<string, any>,
    trace?: string,
  ): void {
    this.write(source, level, message, context, metadata, trace);
  }

  onModuleDestroy(): void {
    for (const writer of this.writers.values()) {
      writer.end();
    }
  }
}

export function createSourceLogger(logger: MultiFileLogger, source: LogSource) {
  return {
    log: (message: string, context?: string, metadata?: Record<string, any>) =>
      logger.logFromSource(source, 'log', message, context, metadata),
    error: (
      message: string,
      trace?: string,
      context?: string,
      metadata?: Record<string, any>,
    ) =>
      logger.logFromSource(source, 'error', message, context, metadata, trace),
    warn: (message: string, context?: string, metadata?: Record<string, any>) =>
      logger.logFromSource(source, 'warn', message, context, metadata),
    debug: (
      message: string,
      context?: string,
      metadata?: Record<string, any>,
    ) => logger.logFromSource(source, 'debug', message, context, metadata),
    verbose: (
      message: string,
      context?: string,
      metadata?: Record<string, any>,
    ) => logger.logFromSource(source, 'verbose', message, context, metadata),
  };
}
