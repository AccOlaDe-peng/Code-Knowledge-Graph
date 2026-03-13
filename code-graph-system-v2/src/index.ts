// Main entry point for Code Graph System v2
import dotenv from 'dotenv';
import { startServer } from './api/server';

// Load environment variables
dotenv.config();

async function main() {
  console.log('Code Graph System v2');
  console.log('====================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`LLM Provider: ${process.env.LLM_PROVIDER || 'anthropic'}`);
  console.log('');

  // Start API server
  startServer({
    port: parseInt(process.env.PORT || '3000'),
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
