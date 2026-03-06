import { IsString, IsNotEmpty, IsEnum, IsUUID } from 'class-validator';
import { RepositoryProvider } from '../repository.entity';

export class CreateRepositoryDto {
  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @IsEnum(RepositoryProvider)
  provider: RepositoryProvider;

  @IsString()
  @IsNotEmpty()
  repoUrl: string;

  @IsString()
  @IsNotEmpty()
  branch: string;
}
