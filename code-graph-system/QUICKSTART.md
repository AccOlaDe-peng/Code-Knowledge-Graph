# 🎉 安装成功！快速使用指南

## ✅ 当前状态

你的系统已经成功安装并测试通过！

- ✅ Python 3.9.6
- ✅ 所有核心依赖已安装
- ✅ 代码解析功能正常
- ✅ 图谱构建功能正常
- ✅ 已成功分析示例代码

## 🚀 快速开始

### 1. 激活虚拟环境（每次使用前）

```bash
cd /Users/wayne/Documents/code/code-knowledge-graph/code-graph-system
source venv/bin/activate
```

### 2. 分析代码仓库

```bash
# 分析当前项目
python scripts/run_analysis.py . -v

# 分析指定目录
python scripts/run_analysis.py /path/to/your/repo

# 分析并查看详细日志
python scripts/run_analysis.py /path/to/repo --verbose
```

### 3. 查看生成的图谱

```bash
# 查看所有图谱
ls -lh data/graphs/

# 查看图谱索引
cat data/graphs/index.json | python -m json.tool

# 查看具体图谱（替换为实际的图谱ID）
cat data/graphs/8f28db17-d840-4d78-b27a-fcbc262930c1.json | python -m json.tool | head -100
```

### 4. 启动 API 服务器

```bash
cd backend/api
python server.py
```

然后访问：http://localhost:8000/docs

### 5. 运行测试

```bash
pytest backend/tests/test_basic.py -v
```

## 📊 刚才的测试结果

我们成功分析了 `backend/parser` 目录：

- **文件数**: 3 个 Python 文件
- **代码行数**: 781 行
- **识别节点**: 30 个（4个模块 + 3个类 + 22个函数 + 1个仓库节点）
- **关系边**: 53 条
- **分析耗时**: 0.06 秒
- **图谱ID**: `8f28db17-d840-4d78-b27a-fcbc262930c1`

## 🎯 下一步建议

### 分析更多代码

```bash
# 分析整个项目
python scripts/run_analysis.py . -v

# 分析其他项目
python scripts/run_analysis.py ~/your-project
```

### 安装可选功能

如果需要 AI 语义分析和向量检索：

```bash
# 安装 AI 依赖
pip install anthropic openai chromadb tiktoken

# 配置 API Key
cp .env.example .env
# 编辑 .env 文件，填入你的 API Key

# 启用 AI 分析
python scripts/run_analysis.py /path/to/repo --enable-ai
```

### 安装更多语言支持

```bash
# JavaScript/TypeScript
pip install tree-sitter-javascript tree-sitter-typescript

# Java
pip install tree-sitter-java

# Go
pip install tree-sitter-go

# Rust
pip install tree-sitter-rust
```

## 📝 常用命令

```bash
# 检查依赖状态
python scripts/check_deps.py

# 分析代码（基础）
python scripts/run_analysis.py /path/to/repo

# 分析代码（启用AI）
python scripts/run_analysis.py /path/to/repo --enable-ai

# 分析特定语言
python scripts/run_analysis.py /path/to/repo --languages python javascript

# 启动 API 服务
cd backend/api && python server.py

# 运行测试
pytest backend/tests/ -v

# 查看帮助
python scripts/run_analysis.py --help
```

## 🔧 故障排查

如果遇到问题：

1. **确保虚拟环境已激活**
   ```bash
   source venv/bin/activate
   ```

2. **检查依赖状态**
   ```bash
   python scripts/check_deps.py
   ```

3. **查看详细日志**
   ```bash
   python scripts/run_analysis.py /path/to/repo --verbose
   ```

4. **查看完整文档**
   - [README.md](README.md) - 完整使用文档
   - [INSTALL.md](INSTALL.md) - 安装指南
   - [IMPLEMENTATION.md](IMPLEMENTATION.md) - 实现细节

## 🎓 学习资源

- API 文档: http://localhost:8000/docs （启动服务器后访问）
- 示例图谱: `data/graphs/` 目录
- 测试用例: `backend/tests/test_basic.py`
- 代码示例: 各模块的 `__main__` 部分

## 💡 提示

- 第一次分析大型项目可能需要几分钟
- 不启用 AI 的分析速度很快（秒级）
- 生成的图谱保存在 `data/graphs/` 目录
- 可以使用 Neo4j 进行可视化（需要额外安装）

祝使用愉快！🚀
