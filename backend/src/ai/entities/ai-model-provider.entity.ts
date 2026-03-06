import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { AiModel } from './ai-model.entity';
import { AiApiKey } from './ai-api-key.entity';

@Entity('ai_model_providers')
export class AiModelProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string; // 'openai', 'claude', 'deepseek', 'glm'

  @Column({ name: 'display_name' })
  displayName: string; // 'OpenAI', 'Claude', 'DeepSeek', 'GLM'

  @Column({ name: 'base_url' })
  baseUrl: string; // API 基础 URL

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  enabled: boolean;

  @OneToMany(() => AiModel, (model) => model.provider)
  models: AiModel[];

  @OneToMany(() => AiApiKey, (apiKey) => apiKey.provider)
  apiKeys: AiApiKey[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
