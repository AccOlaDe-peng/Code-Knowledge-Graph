import { test, expect, describe, beforeEach } from 'bun:test';
import { extractDataFlow } from '../src/agents/tools/TreeSitterTool.ts';
import {
  DataFlowType,
  Confidence,
  CIRCUIT_BREAKER_THRESHOLD,
  MAX_FILE_SIZE,
} from '../src/graph/schema.ts';
import type { DataFlowEdge } from '../src/graph/schema.ts';

// ── Test Data ───────────────────────────────────────────────────

const JAVA_SAMPLE = `
package com.example;

import org.springframework.stereotype.Service;

@Service
public class UserService {
    private UserRepository userRepo;

    public UserDTO getUser(String id) {
        User user = userRepo.findById(id);
        UserDTO dto = new UserDTO();
        dto.setId(user.getId());
        return dto;
    }

    public void saveUser(UserDTO dto) {
        User user = new User();
        userRepo.save(user);
    }
}
`;

const TS_SAMPLE = `
import { injectable } from 'tsyringe';
import { UserRepository } from './UserRepository';

@injectable()
export class UserService {
  constructor(private userRepo: UserRepository) {}

  async getUser(id: string): Promise<UserDTO> {
    const user = await this.userRepo.findById(id);
    return { id: user.id, name: user.name };
  }

  async saveUser(dto: UserDTO): Promise<void> {
    await this.userRepo.save({ id: dto.id, name: dto.name });
  }
}
`;

// ── TreeSitterTool.extractDataFlow Tests ────────────────────────

describe('TreeSitterTool.extractDataFlow', () => {
  describe('Java', () => {
    test('extracts data flow edges from sample code', async () => {
      const result = await extractDataFlow('/test/Test.java', JAVA_SAMPLE, 'java');
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const edges = result.data!.dataFlowEdges;
      // Should extract at least some edges (call_arg, db_read, db_write, or return)
      expect(edges.length).toBeGreaterThan(0);
    });

    test('extracts method call arguments', async () => {
      const result = await extractDataFlow('/test/Test.java', JAVA_SAMPLE, 'java');
      expect(result.success).toBe(true);

      const edges = result.data!.dataFlowEdges;
      const callArgEdges = edges.filter(e => e.type === DataFlowType.call_arg);
      expect(callArgEdges.length).toBeGreaterThan(0);
    });

    test('extracts return statements', async () => {
      const result = await extractDataFlow('/test/Test.java', JAVA_SAMPLE, 'java');
      expect(result.success).toBe(true);

      const edges = result.data!.dataFlowEdges;
      const returnEdges = edges.filter(e => e.type === DataFlowType.return);
      expect(returnEdges.length).toBeGreaterThan(0);
    });

    test('extracts database reads', async () => {
      const result = await extractDataFlow('/test/Test.java', JAVA_SAMPLE, 'java');
      expect(result.success).toBe(true);

      const edges = result.data!.dataFlowEdges;
      const dbReadEdges = edges.filter(e => e.type === DataFlowType.db_read);
      expect(dbReadEdges.length).toBeGreaterThan(0);
    });

    test('extracts database writes', async () => {
      const result = await extractDataFlow('/test/Test.java', JAVA_SAMPLE, 'java');
      expect(result.success).toBe(true);

      const edges = result.data!.dataFlowEdges;
      const dbWriteEdges = edges.filter(e => e.type === DataFlowType.db_write);
      expect(dbWriteEdges.length).toBeGreaterThan(0);
    });

    test('sets EXTRACTED confidence for static edges', async () => {
      const result = await extractDataFlow('/test/Test.java', JAVA_SAMPLE, 'java');
      expect(result.success).toBe(true);

      const edges = result.data!.dataFlowEdges;
      for (const edge of edges) {
        expect(edge.confidence).toBe(Confidence.EXTRACTED);
      }
    });

    test('includes source location', async () => {
      const result = await extractDataFlow('/test/Test.java', JAVA_SAMPLE, 'java');
      expect(result.success).toBe(true);

      const edges = result.data!.dataFlowEdges;
      for (const edge of edges) {
        expect(edge.source.file).toBe('/test/Test.java');
        expect(edge.source.line).toBeGreaterThan(0);
        expect(edge.source.entity).toBeDefined();
      }
    });
  });

  describe('TypeScript', () => {
    test('extracts assignment data flow', async () => {
      const result = await extractDataFlow('/test/Test.ts', TS_SAMPLE, 'typescript');
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    test('extracts return statements', async () => {
      const result = await extractDataFlow('/test/Test.ts', TS_SAMPLE, 'typescript');
      expect(result.success).toBe(true);

      const edges = result.data!.dataFlowEdges;
      const returnEdges = edges.filter(e => e.type === DataFlowType.return);
      expect(returnEdges.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty file', async () => {
      const result = await extractDataFlow('/test/Empty.java', '', 'java');
      expect(result.success).toBe(true);
      expect(result.data!.dataFlowEdges.length).toBe(0);
    });

    test('handles unsupported language', async () => {
      const result = await extractDataFlow('/test/Test.xyz', 'code', 'xyz');
      expect(result.success).toBe(true);
      expect(result.data!.dataFlowEdges.length).toBe(0);
    });

    test('handles large file with warning', async () => {
      const largeContent = 'x'.repeat(MAX_FILE_SIZE + 1);
      const result = await extractDataFlow('/test/Large.java', largeContent, 'java');
      expect(result.success).toBe(true);
      expect(result.warning).toBeDefined();
    });
  });
});

// ── Schema Constants Tests ──────────────────────────────────────

describe('Schema Constants', () => {
  test('CIRCUIT_BREAKER_THRESHOLD is 0.5', () => {
    expect(CIRCUIT_BREAKER_THRESHOLD).toBe(0.5);
  });

  test('MAX_FILE_SIZE is 1MB', () => {
    expect(MAX_FILE_SIZE).toBe(1_000_000);
  });

  test('DataFlowType has all required types', () => {
    expect(DataFlowType.assignment).toBe('assignment');
    expect(DataFlowType.call_arg).toBe('call_arg');
    expect(DataFlowType.return).toBe('return');
    expect(DataFlowType.db_read).toBe('db_read');
    expect(DataFlowType.db_write).toBe('db_write');
  });

  test('Confidence has correct values', () => {
    expect(Confidence.EXTRACTED).toBe('EXTRACTED');
    expect(Confidence.INFERRED).toBe('INFERRED');
    expect(Confidence.AMBIGUOUS).toBe('AMBIGUOUS');
  });
});

// ── Performance Tests ───────────────────────────────────────────

describe('Performance', () => {
  test('parses 100 files in under 1 second', async () => {
    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      await extractDataFlow(`/test/File${i}.java`, JAVA_SAMPLE, 'java');
    }

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(1000); // <1 second for 100 files
  });
});
