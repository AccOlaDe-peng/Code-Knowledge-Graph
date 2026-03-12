#!/usr/bin/env python3
"""
MiniMax AI 配置验证脚本

用法：
    python verify_minimax.py
"""

import os
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from backend.ai.llm_client import LLMClient


def main():
    print("=" * 60)
    print("MiniMax AI 配置验证")
    print("=" * 60)

    # 加载环境变量
    load_dotenv()

    # 检查环境变量
    print("\n1. 检查环境变量...")
    provider = os.getenv("LLM_PROVIDER")
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL")
    model = os.getenv("LLM_MODEL")

    print(f"   LLM_PROVIDER: {provider}")
    print(f"   OPENAI_API_KEY: {'✅ 已设置' if api_key else '❌ 未设置'}")
    print(f"   OPENAI_BASE_URL: {base_url or '(使用默认)'}")
    print(f"   LLM_MODEL: {model or '(使用默认)'}")

    if not api_key:
        print("\n❌ 错误：OPENAI_API_KEY 未设置")
        print("   请在 .env 文件中设置你的 MiniMax API Key")
        return False

    if provider != "openai":
        print(f"\n⚠️  警告：LLM_PROVIDER 设置为 '{provider}'，应该设置为 'openai'")
        print("   MiniMax 使用 OpenAI 兼容接口")

    # 创建客户端
    print("\n2. 创建 LLM 客户端...")
    try:
        client = LLMClient(
            provider=provider or "openai",
            model=model,
            api_key=api_key,
            base_url=base_url
        )
        print(f"   提供商: {client.provider}")
        print(f"   模型: {client.model}")
        print(f"   API Key: {client.api_key[:10] if client.api_key else 'None'}...")
        print(f"   Base URL: {client.base_url or '(默认)'}")
        print(f"   可用性: {'✅ 是' if client.is_available() else '❌ 否'}")
    except Exception as e:
        print(f"   ❌ 创建客户端失败: {e}")
        return False

    # 测试 API 调用
    print("\n3. 测试 API 调用...")
    try:
        response = client.complete(
            prompt="你好，请用一句话介绍你自己。",
            max_tokens=100
        )
        print(f"   响应: {response[:100]}...")
        print("   ✅ API 调用成功")
    except Exception as e:
        print(f"   ❌ API 调用失败: {e}")
        print("\n   可能的原因：")
        print("   - API Key 无效或已过期")
        print("   - 账户余额不足")
        print("   - 网络连接问题")
        print("   - Base URL 配置错误")
        return False

    # Token 计数测试
    print("\n4. 测试 Token 计数...")
    test_text = "这是一段测试文本，用于验证 Token 计数功能。"
    token_count = client.count_tokens(test_text)
    print(f"   文本: {test_text}")
    print(f"   Token 数: {token_count}")

    # 总结
    print("\n" + "=" * 60)
    print("✅ MiniMax AI 配置验证成功！")
    print("=" * 60)
    print("\n现在可以使用 SemanticAnalyzer 进行代码分析了。")
    print("\n使用方法：")
    print("  1. 前端界面：开启 'AI 语义分析' 开关")
    print("  2. 命令行：python -m backend.pipeline.analyze_repository /path/to/repo --enable-ai")
    print("  3. API：POST /analyze/repository 设置 enable_ai=true")

    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
