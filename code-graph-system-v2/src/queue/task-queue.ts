import { Queue, QueueOptions } from 'bullmq';
import { Redis } from 'ioredis';

/**
 * Task types for the queue
 */
export const TaskType = {
  PARSE_FILE: 'parse_file',
  BUILD_GRAPH: 'build_graph',
  ANALYZE_REPO: 'analyze_repo',
} as const;

export type TaskTypeValue = typeof TaskType[keyof typeof TaskType];

/**
 * Task data structures
 */
export interface ParseFileTask {
  type: typeof TaskType.PARSE_FILE;
  repoId: string;
  filePath: string;
  language: string;
  code: string;
}

export interface BuildGraphTask {
  type: typeof TaskType.BUILD_GRAPH;
  repoId: string;
  graphType: string;
}

export interface AnalyzeRepoTask {
  type: typeof TaskType.ANALYZE_REPO;
  repoId: string;
  repoPath: string;
  languages?: string[];
}

export type TaskData = ParseFileTask | BuildGraphTask | AnalyzeRepoTask;

/**
 * Task queue manager using BullMQ
 */
export class TaskQueue {
  private queue: Queue;
  private redis: Redis;

  constructor(
    queueName: string = 'code-graph-tasks',
    redisUrl: string = 'redis://localhost:6379'
  ) {
    // Create Redis connection
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    // Create queue with options (use connection string instead of Redis instance)
    const queueOptions: QueueOptions = {
      connection: {
        host: 'localhost',
        port: 6379,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          count: 100, // Keep last 100 completed jobs
        },
        removeOnFail: {
          count: 50, // Keep last 50 failed jobs
        },
      },
    };

    this.queue = new Queue(queueName, queueOptions);
  }

  /**
   * Add a task to the queue
   */
  async addTask(
    taskData: TaskData,
    options?: {
      priority?: number;
      delay?: number;
      jobId?: string;
    }
  ): Promise<string> {
    const job = await this.queue.add(taskData.type, taskData, {
      priority: options?.priority,
      delay: options?.delay,
      jobId: options?.jobId,
    });

    console.log(`✓ Task added to queue: ${job.id} (${taskData.type})`);
    return job.id!;
  }

  /**
   * Add multiple tasks in bulk
   */
  async addBulk(tasks: TaskData[]): Promise<string[]> {
    const jobs = tasks.map(task => ({
      name: task.type,
      data: task,
    }));

    const addedJobs = await this.queue.addBulk(jobs);
    const jobIds = addedJobs.map(job => job.id!);

    console.log(`✓ Added ${jobIds.length} tasks to queue`);
    return jobIds;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<{
    state: string;
    progress: number;
    result?: any;
    error?: string;
  }> {
    const job = await this.queue.getJob(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const state = await job.getState();
    const progress = job.progress as number;

    return {
      state,
      progress,
      result: job.returnvalue,
      error: job.failedReason,
    };
  }

  /**
   * Wait for a job to complete
   */
  async waitForJob(jobId: string, timeout: number = 60000): Promise<any> {
    const job = await this.queue.getJob(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Wait for job completion
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Job timeout'));
      }, timeout);

      const checkJob = async () => {
        const state = await job.getState();
        if (state === 'completed') {
          clearTimeout(timeoutId);
          resolve(job.returnvalue);
        } else if (state === 'failed') {
          clearTimeout(timeoutId);
          reject(new Error(job.failedReason || 'Job failed'));
        } else {
          setTimeout(checkJob, 1000);
        }
      };

      checkJob();
    });
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    console.log('✓ Queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    console.log('✓ Queue resumed');
  }

  /**
   * Clear all jobs from the queue
   */
  async clear(): Promise<void> {
    await this.queue.drain();
    console.log('✓ Queue cleared');
  }

  /**
   * Close the queue and Redis connection
   */
  async close(): Promise<void> {
    await this.queue.close();
    await this.redis.quit();
    console.log('✓ Queue closed');
  }
}
