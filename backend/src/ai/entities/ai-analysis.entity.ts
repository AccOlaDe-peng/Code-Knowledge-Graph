import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from '../../project/project.entity';
import { AiModel } from './ai-model.entity';

export enum AiAnalysisType {
  CODE_SUMMARY = 'code_summary',
  SEMANTIC_ANALYSIS = 'semantic_analysis',
  RISK_ANALYSIS = 'risk_analysis',
  TECH_DEBT = 'tech_debt',
  DOCUMENTATION = 'documentation',
}

export enum AiAnalysisStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('ai_analyses')
export class AiAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id' })
  projectId: string;

  @Column({ name: 'file_path', nullable: true })
  filePath: string; // 分析的文件路径（可选）

  @Column({ name: 'analysis_type', type: 'enum', enum: AiAnalysisType })
  analysisType: AiAnalysisType;

  @Column({ name: 'model_id' })
  modelId: string;

  @Column({
    type: 'enum',
    enum: AiAnalysisStatus,
    default: AiAnalysisStatus.PENDING,
  })
  status: AiAnalysisStatus;

  @Column({ type: 'text', nullable: true })
  summary: string; // 代码功能总结

  @Column({ name: 'risk_level', nullable: true })
  riskLevel: string; // 'low', 'medium', 'high', 'critical'

  @Column({ name: 'tech_debt_score', type: 'int', nullable: true })
  techDebtScore: number; // 技术债评分 0-100

  @Column({ name: 'analysis_json', type: 'jsonb' })
  analysisJson: any; // 完整的 AI 分析结果（JSON 格式）

  @Column({ name: 'prompt_tokens', type: 'int', nullable: true })
  promptTokens: number;

  @Column({ name: 'completion_tokens', type: 'int', nullable: true })
  completionTokens: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @ManyToOne(() => AiModel)
  @JoinColumn({ name: 'model_id' })
  model: AiModel;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
