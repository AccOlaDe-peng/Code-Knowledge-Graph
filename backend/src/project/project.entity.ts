import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Repository } from '../repository/repository.entity';
import { AnalysisTask } from '../analysis/analysis-task.entity';

export enum ProjectStatus {
  PENDING = 'pending',
  ANALYZING = 'analyzing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: ProjectStatus,
    default: ProjectStatus.PENDING,
  })
  status: ProjectStatus;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.projects, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => Repository, (repository) => repository.project)
  repositories: Repository[];

  @OneToMany(() => AnalysisTask, (task) => task.project)
  analysisTasks: AnalysisTask[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
