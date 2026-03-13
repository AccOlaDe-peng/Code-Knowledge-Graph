import { Worker, Job, WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { TaskData, TaskType } from './task-queue';
import { JSONStorage } from '../storage';

/**
 * Task processor function type
 */
export type TaskProcessor = (job: Job<TaskData>) => Promise<any>;

/**
 * Worker manager for processing tasks from the queue
 */
export class TaskWorker {
  private worker: Worker;
  private redis: Redis;
  private processors: Map<string, TaskProcessor>;

  constructor(
    queueName: string = 'code-graph-tasks',
    redisUrl: string = 'redis://localhost:6379',
    concurrency: number = 5
  ) {
    this.processors = new Map();
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    // Create worker with options (use connection config instead of Redis instance)
    const workerOptions: WorkerOptions = {
      connection: {
        host: 'localhost',
        port: 6379,
      },
      concurrency,
      limiter: {
        max: 10, // Max 10 jobs per duration
        duration: 1000, // 1 second
      },
    };

    this.worker = new Worker(
      queueName,
      async (job: Job<TaskData>) => {
        return this.processJob(job);
      },
      workerOptions
    );

    // Register event handlers
    this.setupEventHandlers();

    // Register default processors
    this.registerDefaultProcessors();
  }

  /**
   * Register a task processor
   */
  registerProcessor(taskType: string, processor: TaskProcessor): void {
    this.processors.set(taskType, processor);
    console.log(`✓ Registered processor for: ${taskType}`);
  }

  /**
   * Process a job
   */
  private async processJob(job: Job<TaskData>): Promise<any> {
    const { type } = job.data;
    const processor = this.processors.get(type);

    if (!processor) {
      throw new Error(`No processor registered for task type: ${type}`);
    }

    console.log(`→ Processing job ${job.id}: ${type}`);

    try {
      const result = await processor(job);
      console.log(`✓ Completed job ${job.id}: ${type}`);
      return result;
    } catch (error) {
      console.error(`✗ Failed job ${job.id}: ${type}`, error);
      throw error;
    }
  }

  /**
   * Register default processors
   */
  private registerDefaultProcessors(): void {
    // Parse file processor (simplified - actual implementation would use parser)
    this.registerProcessor(TaskType.PARSE_FILE, async (job) => {
      const { repoId, filePath } = job.data as any;

      await job.updateProgress(50);

      console.log(`Processing file: ${filePath}`);

      await job.updateProgress(100);

      return { repoId, filePath, status: 'completed' };
    });

    // Build graph processor (simplified)
    this.registerProcessor(TaskType.BUILD_GRAPH, async (job) => {
      const { repoId, graphType } = job.data as any;

      await job.updateProgress(50);

      console.log(`Building graph: ${repoId}/${graphType}`);

      await job.updateProgress(100);

      return { repoId, graphType, status: 'completed' };
    });

    // Analyze repository processor
    this.registerProcessor(TaskType.ANALYZE_REPO, async (job) => {
      const { repoId, repoPath, languages } = job.data as any;

      await job.updateProgress(5);

      // This would integrate with the full analysis pipeline
      // For now, just a placeholder
      console.log(`Analyzing repository: ${repoPath}`);

      await job.updateProgress(100);

      return { repoId, status: 'completed' };
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      console.log(`✓ Job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, error) => {
      console.error(`✗ Job failed: ${job?.id}`, error.message);
    });

    this.worker.on('progress', (job, progress) => {
      console.log(`→ Job progress: ${job.id} - ${progress}%`);
    });

    this.worker.on('error', (error) => {
      console.error('Worker error:', error);
    });
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    await this.worker.pause();
    console.log('✓ Worker paused');
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume();
    console.log('✓ Worker resumed');
  }

  /**
   * Close the worker
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.redis.quit();
    console.log('✓ Worker closed');
  }
}
