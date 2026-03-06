import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from '../project/project.entity';

export enum RepositoryProvider {
  GITHUB = 'github',
  GITLAB = 'gitlab',
  ZIP = 'zip',
}

@Entity('repositories')
export class Repository {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id' })
  projectId: string;

  @Column({
    type: 'enum',
    enum: RepositoryProvider,
  })
  provider: RepositoryProvider;

  @Column({ name: 'repo_url', nullable: true })
  repoUrl: string;

  @Column({ nullable: true })
  branch: string;

  @ManyToOne(() => Project, (project) => project.repositories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
