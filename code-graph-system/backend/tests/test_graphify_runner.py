import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from backend.services.graphify_runner import GraphifyRunner, GraphifyResult


class TestGraphifyRunner:
    def test_init_with_defaults(self):
        runner = GraphifyRunner()
        assert runner.claude_bin == "claude"
        assert runner.timeout == 1800

    def test_init_with_custom_values(self):
        runner = GraphifyRunner(claude_bin="/usr/local/bin/claude", timeout=600)
        assert runner.claude_bin == "/usr/local/bin/claude"
        assert runner.timeout == 600

    def test_build_command(self):
        runner = GraphifyRunner()
        cmd = runner._build_command("/path/to/repo", repo_name="my-project")
        assert cmd[0] == "claude"
        assert "-p" in cmd
        assert "/graphify /path/to/repo --name my-project" in " ".join(cmd)

    def test_build_command_without_name(self):
        runner = GraphifyRunner()
        cmd = runner._build_command("/path/to/repo", repo_name="")
        assert "--name" not in " ".join(cmd)

    @patch("backend.services.graphify_runner.subprocess.run")
    def test_run_success(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout='{"status": "completed", "files_written": 4}',
            stderr="",
        )
        runner = GraphifyRunner()
        result = runner.run("/path/to/repo", repo_name="my-project")
        assert isinstance(result, GraphifyResult)
        assert result.success is True
        assert result.files_written == 4

    @patch("backend.services.graphify_runner.subprocess.run")
    def test_run_cli_not_found(self, mock_run):
        mock_run.side_effect = FileNotFoundError("claude not found")
        runner = GraphifyRunner()
        result = runner.run("/path/to/repo", repo_name="my-project")
        assert result.success is False
        assert "not found" in result.error

    @patch("backend.services.graphify_runner.subprocess.run")
    def test_run_timeout(self, mock_run):
        import subprocess
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="claude", timeout=1800)
        runner = GraphifyRunner(timeout=1800)
        result = runner.run("/path/to/repo", repo_name="my-project")
        assert result.success is False
        assert "timeout" in result.error.lower()

    @patch("backend.services.graphify_runner.subprocess.run")
    def test_run_failure(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="Error: skill not found",
        )
        runner = GraphifyRunner()
        result = runner.run("/path/to/repo", repo_name="my-project")
        assert result.success is False
        assert "skill not found" in result.error

    def test_validate_output_all_files_exist(self, tmp_path):
        runner = GraphifyRunner()
        name = "test-project"
        for suffix in ["", "-architecture", "-function-call-graph", "-lineage"]:
            (tmp_path / f"{name}{suffix}.json").write_text('{"test": true}')
        result = runner.validate_output(str(tmp_path), name)
        assert result.all_exist is True
        assert result.missing == []

    def test_validate_output_missing_files(self, tmp_path):
        runner = GraphifyRunner()
        name = "test-project"
        (tmp_path / f"{name}.json").write_text('{"test": true}')
        result = runner.validate_output(str(tmp_path), name)
        assert result.all_exist is False
        assert len(result.missing) == 3
