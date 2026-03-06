import { FileNode } from '../../../worker/code-analyzer.service';

export abstract class PromptTemplate {
  abstract render(fileNode: FileNode): string;
}
