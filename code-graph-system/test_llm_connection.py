#!/usr/bin/env python3
"""
LLM 连接测试脚本

测试 MiniMax/Anthropic/OpenAI 等 LLM 服务的连接状态。
"""

import os
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv()

from backend.ai.llm_client import LLMClient

def print_section(title: str):
    """打印分隔线"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)

def test_llm_connection():
    """测试 LLM 连接"""

    print_section("环境变量检查")

    provider = os.getenv("LLM_PROVIDER", "anthropic")
    model = os.getenv("LLM_MODEL")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_base = os.getenv("ANTHROPIC_BASE_URL")
    openai_base = os.getenv("OPENAI_BASE_URL")

    print(f"LLM_PROVIDER:        {provider}")
    print(f"LLM_MODEL:           {model or '(使用默认)'}")
    print(f"ANTHROPIC_API_KEY:   {'✓ 已配置' if anthropic_key else '✗ 未配置'}")
    print(f"OPENAI_API_KEY:      {'✓ 已配置' if openai_key else '✗ 未配置'}")
    print(f"ANTHROPIC_BASE_URL:  {anthropic_base or '(默认)'}")
    print(f"OPENAI_BASE_URL:     {openai_base or '(默认)'}")

    print_section("配置诊断")

    # 诊断配置问题
    issues = []

    if provider == "openai" and openai_base and "minimax" in openai_base.lower():
        issues.append("⚠️  检测到 MiniMax 配置，但 LLM_PROVIDER=openai")
        issues.append("   MiniMax 使用 Anthropic 兼容接口，应该设置:")
        issues.append("   LLM_PROVIDER=anthropic")
        issues.append("   ANTHROPIC_API_KEY=<你的 MiniMax API Key>")
        issues.append("   ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic")

    if provider == "anthropic" and not anthropic_key:
        issues.append("✗ ANTHROPIC_API_KEY 未配置")

    if provider == "openai" and not openai_key:
        issues.append("✗ OPENAI_API_KEY 未配置")

    if issues:
        print("发现配置问题:")
        for issue in issues:
            print(issue)
    else:
        print("✓ 配置检查通过")

    print_section("初始化 LLM 客户端")

    try:
        client = LLMClient(
            provider=provider,
            model=model,
            base_url=anthropic_base or openai_base
        )
        print(f"✓ 客户端初始化成功")
        print(f"  提供商: {client.provider}")
        print(f"  模型:   {client.model}")
        print(f"  API Key: {'✓ 已加载' if client.api_key else '✗ 未加载'}")
        print(f"  Base URL: {client.base_url or '(默认)'}")
    except Exception as e:
        print(f"✗ 客户端初始化失败: {e}")
        return False

    print_section("检查服务可用性")

    if not client.is_available():
        print("✗ LLM 服务不可用")
        print("  可能原因:")
        print("  1. API Key 未配置或无效")
        print("  2. 网络连接问题")
        print("  3. Base URL 配置错误")
        return False

    print("✓ LLM 服务可用")

    print_section("测试 API 调用")

    try:
        print("发送测试请求: '1+1=?'")
        response = client.complete(
            prompt="请回答: 1+1=? 只需要回答数字即可。",
            max_tokens=50
        )
        print(f"✓ API 调用成功")
        print(f"  响应: {response.strip()}")
        return True
    except Exception as e:
        print(f"✗ API 调用失败: {e}")
        print(f"\n详细错误信息:")
        import traceback
        traceback.print_exc()
        return False

def print_fix_guide():
    """打印修复指南"""
    print_section("MiniMax 正确配置示例")
    print("""
# .env 文件配置（MiniMax 使用 Anthropic 兼容接口）

# 方式 1：使用 Anthropic 兼容接口（推荐）
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-cp---你的MiniMax_API_Key
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
LLM_MODEL=MiniMax-M2.5

# 方式 2：使用 OpenAI 兼容接口（如果 MiniMax 支持）
# LLM_PROVIDER=openai
# OPENAI_API_KEY=sk-cp---你的MiniMax_API_Key
# OPENAI_BASE_URL=https://api.minimaxi.com/v1
# LLM_MODEL=MiniMax-M2.5
""")

if __name__ == "__main__":
    print("LLM 连接测试工具")
    print("=" * 60)

    success = test_llm_connection()

    if not success:
        print_fix_guide()
        sys.exit(1)

    print_section("测试完成")
    print("✓ 所有测试通过，LLM 服务正常工作")
    sys.exit(0)
