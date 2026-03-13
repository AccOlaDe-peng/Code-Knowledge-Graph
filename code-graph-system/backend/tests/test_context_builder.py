"""Tests for ContextBuilder."""

import pytest
from backend.analyzer.ai.agent.context_builder import ContextBuilder
from backend.pipeline.repo_summary_builder import (
    RepoSummary,
    ModuleSummary,
    FunctionSummary,
    APISummary,
    EventSummary,
    ServiceSummary,
    DatabaseSummary,
    CallSample,
)


def test_context_builder_basic():
    """Test building initial context from summary."""
    summary = RepoSummary(
        repo_name="test-repo",
        repo_path="/path/to/repo",
        git_commit="abc123def456",
        languages=["python", "typescript"],
        total_files=50,
        total_nodes=200,
        total_edges=150,
        repo_tree=[],
        modules=[
            ModuleSummary(
                name="auth",
                path="src/auth",
                language="python",
                node_count=20,
                file_count=5,
            )
        ],
        services=[],
        apis=[],
        functions=[
            FunctionSummary(
                id="fn1",
                name="login",
                module="auth",
                signature="username, password",
                pagerank=0.05,
                in_degree=10,
                out_degree=3,
                language="python",
            )
        ],
        call_graph_sample=[],
        databases=[],
        events=[],
        token_estimate=2000,
        truncated=False,
        limits_used={},
    )

    builder = ContextBuilder()
    context = builder.build(summary, max_tool_calls=20)

    # Check basic structure
    assert "Repository: test-repo" in context
    assert "Languages: python, typescript" in context
    assert "Git commit: abc123def456" in context
    assert "20 tool calls remaining" in context
    assert "out of 20" in context

    # Check statistics
    assert "200 nodes" in context
    assert "150 edges" in context

    # Check instructions
    assert "CRITICAL RULES" in context
    assert "AVAILABLE TOOLS" in context


def test_context_builder_with_complex_summary():
    """Test context builder with more complex summary data."""
    summary = RepoSummary(
        repo_name="complex-app",
        repo_path="/app",
        git_commit="xyz789",
        languages=["python", "javascript", "go"],
        total_files=100,
        total_nodes=500,
        total_edges=400,
        repo_tree=[],
        modules=[],
        services=[
            ServiceSummary(
                id="svc1",
                name="api-gateway",
                description="Main API gateway",
                port="8080",
            )
        ],
        apis=[
            APISummary(
                id="api1",
                name="login_endpoint",
                module="auth",
                method="POST",
                path="/api/login",
                description="User login",
            )
        ],
        functions=[],
        call_graph_sample=[
            CallSample(
                caller="main",
                callee="init_db",
                caller_module="app",
                callee_module="database",
            )
        ],
        databases=[
            DatabaseSummary(
                id="db1",
                name="postgres",
                db_type="postgresql",
                tables=["users", "sessions"],
            )
        ],
        events=[
            EventSummary(
                id="ev1",
                name="user.login",
                event_type="kafka",
                publishers=["auth-service"],
                subscribers=["audit-service"],
            )
        ],
        token_estimate=3000,
        truncated=False,
        limits_used={},
    )

    builder = ContextBuilder()
    context = builder.build(summary, max_tool_calls=15)

    assert "complex-app" in context
    assert "15 tool calls remaining" in context
    assert "out of 15" in context
    assert "500 nodes" in context

    # Should include summary sections
    assert "## Services" in context or "api-gateway" in context
    assert "## API Endpoints" in context or "/api/login" in context


def test_context_builder_zero_budget():
    """Test context builder with zero tool call budget."""
    summary = RepoSummary(
        repo_name="test",
        repo_path="/test",
        git_commit="",
        languages=["python"],
        total_files=10,
        total_nodes=50,
        total_edges=30,
        repo_tree=[],
        modules=[],
        services=[],
        apis=[],
        functions=[],
        call_graph_sample=[],
        databases=[],
        events=[],
        token_estimate=500,
        truncated=False,
        limits_used={},
    )

    builder = ContextBuilder()
    context = builder.build(summary, max_tool_calls=0)

    assert "BUDGET EXHAUSTED" in context
    assert "No tool calls remaining" in context
