import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AiModelProvider } from './ai-model-provider.entity';

@Entity('ai_models')
export class AiModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  providerId: string;

  @Column({ name: 'model_name' })
  modelName: string; // 'gpt-4o', 'claude-3-sonnet', 'deepseek-chat'

  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ name: 'max_tokens', type: 'int' })
  maxTokens: number;

  @Column({ name: 'context_window', type: 'int' })
  contextWindow: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  pricing: number; // 每 1K tokens 价格

  @Column({ default: true })
  enabled: boolean;

  @ManyToOne(() => AiModelProvider, (provider) => provider.models)
  @JoinColumn({ name: 'provider_id' })
  provider: AiModelProvider;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
