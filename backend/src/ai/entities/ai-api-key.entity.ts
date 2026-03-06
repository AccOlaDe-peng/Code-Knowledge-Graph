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

export enum ApiKeyStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  EXPIRED = 'expired',
}

@Entity('ai_api_keys')
export class AiApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'provider_id' })
  providerId: string;

  @Column({ name: 'api_key' })
  apiKey: string; // 加密存储

  @Column({ name: 'key_name', nullable: true })
  keyName: string; // 用户自定义名称

  @Column({ name: 'base_url', nullable: true })
  baseUrl: string; // 用户自定义 API Base URL，覆盖 provider 默认值

  @Column({
    type: 'enum',
    enum: ApiKeyStatus,
    default: ApiKeyStatus.ACTIVE,
  })
  status: ApiKeyStatus;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => AiModelProvider, (provider) => provider.apiKeys)
  @JoinColumn({ name: 'provider_id' })
  provider: AiModelProvider;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
