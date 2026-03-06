import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../user/user.entity';
import { AiModelProvider } from './ai-model-provider.entity';
import { AiModel } from './ai-model.entity';

@Entity('ai_configs')
export class AiConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'config_name' })
  configName: string; // 配置名称，如"生产环境"、"测试环境"

  @Column({ name: 'provider_id' })
  providerId: string;

  @Column({ name: 'model_id' })
  modelId: string;

  @Column({ name: 'api_key' })
  apiKey: string; // 加密存储

  @Column({ name: 'base_url', nullable: true })
  baseUrl: string; // 自定义 API Base URL

  @Column({ name: 'is_active', default: false })
  isActive: boolean; // 是否为当前使用的配置

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => AiModelProvider)
  @JoinColumn({ name: 'provider_id' })
  provider: AiModelProvider;

  @ManyToOne(() => AiModel)
  @JoinColumn({ name: 'model_id' })
  model: AiModel;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
