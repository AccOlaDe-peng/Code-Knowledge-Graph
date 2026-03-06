import { IsString, IsUUID, IsEnum, IsArray, IsOptional } from 'class-validator';
import { AiAnalysisType } from '../entities/ai-analysis.entity';

export class CreateAiAnalysisDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @IsOptional()
  filePath?: string;

  @IsEnum(AiAnalysisType)
  analysisType: AiAnalysisType;

  @IsUUID()
  @IsOptional()
  modelId?: string;
}

export class TriggerAiAnalysisDto {
  @IsArray()
  @IsEnum(AiAnalysisType, { each: true })
  analysisTypes: AiAnalysisType[];

  @IsUUID()
  @IsOptional()
  modelId?: string;
}
