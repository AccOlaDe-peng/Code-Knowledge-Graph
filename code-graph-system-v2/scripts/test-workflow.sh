#!/bin/bash

# Code Graph System v2 - Test Workflow Script
# This script tests the complete analysis workflow

set -e

echo "🧪 Testing Code Graph System v2 Workflow"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="http://localhost:3000"
SAMPLE_REPO="./examples/sample-repo"

# Step 1: Check if API server is running
echo -e "${BLUE}Step 1: Checking API server...${NC}"
if curl -s "${API_URL}/health" > /dev/null; then
    echo -e "${GREEN}✓ API server is running${NC}"
else
    echo -e "${YELLOW}⚠ API server is not running. Please start it with: ./scripts/start-backend.sh${NC}"
    exit 1
fi
echo ""

# Step 2: Create sample repository if it doesn't exist
echo -e "${BLUE}Step 2: Preparing sample repository...${NC}"
if [ ! -d "$SAMPLE_REPO" ]; then
    echo "Creating sample repository..."
    mkdir -p "$SAMPLE_REPO/src"

    # Create sample TypeScript files
    cat > "$SAMPLE_REPO/src/user.ts" << 'EOF'
export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  createUser(user: User): void {
    this.users.set(user.id, user);
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  deleteUser(id: string): boolean {
    return this.users.delete(id);
  }
}
EOF

    cat > "$SAMPLE_REPO/src/auth.ts" << 'EOF'
import { User, UserService } from './user';

export class AuthService {
  constructor(private userService: UserService) {}

  async login(email: string, password: string): Promise<User | null> {
    // Simplified login logic
    const users = Array.from(this.userService['users'].values());
    const user = users.find(u => u.email === email);
    return user || null;
  }

  async logout(userId: string): Promise<void> {
    console.log(`User ${userId} logged out`);
  }
}
EOF

    cat > "$SAMPLE_REPO/src/index.ts" << 'EOF'
import { UserService } from './user';
import { AuthService } from './auth';

const userService = new UserService();
const authService = new AuthService(userService);

// Create a sample user
userService.createUser({
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
});

// Login
authService.login('john@example.com', 'password123')
  .then(user => {
    if (user) {
      console.log('Login successful:', user.name);
    }
  });
EOF

    echo -e "${GREEN}✓ Sample repository created${NC}"
else
    echo -e "${GREEN}✓ Sample repository exists${NC}"
fi
echo ""

# Step 3: Trigger analysis
echo -e "${BLUE}Step 3: Triggering repository analysis...${NC}"
RESPONSE=$(curl -s -X POST "${API_URL}/api/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"repoPath\": \"${SAMPLE_REPO}\", \"repoName\": \"sample-repo\", \"enableAI\": false}")

JOB_ID=$(echo $RESPONSE | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
    echo -e "${YELLOW}⚠ Failed to start analysis${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi

echo -e "${GREEN}✓ Analysis started (Job ID: ${JOB_ID})${NC}"
echo ""

# Step 4: Wait for analysis to complete
echo -e "${BLUE}Step 4: Waiting for analysis to complete...${NC}"
MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    STATUS_RESPONSE=$(curl -s "${API_URL}/api/analyze/${JOB_ID}")
    STATUS=$(echo $STATUS_RESPONSE | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    PROGRESS=$(echo $STATUS_RESPONSE | grep -o '"progress":[0-9]*' | cut -d':' -f2)

    echo -ne "\rProgress: ${PROGRESS}% (Status: ${STATUS})   "

    if [ "$STATUS" = "completed" ]; then
        echo ""
        echo -e "${GREEN}✓ Analysis completed${NC}"
        break
    elif [ "$STATUS" = "failed" ]; then
        echo ""
        echo -e "${YELLOW}⚠ Analysis failed${NC}"
        echo "Response: $STATUS_RESPONSE"
        exit 1
    fi

    ATTEMPT=$((ATTEMPT + 1))
    sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo ""
    echo -e "${YELLOW}⚠ Analysis timeout${NC}"
    exit 1
fi
echo ""

# Step 5: Retrieve graph
echo -e "${BLUE}Step 5: Retrieving generated graph...${NC}"
GRAPH_RESPONSE=$(curl -s "${API_URL}/api/graph/sample-repo?graphType=graph")
NODE_COUNT=$(echo $GRAPH_RESPONSE | grep -o '"nodeCount":[0-9]*' | cut -d':' -f2)
EDGE_COUNT=$(echo $GRAPH_RESPONSE | grep -o '"edgeCount":[0-9]*' | cut -d':' -f2)

echo -e "${GREEN}✓ Graph retrieved${NC}"
echo "  Nodes: ${NODE_COUNT}"
echo "  Edges: ${EDGE_COUNT}"
echo ""

# Step 6: Get graph statistics
echo -e "${BLUE}Step 6: Getting graph statistics...${NC}"
STATS_RESPONSE=$(curl -s "${API_URL}/api/graph/sample-repo/stats?graphType=graph")
echo -e "${GREEN}✓ Statistics retrieved${NC}"
echo "$STATS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$STATS_RESPONSE"
echo ""

# Summary
echo "========================================"
echo -e "${GREEN}✅ Workflow test completed successfully!${NC}"
echo ""
echo "Next steps:"
echo "  1. Open http://localhost:5173 to view the frontend"
echo "  2. Load the 'sample-repo' graph"
echo "  3. Explore the visualization"
echo ""
