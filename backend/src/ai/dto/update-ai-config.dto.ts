import { IsString, IsOptional, IsUUID } from 'class-validator';

export class UpdateAiConfigDto {
  @IsOptional()
  @IsString()
  configName?: string;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsUUID()
  modelId?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;
}
