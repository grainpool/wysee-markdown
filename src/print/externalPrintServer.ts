import * as http from 'http';
import { randomUUID } from 'crypto';
import { PrintBundle } from '../types';
import { TraceService } from '../diagnostics/trace';
import { ERROR_CODES } from '../diagnostics/errorCodes';

interface PrintJob {
  bundle: PrintBundle;
  expiresAt: number;
}

export class ExternalPrintServer {
  private server?: http.Server;
  private port?: number;
  private readonly jobs = new Map<string, PrintJob>();

  constructor(private readonly trace: TraceService) {}

  async ensureStarted(): Promise<number> {
    if (this.port) {
      return this.port;
    }
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolve());
    }).catch((error) => {
      this.trace.error({ code: ERROR_CODES.printBindFailed, component: 'print', message: 'Failed to bind print server', cause: error });
      throw error;
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Print server address unavailable.');
    }
    this.port = address.port;
    this.trace.info('Print server started', { port: this.port });
    return this.port;
  }

  createJob(bundle: PrintBundle): string {
    this.jobs.set(bundle.jobId, { bundle, expiresAt: Date.now() + 15 * 60 * 1000 });
    this.prune();
    return `http://127.0.0.1:${this.port}/job/${bundle.jobId}/${bundle.token}/index.html`;
  }

  canBind(): Promise<boolean> {
    return this.ensureStarted().then(() => true).catch(() => false);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!req.url) {
      res.writeHead(404).end();
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    const match = /^\/job\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (!match) {
      res.writeHead(404).end('Not found');
      return;
    }
    const [, jobId, token, rest] = match;
    const job = this.jobs.get(jobId);
    if (!job || job.bundle.token !== token || Date.now() > job.expiresAt) {
      res.writeHead(404).end('Expired');
      return;
    }
    if (req.method === 'POST' && rest === 'beacon') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        this.trace.info('Print beacon', { jobId, body });
        res.writeHead(204).end();
      });
      return;
    }
    if (rest === 'index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(job.bundle.html);
      return;
    }
    if (rest === 'app.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }).end(job.bundle.css);
      return;
    }
    if (rest === 'app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(job.bundle.js);
      return;
    }
    const asset = job.bundle.assets.find((item) => item.route === rest);
    if (asset) {
      res.writeHead(200, { 'Content-Type': asset.contentType }).end(asset.body);
      return;
    }
    res.writeHead(404).end('Not found');
  }

  private prune(): void {
    for (const [id, job] of this.jobs) {
      if (Date.now() > job.expiresAt) {
        this.jobs.delete(id);
      }
    }
  }
}

export function newJobId(): string {
  return randomUUID();
}
