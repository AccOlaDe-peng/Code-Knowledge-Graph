#!/usr/bin/env bun
/**
 * Phase 0 Spike: Tree-sitter WASM + Bun Compatibility Validation
 *
 * Goals:
 * 1. Verify web-tree-sitter loads in Bun
 * 2. Load Java and TypeScript language packs
 * 3. Parse sample files
 * 4. Measure parsing performance
 */

const SAMPLE_JAVA = `
package com.example;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class UserService {
    @Autowired
    private UserRepository userRepo;

    public UserDTO getUser(String id) {
        User user = userRepo.findById(id);
        UserDTO dto = new UserDTO();
        dto.setId(user.getId());
        dto.setName(user.getName());
        return dto;
    }

    public void saveUser(UserDTO dto) {
        User user = new User();
        user.setId(dto.getId());
        user.setName(dto.getName());
        userRepo.save(user);
    }
}
`;

const SAMPLE_TYPESCRIPT = `
import { injectable, inject } from 'tsyringe';
import { UserRepository } from './UserRepository';

@injectable()
export class UserService {
  constructor(
    @inject('UserRepository') private userRepo: UserRepository
  ) {}

  async getUser(id: string): Promise<UserDTO> {
    const user = await this.userRepo.findById(id);
    return {
      id: user.id,
      name: user.name,
    };
  }

  async saveUser(dto: UserDTO): Promise<void> {
    await this.userRepo.save({
      id: dto.id,
      name: dto.name,
    });
  }
}
`;

async function main() {
  console.log('=== Phase 0 Spike: Tree-sitter WASM + Bun ===\n');

  // Step 1: Load web-tree-sitter
  console.log('[1/5] Loading web-tree-sitter...');
  const startTime = performance.now();

  let wts: any;
  let ParserClass: any;
  let Language: any;
  try {
    // web-tree-sitter v0.26+ requires Parser.init() before creating instances
    wts = await import('web-tree-sitter');
    ParserClass = wts.Parser;
    Language = wts.Language;

    if (!ParserClass) {
      throw new Error('Parser not found in web-tree-sitter exports');
    }

    // Must call init() before creating Parser instances
    await ParserClass.init();

    const loadTime = performance.now() - startTime;
    console.log(`      ✓ Loaded and initialized in ${loadTime.toFixed(0)}ms`);
  } catch (error) {
    console.log(`      ✗ FAILED: ${error}`);
    console.log('\n[RESULT] web-tree-sitter cannot load in Bun');
    console.log('         Falling back to regex-based extraction');
    process.exit(1);
  }

  // Step 2: Load Java language
  console.log('\n[2/5] Loading Java language pack...');
  const javaStart = performance.now();

  let Java: any;
  try {
    // Load WASM file from filesystem
    const fs = await import('fs');
    const path = await import('path');

    // Try multiple paths for Java language WASM
    const javaWasmPaths = [
      'node_modules/tree-sitter-java/dist/tree-sitter-java.wasm',
      'node_modules/tree-sitter-java/tree-sitter-java.wasm',
    ];

    let javaWasmBuffer: Buffer | null = null;
    for (const p of javaWasmPaths) {
      const fullPath = path.resolve(p);
      if (fs.existsSync(fullPath)) {
        javaWasmBuffer = fs.readFileSync(fullPath);
        console.log(`      Found at: ${p}`);
        break;
      }
    }

    if (javaWasmBuffer) {
      Java = await Language.load(javaWasmBuffer);
      const javaLoadTime = performance.now() - javaStart;
      console.log(`      ✓ Java loaded in ${javaLoadTime.toFixed(0)}ms`);
    } else {
      console.log(`      ✗ WASM file not found`);
      console.log('\n[FALLBACK] Java language pack not available');
      console.log('           Install: bun add tree-sitter-java');
    }
  } catch (error) {
    console.log(`      ✗ FAILED: ${error}`);
  }

  // Step 3: Load TypeScript language
  console.log('\n[3/5] Loading TypeScript language pack...');
  const tsStart = performance.now();

  let TypeScript: any;
  try {
    const fs = await import('fs');
    const path = await import('path');

    const tsWasmPaths = [
      'node_modules/tree-sitter-typescript/dist/tree-sitter-typescript.wasm',
      'node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm',
    ];

    let tsWasmBuffer: Buffer | null = null;
    for (const p of tsWasmPaths) {
      const fullPath = path.resolve(p);
      if (fs.existsSync(fullPath)) {
        tsWasmBuffer = fs.readFileSync(fullPath);
        console.log(`      Found at: ${p}`);
        break;
      }
    }

    if (tsWasmBuffer) {
      TypeScript = await Language.load(tsWasmBuffer);
      const tsLoadTime = performance.now() - tsStart;
      console.log(`      ✓ TypeScript loaded in ${tsLoadTime.toFixed(0)}ms`);
    } else {
      console.log(`      ✗ WASM file not found`);
      console.log('\n[FALLBACK] TypeScript language pack not available');
      console.log('           Install: bun add tree-sitter-typescript');
    }
  } catch (error) {
    console.log(`      ✗ FAILED: ${error}`);
  }

  // Step 4: Parse sample files
  console.log('\n[4/5] Parsing sample files...');

  if (Java) {
    console.log('\n      Java parsing:');
    const parser = new ParserClass();
    parser.setLanguage(Java);

    const javaParseStart = performance.now();
    const javaTree = parser.parse(SAMPLE_JAVA);
    const javaParseTime = performance.now() - javaParseStart;

    console.log(`      ✓ Parsed in ${javaParseTime.toFixed(2)}ms`);
    console.log(`      ✓ Root node: ${javaTree.rootNode.type}`);
    console.log(`      ✓ Children: ${javaTree.rootNode.childCount}`);

    // Extract classes and methods
    const classes = javaTree.rootNode.children
      .filter((n: any) => n.type === 'class_declaration')
      .map((n: any) => n.text.split('{')[0]?.trim());
    console.log(`      ✓ Classes: ${classes.join(', ')}`);

    // Test query for method invocations
    console.log('\n      Testing data flow query (Java):');
    const Query = wts.Query;
    const query = new Query(Java, `
      (method_invocation
        object: (identifier) @source
        name: (identifier) @method
        arguments: (argument_list)) @call
    `);
    const matches = query.matches(javaTree.rootNode);
    console.log(`      ✓ Found ${matches.length} method invocations`);

    // Show sample matches
    matches.slice(0, 3).forEach((m: any, i: number) => {
      const source = m.captures.find((c: any) => c.name === 'source')?.node.text;
      const method = m.captures.find((c: any) => c.name === 'method')?.node.text;
      console.log(`        ${i + 1}. ${source}.${method}()`);
    });
  }

  if (TypeScript) {
    console.log('\n      TypeScript parsing:');
    const parser = new ParserClass();
    parser.setLanguage(TypeScript);

    const tsParseStart = performance.now();
    const tsTree = parser.parse(SAMPLE_TYPESCRIPT);
    const tsParseTime = performance.now() - tsParseStart;

    console.log(`      ✓ Parsed in ${tsParseTime.toFixed(2)}ms`);
    console.log(`      ✓ Root node: ${tsTree.rootNode.type}`);
    console.log(`      ✓ Children: ${tsTree.rootNode.childCount}`);
  }

  // Step 5: Performance benchmark
  console.log('\n[5/5] Performance benchmark (100 iterations)...');

  if (Java) {
    const parser = new ParserClass();
    parser.setLanguage(Java);

    const iterations = 100;
    const benchStart = performance.now();

    for (let i = 0; i < iterations; i++) {
      parser.parse(SAMPLE_JAVA);
    }

    const benchTime = performance.now() - benchStart;
    const avgTime = benchTime / iterations;
    console.log(`\n      Java: ${iterations} parses in ${benchTime.toFixed(0)}ms (avg: ${avgTime.toFixed(2)}ms)`);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`web-tree-sitter: ${ParserClass ? '✓ Available' : '✗ Not available'}`);
  console.log(`Java language: ${Java ? '✓ Loaded' : '✗ Not loaded'}`);
  console.log(`TypeScript language: ${TypeScript ? '✓ Loaded' : '✗ Not loaded'}`);
  console.log('\nRecommendation:');

  if (Java && TypeScript) {
    console.log('  ✓ Tree-sitter WASM works in Bun. Proceed with Phase 1 implementation.');
  } else if (ParserClass) {
    console.log('  ⚠ Parser loads but language packs missing.');
    console.log('  ⚠ Run: bun add tree-sitter-java tree-sitter-typescript');
  } else {
    console.log('  ✗ Use regex fallback for static extraction.');
    console.log('  ✗ LLM pass only for ambiguous edges.');
  }
}

main().catch(console.error);
