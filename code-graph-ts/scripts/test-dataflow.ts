#!/usr/bin/env bun
import { extractDataFlow } from '../src/agents/tools/TreeSitterTool.ts';

const javaCode = `
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

async function test() {
  console.log('=== Testing Data Flow Extraction ===\n');

  const result = await extractDataFlow('/test/UserService.java', javaCode, 'java');

  console.log('Success:', result.success);
  console.log('File:', result.data?.filePath);
  console.log('Data flow edges found:', result.data?.dataFlowEdges.length || 0);

  if (result.data?.dataFlowEdges.length) {
    console.log('\nEdges:');
    result.data.dataFlowEdges.forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.type}: ${e.source.entity} -> ${e.target.entity} (line ${e.source.line})`);
    });
  }

  if (result.warning) console.log('\nWarning:', result.warning);
  if (result.error) console.log('\nError:', result.error);
}

test();
