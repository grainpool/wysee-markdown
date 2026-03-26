import * as vscode from 'vscode';
import { WyseeErrorShape } from '../types';

const order = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 } as const;
export type TraceLevel = keyof typeof order;

export class TraceService {
  readonly channel: vscode.LogOutputChannel;
  private level: TraceLevel = 'info';

  constructor() {
    this.channel = vscode.window.createOutputChannel('Wysee MD', { log: true });
  }

  setLevel(level: TraceLevel): void {
    this.level = level;
  }

  trace(message: string, meta?: unknown): void {
    this.log('trace', message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta);
  }

  error(error: string | Error | WyseeErrorShape, meta?: unknown): void {
    if (typeof error === 'string') {
      this.log('error', error, meta);
      return;
    }
    if (error instanceof Error) {
      this.log('error', `${error.name}: ${error.message}`, { stack: error.stack, meta });
      return;
    }
    this.log('error', `${error.code} ${error.message}`, error);
  }

  show(): void {
    this.channel.show(true);
  }

  private log(level: TraceLevel, message: string, meta?: unknown): void {
    if (order[level] > order[this.level]) {
      return;
    }
    const text = meta === undefined ? message : `${message} ${safeStringify(meta)}`;
    switch (level) {
      case 'trace': this.channel.trace(text); break;
      case 'debug': this.channel.debug(text); break;
      case 'info': this.channel.info(text); break;
      case 'warn': this.channel.warn(text); break;
      case 'error': this.channel.error(text); break;
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}
