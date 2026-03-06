import { IsUUID, IsNotEmpty } from 'class-validator';

export class CreateAnalysisTaskDto {
  @IsUUID()
  @IsNotEmpty()
  projectId: string;
}
