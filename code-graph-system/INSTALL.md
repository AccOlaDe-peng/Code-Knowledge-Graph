# 快速安装指南

## 问题诊断

如果你遇到了依赖安装错误，请按照以下步骤操作：

### 1. 检查 Python 版本

```bash
python3 --version
```

**要求：Python 3.9 或更高版本**

如果版本过低，请升级 Python。

### 2. 检查当前依赖状态

```bash
python3 scripts/check_deps.py
```

这会显示哪些依赖已安装，哪些缺失。

### 3. 安装核心依赖（推荐）

```bash
# 最小安装，仅核心功能
pip install -r requirements-minimal.txt
```

或者手动安装核心依赖：

```bash
pip install fastapi uvicorn pydantic networkx gitpython python-dotenv rich pytest
```

### 4. 安装 Tree-sitter（代码解析必需）

Tree-sitter 可能需要编译，如果遇到错误：

#### macOS
```bash
brew install tree-sitter
pip install tree-sitter tree-sitter-python
```

#### Ubuntu/Debian
```bash
sudo apt-get install tree-sitter
pip install tree-sitter tree-sitter-python
```

#### Windows
```bash
# 直接安装（可能需要 Visual Studio Build Tools）
pip install tree-sitter tree-sitter-python
```

### 5. 验证安装

```bash
python3 scripts/check_deps.py
```

应该看到核心依赖都显示 ✓

### 6. 测试运行

```bash
# 运行测试
pytest backend/tests/test_basic.py -v

# 分析示例代码（使用当前项目）
python3 scripts/run_analysis.py . -v
```

## 常见问题

### Q1: networkx 版本不存在

**原因**: requirements.txt 中的版本号过高

**解决**: 使用 `requirements-minimal.txt` 或手动安装：
```bash
pip install "networkx>=3.1,<4.0"
```

### Q2: Tree-sitter 编译失败

**原因**: 缺少 C 编译器或系统依赖

**解决**:
- macOS: `xcode-select --install`
- Ubuntu: `sudo apt-get install build-essential`
- Windows: 安装 Visual Studio Build Tools

### Q3: ChromaDB 安装失败

**原因**: ChromaDB 需要 Python 3.10+

**解决**:
- 升级 Python 到 3.10+，或
- 跳过 ChromaDB（不影响核心功能）

### Q4: 某些包需要 Python 3.10+

**解决**: 使用 `requirements-minimal.txt`，它兼容 Python 3.9+

## 分步安装（最稳妥）

如果上述方法都失败，尝试逐个安装：

```bash
# 1. Web 框架
pip install fastapi uvicorn

# 2. 数据验证
pip install pydantic

# 3. 图计算
pip install networkx

# 4. Git 支持
pip install gitpython

# 5. 工具库
pip install python-dotenv rich

# 6. 测试框架
pip install pytest

# 7. Tree-sitter（可能需要编译）
pip install tree-sitter
pip install tree-sitter-python

# 8. 验证
python3 scripts/check_deps.py
```

## 最小可运行配置

如果只想快速测试核心功能，只需安装：

```bash
pip install fastapi pydantic networkx gitpython rich
pip install tree-sitter tree-sitter-python
```

这样就可以运行基础的代码分析功能（不包含 AI 和向量检索）。

## 完整功能安装

如果需要所有功能（AI、向量检索、图数据库）：

```bash
# 先安装核心依赖
pip install -r requirements-minimal.txt

# 再安装可选依赖
pip install anthropic openai chromadb neo4j tiktoken
pip install tree-sitter-javascript tree-sitter-typescript tree-sitter-java
```

## 获取帮助

如果仍然遇到问题：

1. 查看具体错误信息
2. 检查 Python 版本是否符合要求
3. 尝试在虚拟环境中安装
4. 查看项目 GitHub Issues

## 虚拟环境（推荐）

使用虚拟环境可以避免依赖冲突：

```bash
# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate  # macOS/Linux
# 或
venv\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements-minimal.txt

# 验证
python scripts/check_deps.py
```
