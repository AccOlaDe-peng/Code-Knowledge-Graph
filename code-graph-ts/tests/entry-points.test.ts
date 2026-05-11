import { describe, test, expect } from 'bun:test';
import { LayerId } from '../src/graph/schema.ts';

// 复制 frontend.ts 中的函数进行测试
const ENTRY_ANNOTATIONS: Record<LayerId, RegExp[]> = {
  [LayerId.api]: [/Controller/, /RestController/, /Endpoint/, /RequestMapping/],
  [LayerId.business]: [/Service/, /Component/, /Facade/, /Manager/],
  [LayerId.data]: [/Repository/, /Dao/, /Mapper/],
  [LayerId.infrastructure]: [],
};

function isEntryPoint(
  node: { id: string; metadata?: { annotations?: string[] } },
  nodeLayer: LayerId,
  crossLayerCallers: Map<string, Set<LayerId>>
): boolean {
  const annotations = node.metadata?.annotations ?? [];
  const patterns = ENTRY_ANNOTATIONS[nodeLayer] ?? [];

  if (annotations.some((a: string) => patterns.some(p => p.test(a)))) {
    return true;
  }

  const callers = crossLayerCallers.get(node.id);
  if (callers) {
    for (const callerLayer of callers) {
      if (callerLayer !== nodeLayer) {
        return true;
      }
    }
  }

  return false;
}

function extractDocSummary(docComment: string | undefined): string | null {
  if (!docComment) return null;

  const summaryMatch = docComment.match(/@summary\s+(.+)/);
  if (summaryMatch) {
    return summaryMatch[1]!.trim().slice(0, 80);
  }

  const lines = docComment.split('\n').filter(l => l.trim() && !l.startsWith('@'));
  if (lines.length > 0) {
    const firstLine = lines[0]!.trim();
    const sentenceEnd = firstLine.search(/[.。]/);
    if (sentenceEnd > 0) {
      return firstLine.slice(0, sentenceEnd + 1);
    }
    return firstLine.slice(0, 50);
  }

  return null;
}

function filterKeyMethods(methods: string[] | undefined): string[] {
  if (!methods) return [];

  const businessPatterns = /^(get|save|update|delete|process|handle|create|find|query|list|add|remove)/i;
  return methods.filter(m => businessPatterns.test(m)).slice(0, 3);
}

describe('isEntryPoint', () => {
  test('returns true for node with @Controller annotation', () => {
    const node = { id: 'test', metadata: { annotations: ['@Controller'] } };
    const callers = new Map<string, Set<LayerId>>();

    expect(isEntryPoint(node, LayerId.api, callers)).toBe(true);
  });

  test('returns true for node with @Service annotation', () => {
    const node = { id: 'test', metadata: { annotations: ['@Service'] } };
    const callers = new Map<string, Set<LayerId>>();

    expect(isEntryPoint(node, LayerId.business, callers)).toBe(true);
  });

  test('returns true for node with cross-layer callers', () => {
    const node = { id: 'test', metadata: { annotations: [] } };
    const callers = new Map<string, Set<LayerId>>();
    callers.set('test', new Set([LayerId.api]));

    expect(isEntryPoint(node, LayerId.business, callers)).toBe(true);
  });

  test('returns false for internal helper class', () => {
    const node = { id: 'test', metadata: { annotations: [] } };
    const callers = new Map<string, Set<LayerId>>();
    // 同层调用，不是入口
    callers.set('test', new Set([LayerId.data]));

    expect(isEntryPoint(node, LayerId.data, callers)).toBe(false);
  });
});

describe('extractDocSummary', () => {
  test('extracts @summary tag', () => {
    const doc = '@summary 用户认证服务';
    expect(extractDocSummary(doc)).toBe('用户认证服务');
  });

  test('extracts first sentence', () => {
    const doc = '用户认证服务，处理登录和注销。后续内容不需要。';
    expect(extractDocSummary(doc)).toBe('用户认证服务，处理登录和注销。');
  });

  test('returns null for undefined', () => {
    expect(extractDocSummary(undefined)).toBe(null);
  });

  test('limits to 50 chars when no sentence end', () => {
    const doc = '这是一个非常长的描述文字没有任何句号结尾';
    expect(extractDocSummary(doc)).toBe('这是一个非常长的描述文字没有任何句号结尾');
  });
});

describe('filterKeyMethods', () => {
  test('filters business semantic methods', () => {
    const methods = ['getUser', 'saveUser', 'internalHelper', 'deleteUser'];
    expect(filterKeyMethods(methods)).toEqual(['getUser', 'saveUser', 'deleteUser']);
  });

  test('returns empty array for undefined', () => {
    expect(filterKeyMethods(undefined)).toEqual([]);
  });

  test('limits to 3 methods', () => {
    const methods = ['getUser', 'saveUser', 'deleteUser', 'updateUser', 'listUsers'];
    expect(filterKeyMethods(methods)).toEqual(['getUser', 'saveUser', 'deleteUser']);
  });
});
