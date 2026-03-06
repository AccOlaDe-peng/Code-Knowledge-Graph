import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateAiConfigDto {
  @IsString()
  configName: string;

  @IsUUID()
  providerId: string;

  @IsUUID()
  modelId: string;

  @IsString()
  apiKey: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;
}
