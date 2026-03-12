# MiniMax AI 配置指南

本文档说明如何配置系统使用 MiniMax AI 作为 LLM 提供商。

## 前置要求

1. **MiniMax 账号和 API Key**
   - 注册地址：https://platform.minimaxi.com
   - API Key 获取：https://platform.minimaxi.com/user-center/basic-information/interface-key

2. **安装依赖**
   ```bash
   cd code-graph-system
   pip install openai python-dotenv
   ```

## 配置步骤

### 1. 编辑环境变量文件

编辑 `code-graph-system/.env` 文件，配置以下内容：

```bash
# LLM 提供商（使用 openai，因为 MiniMax 兼容 OpenAI API）
LLM_PROVIDER=openai

# MiniMax API Key（替换为你的实际 Key）
OPENAI_API_KEY=your_minimax_api_key_here

# MiniMax API 基础 URL
OPENAI_BASE_URL=https://api.minimax.chat/v1

# MiniMax 模型名称
LLM_MODEL=abab6.5s-chat
```

### 2. MiniMax 可用模型

根据你的订阅计划，可以选择以下模型：

| 模型名称 | 说明 | 适用场景 |
|---------|------|---------|
| `abab6.5s-chat` | 标准版，速度快 | 日常代码分析 |
| `abab6.5-chat` | 标准版 | 通用场景 |
| `abab6.5g-chat` | 高级版，效果更好 | 复杂代码理解 |
| `abab5.5s-chat` | 经济版 | 成本敏感场景 |

### 3. 验证配置

运行以下命令验证配置是否正确：

```bash
cd code-graph-system
python3 << 'PYTHON'
import os
from dotenv import load_dotenv
from backend.ai.llm_client import LLMClient

# 加载环境变量
load_dotenv()

# 创建客户端
client = LLMClient()

print(f"提供商: {client.provider}")
print(f"模型: {client.model}")
print(f"API Key: {client.api_key[:10] if client.api_key else 'None'}...")
print(f"Base URL: {client.base_url}")
print(f"可用性: {client.is_available()}")

# 测试调用
try:
    response = client.complete("你好，请用一句话介绍你自己。")
    print(f"\n测试响应: {response[:100]}...")
    print("\n✅ MiniMax AI 配置成功！")
except Exception as e:
    print(f"\n❌ 配置失败: {e}")
PYTHON
```

### 4. 使用 SemanticAnalyzer

配置完成后，在分析代码时启用 AI 分析：

**前端界面：**
1. 打开 Repository 页面
2. 点击"添加仓库"
3. 开启"AI 语义分析"开关
4. 开始分析

**命令行：**
```bash
cd code-graph-system
python -m backend.pipeline.analyze_repository /path/to/repo --enable-ai
```

**API 调用：**
```bash
curl -X POST http://localhost:8000/analyze/repository \
  -H "Content-Type: application/json" \
  -d '{
    "repo_path": "/path/to/repo",
    "enable_ai": true
  }'
```

## 成本优化建议

1. **选择合适的模型**
   - 小型项目：使用 `abab5.5s-chat` 或 `abab6.5s-chat`
   - 大型项目：使用 `abab6.5-chat` 或 `abab6.5g-chat`

2. **限制分析范围**
   - 使用 `languages` 参数只分析特定语言
   - 避免分析 `node_modules`、`vendor` 等依赖目录

3. **批量处理**
   - SemanticAnalyzer 每批处理 12 个类
   - 大型项目会产生多次 API 调用

## 故障排查

### 问题 1：API Key 无效
```
错误：401 Unauthorized
```
**解决方案：**
- 检查 API Key 是否正确
- 确认 API Key 是否已激活
- 检查账户余额是否充足

### 问题 2：模型不存在
```
错误：404 Model not found
```
**解决方案：**
- 检查 `LLM_MODEL` 配置是否正确
- 确认你的订阅计划支持该模型
- 参考 MiniMax 文档确认可用模型列表

### 问题 3：请求超时
```
错误：Request timeout
```
**解决方案：**
- 检查网络连接
- 尝试使用代理
- 减小批处理大小（修改 `_BATCH_SIZE`）

### 问题 4：降级到规则模式
如果 LLM 调用失败，SemanticAnalyzer 会自动降级到基于规则的分类：
- 后缀规则识别 Service（*Service、*Engine 等）
- 装饰器识别 API（@router、@app.route 等）
- 其余归类为 Component
- 不创建 Domain 节点

## 高级配置

### 自定义温度和 Token 限制

在代码中可以自定义参数：

```python
from backend.ai.llm_client import LLMClient

client = LLMClient(
    provider="openai",
    model="abab6.5s-chat",
    api_key="your_key",
    base_url="https://api.minimax.chat/v1",
    max_tokens=4096,      # 最大生成 Token 数
    temperature=0.1,      # 采样温度（0.0-1.0）
)
```

### 使用代理

如果需要通过代理访问 MiniMax API：

```bash
# 在 .env 中添加
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=http://proxy.example.com:8080
```

## 参考资源

- MiniMax 官方文档：https://platform.minimaxi.com/document
- API 参考：https://platform.minimaxi.com/document/api-reference
- 定价信息：https://platform.minimaxi.com/document/price

---

配置完成后，系统将使用 MiniMax AI 进行代码语义分析！
