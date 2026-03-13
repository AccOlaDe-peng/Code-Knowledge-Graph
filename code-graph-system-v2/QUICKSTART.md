# 快速开始指南

## 当前项目状态

✅ **已完成**：完整的 MVP 系统（步骤 1-15）
- ✅ 项目初始化和配置
- ✅ 类型定义和 Schema
- ✅ Repo Scanner（文件扫描）
- ✅ Code Chunker（代码分块）
- ✅ AI Parser（LLM 集成）
- ✅ Graph Builder（图谱合并）
- ✅ Graph Storage（JSON 存储）
- ✅ Task Queue（BullMQ + Redis）
- ✅ Query API（Express REST API）
- ✅ Frontend（React + Vite + Graphology + Sigma.js）
- ✅ Graph Engine（图形渲染和交互）
- ✅ LOD 机制（Level-of-Detail 渲染）
- ✅ 图谱搜索（Fuse.js 模糊搜索）
- ✅ 系统集成（启动脚本、测试、文档）

## 立即开始

### 1. 安装后端依赖

```bash
cd code-graph-system-v2
npm install
```

### 2. 安装前端依赖

```bash
cd frontend
npm install
cd ..
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，添加您的 API keys（可选，仅在使用 AI 分析时需要）：

```env
# 选择 LLM 提供商（可选）
LLM_PROVIDER=anthropic  # 或 'openai'

# 添加对应的 API key（可选）
ANTHROPIC_API_KEY=your_key_here
# 或
OPENAI_API_KEY=your_key_here

# Redis 配置（可选，用于任务队列）
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 4. 启动后端服务器

```bash
./scripts/start-backend.sh
```

或手动启动：

```bash
npm run dev
```

后端将在 http://localhost:3000 运行

### 5. 启动前端开发服务器

在新的终端窗口中：

```bash
./scripts/start-frontend.sh
```

或手动启动：

```bash
cd frontend
npm run dev
```

前端将在 http://localhost:5173 运行

### 6. 测试完整工作流

在新的终端窗口中运行测试脚本：

```bash
./scripts/test-workflow.sh
```

这将：
1. 创建示例代码仓库
2. 触发分析
3. 等待完成
4. 检索生成的图谱
5. 显示统计信息

## 使用 API

### 分析代码仓库

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath": "/path/to/your/repo",
    "repoName": "my-project",
    "enableAI": false
  }'
```

### 查看分析状态

```bash
curl http://localhost:3000/api/analyze/{jobId}
```

### 获取图谱

```bash
curl http://localhost:3000/api/graph/my-project?graphType=graph
```

### 获取图谱统计

```bash
curl http://localhost:3000/api/graph/my-project/stats
```

更多 API 端点请参考 [API 文档](docs/API.md)

## 使用前端

1. 打开浏览器访问 http://localhost:5173
2. 在界面中输入仓库路径
3. 点击"分析"按钮
4. 等待分析完成
5. 查看生成的图谱可视化
6. 使用搜索功能查找节点
7. 点击节点查看详细信息
8. 使用缩放控制调整视图

## 项目文件结构

```
code-graph-system-v2/
├── src/                  # 后端源代码
│   ├── scanner/          ✅ 文件扫描和语言检测
│   ├── chunker/          ✅ 代码分块
│   ├── parser/           ✅ AI 代码解析
│   ├── builder/          ✅ 图谱构建和合并
│   ├── storage/          ✅ JSON 存储
│   ├── api/              ✅ REST API 服务器
│   ├── queue/            ✅ 任务队列（BullMQ）
│   ├── types/            ✅ TypeScript 类型定义
│   ├── cache/            ✅ 缓存层
│   └── utils/            ✅ 工具函数
├── frontend/             ✅ React 前端
│   ├── src/
│   │   ├── components/   ✅ React 组件
│   │   │   ├── GraphEngine/    # Sigma.js 图形引擎
│   │   │   ├── GraphSearch/    # Fuse.js 搜索
│   │   │   └── ...
│   │   ├── hooks/        ✅ 自定义 Hooks
│   │   ├── services/     ✅ API 客户端
│   │   └── types/        ✅ 类型定义
├── scripts/              ✅ 启动和测试脚本
│   ├── start-backend.sh
│   ├── start-frontend.sh
│   └── test-workflow.sh
├── docs/                 ✅ 文档
│   └── API.md
├── examples/             ✅ 示例（由测试脚本生成）
├── graph-storage/        # 图谱数据存储目录
├── tests/                # 单元测试（待添加）
└── package.json
```

## 帮助和文档

- 📖 [README.md](README.md) - 项目概述
- 📊 [PROJECT_STATUS.md](PROJECT_STATUS.md) - 详细进度
- 📚 [API.md](docs/API.md) - API 文档
- 🔧 [.env.example](.env.example) - 环境变量配置
- 📝 [src/types/graph.ts](src/types/graph.ts) - 核心类型定义
- 🎨 [frontend/src/components/](frontend/src/components/) - 前端组件

## 功能特性

### 后端
- ✅ 多语言代码扫描（TypeScript, JavaScript, Python 等）
- ✅ 智能代码分块
- ✅ AI 驱动的代码分析（可选）
- ✅ 图谱构建和合并
- ✅ JSON 文件存储
- ✅ 异步任务队列（BullMQ + Redis）
- ✅ RESTful API
- ✅ 子图查询
- ✅ 图谱统计

### 前端
- ✅ Sigma.js WebGL 图形渲染
- ✅ 交互式图谱可视化
- ✅ LOD（Level-of-Detail）渲染优化
- ✅ Fuse.js 模糊搜索
- ✅ 节点高亮和选择
- ✅ 缩放和平移控制
- ✅ 响应式设计

## 常见问题

**Q: 是否必须配置 AI API key？**
A: 不是必须的。如果不配置 API key，系统会使用静态分析模式，仍然可以生成基础的文件和模块图谱。

**Q: Redis 是必需的吗？**
A: 不是必需的。Redis 仅用于任务队列功能。如果不使用任务队列，可以直接调用分析 API。

**Q: 支持哪些编程语言？**
A: 当前支持 TypeScript、JavaScript、Python、Java、Go、Rust 等主流语言。语言检测基于文件扩展名。

**Q: 如何处理大型代码仓库？**
A: 系统支持：
- 流式文件处理
- 异步任务队列
- LOD 渲染优化
- 子图查询

**Q: 图谱数据存储在哪里？**
A: 默认存储在 `graph-storage/` 目录下的 JSON 文件中。每个仓库有独立的目录。

**Q: 如何删除图谱？**
A: 使用 DELETE API：`curl -X DELETE http://localhost:3000/api/graph/{repoId}`

## 技术支持

如遇问题，请检查：
1. Node.js 版本 >= 18
2. 所有依赖已正确安装（后端和前端）
3. 环境变量已正确配置（如果使用 AI 功能）
4. 后端服务器正在运行（http://localhost:3000）
5. 前端开发服务器正在运行（http://localhost:5173）
6. 检查浏览器控制台和终端日志

## 下一步

### 生产部署
- 配置生产环境变量
- 构建前端：`cd frontend && npm run build`
- 使用 PM2 或 Docker 部署后端
- 配置 Nginx 反向代理
- 启用 HTTPS

### 扩展功能
- 添加用户认证和授权
- 集成 Neo4j 图数据库
- 添加更多图谱类型（业务流程图、数据血缘图）
- 实现增量分析
- 添加图谱对比功能
- 集成 CI/CD 流水线

### 性能优化
- 实现图谱缓存
- 优化大型图谱渲染
- 添加分页和懒加载
- 使用 Web Workers 处理大数据
- 实现服务端渲染（SSR）

---

**提示**：这是一个完整的 MVP 系统，可以直接用于代码分析和可视化。根据您的需求，可以进一步扩展和优化。
