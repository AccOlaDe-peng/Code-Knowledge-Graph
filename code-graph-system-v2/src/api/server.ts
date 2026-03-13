import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { graphRoutes } from './routes/graph';
import { analyzeRoutes } from './routes/analyze';

export interface ServerConfig {
  port?: number;
  corsOrigin?: string;
}

export function createServer(config: ServerConfig = {}): Express {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigin || '*',
  }));
  app.use(morgan('dev'));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
    });
  });

  // API routes
  app.use('/api/graph', graphRoutes);
  app.use('/api/analyze', analyzeRoutes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.path} not found`,
    });
  });

  // Error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err);

    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  });

  return app;
}

export function startServer(config: ServerConfig = {}): void {
  const port = config.port || parseInt(process.env.PORT || '3000');
  const app = createServer(config);

  app.listen(port, () => {
    console.log(`
╔═══════════════════════════════════════╗
║  Code Graph System v2 API Server     ║
╚═══════════════════════════════════════╝

🚀 Server running on http://localhost:${port}
📖 API Documentation: http://localhost:${port}/api/graph
🏥 Health check: http://localhost:${port}/health

Environment: ${process.env.NODE_ENV || 'development'}
    `);
  });
}
