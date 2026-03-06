import { IsString, IsUUID, IsOptional, IsEnum } from 'class-validator';
import { ApiKeyStatus } from '../entities/ai-api-key.entity';

export class CreateAiApiKeyDto {
  @IsUUID()
  providerId: string;

  @IsString()
  apiKey: string;

  @IsString()
  @IsOptional()
  keyName?: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;

  @IsEnum(ApiKeyStatus)
  @IsOptional()
  status?: ApiKeyStatus;
}
