import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ProjectStatus } from '../project.entity';

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;
}
