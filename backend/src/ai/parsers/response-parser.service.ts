import { Injectable, Logger } from '@nestjs/common';
import { AiAnalysisType } from '../entities/ai-analysis.entity';

@Injectable()
export class ResponseParserService {
  private readonly logger = new Logger(ResponseParserService.name);

  async parse(response: string, analysisType: AiAnalysisType): Promise<any> {
    const attempts = [
      response,
      this.extractJson(response),
    ].filter(Boolean) as string[];

    for (const candidate of attempts) {
      try {
        const cleaned = this.sanitize(candidate);
        const parsed = JSON.parse(cleaned);
        this.validate(parsed, analysisType);
        return parsed;
      } catch (error) {
        this.logger.debug(`Parse attempt failed: ${error.message}`);
      }
    }

    throw new Error('Invalid AI response format');
  }

  private sanitize(text: string): string {
    // 第一步：移除非法控制字符（保留 \t \n \r）
    const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 第二步：将 JSON 字符串值内的裸换行/制表符转义，避免 "Unterminated string" 错误
    let result = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];

      if (escaped) {
        result += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\' && inString) {
        result += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        result += ch;
        continue;
      }

      if (inString) {
        if (ch === '\n') { result += '\\n'; continue; }
        if (ch === '\r') { result += '\\r'; continue; }
        if (ch === '\t') { result += '\\t'; continue; }
      }

      result += ch;
    }

    return result;
  }

  private validate(data: any, type: AiAnalysisType): void {
    switch (type) {
      case AiAnalysisType.CODE_SUMMARY:
        if (!data.summary || !data.keyComponents) {
          throw new Error('Invalid code summary format');
        }
        break;
      case AiAnalysisType.RISK_ANALYSIS:
        if (!data.overallRiskLevel || !data.risks) {
          throw new Error('Invalid risk analysis format');
        }
        break;
      case AiAnalysisType.TECH_DEBT:
        if (typeof data.qualityScore !== 'number' || !data.techDebts) {
          throw new Error('Invalid tech debt format');
        }
        break;
    }
  }

  private extractJson(text: string): string | null {
    // 匹配 ```json ... ``` 或 ``` ... ```（贪婪匹配，避免内容中含反引号时提前截断）
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*)```/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    // 直接提取最外层 JSON 对象
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return text.slice(start, end + 1);
    }

    return null;
  }
}
