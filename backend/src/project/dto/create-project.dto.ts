import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { RepositoryProvider } from '../../repository/repository.entity';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(RepositoryProvider)
  @IsOptional()
  provider?: RepositoryProvider;

  @IsString()
  @IsOptional()
  repositoryUrl?: string;

  @IsString()
  @IsOptional()
  branch?: string;
}
