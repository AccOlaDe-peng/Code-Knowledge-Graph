import { Worker, Job, WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { TaskData, TaskType } from './task-queue';
import { CodeParser } from '../parser';
import { GraphBuilder } from '../builder';
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

    // Create worker with options
    const workerOptions: WorkerOptions = {
      connection: this.redis,
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
    // Parse file processor
    this.registerProcessor(TaskType.PARSE_FILE, async (job) => {
      const { repoId, filePath, language, code } = job.data as any;

      await job.updateProgress(10);

      const parser = new CodeParser();
      const graph = await parser.parseCode(code, language, filePath);

      await job.updateProgress(90);

      // Store partial graph
      const storage = new JSONStorage();
      const graphId = await storage.saveGraph(repoId, `file-${filePath}`, graph);

      await job.updateProgress(100);

      return { graphId, nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
    });

    // Build graph processor
    this.registerProcessor(TaskType.BUILD_GRAPH, async (job) => {
      const { repoId, graphType } = job.data as any;

      await job.updateProgress(10);

      const storage = new JSONStorage();
      const builder = new GraphBuilder();

      // Load all file graphs
      const metadata = await storage.listGraphs();
      const fileGraphs = metadata.filter(m => m.graphId.startsWith(`${repoId}/file-`));

      await job.updateProgress(30);

      // Merge all graphs
      for (const meta of fileGraphs) {
        const graph = await storage.loadGraph(meta.graphId.split('/')[0], meta.graphId.split('/')[1]);
        builder.addGraph(graph);
      }

      await job.updateProgress(70);

      const mergedGraph = builder.build();

      // Save merged graph
      const graphId = await storage.saveGraph(repoId, graphType, mergedGraph);

      await job.updateProgress(100);

      return { graphId, nodeCount: mergedGraph.nodes.length, edgeCount: mergedGraph.edges.length };
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
