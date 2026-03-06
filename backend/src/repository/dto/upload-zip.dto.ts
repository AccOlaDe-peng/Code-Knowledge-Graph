import { IsUUID, IsNotEmpty } from 'class-validator';

export class UploadZipDto {
  @IsUUID()
  @IsNotEmpty()
  projectId: string;
}
