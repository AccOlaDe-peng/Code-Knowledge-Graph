"""
Tree-sitter 语言加载器模块。

负责加载和管理各编程语言的 Tree-sitter 语法解析器，
支持 Python、JavaScript、TypeScript、Java、Go、Rust 等主流语言。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class LanguageConfig:
    """单个编程语言的配置信息。"""

    name: str
    """语言名称（如 python、javascript）"""

    extensions: list[str]
    """对应的文件扩展名列表（如 ['.py']）"""

    package_name: str
    """tree-sitter 语言包名称"""

    comment_prefix: str = "#"
    """单行注释前缀"""

    string_delimiters: list[str] = field(default_factory=lambda: ['"', "'"])
    """字符串定界符"""


# 支持的语言配置表
SUPPORTED_LANGUAGES: dict[str, LanguageConfig] = {
    "python": LanguageConfig(
        name="python",
        extensions=[".py", ".pyi", ".pyw"],
        package_name="tree_sitter_python",
        comment_prefix="#",
    ),
    "javascript": LanguageConfig(
        name="javascript",
        extensions=[".js", ".mjs", ".cjs"],
        package_name="tree_sitter_javascript",
        comment_prefix="//",
        string_delimiters=['"', "'", "`"],
    ),
    "typescript": LanguageConfig(
        name="typescript",
        extensions=[".ts", ".tsx"],
        package_name="tree_sitter_typescript",
        comment_prefix="//",
        string_delimiters=['"', "'", "`"],
    ),
    "java": LanguageConfig(
        name="java",
        extensions=[".java"],
        package_name="tree_sitter_java",
        comment_prefix="//",
        string_delimiters=['"'],
    ),
    "go": LanguageConfig(
        name="go",
        extensions=[".go"],
        package_name="tree_sitter_go",
        comment_prefix="//",
        string_delimiters=['"', "`"],
    ),
    "rust": LanguageConfig(
        name="rust",
        extensions=[".rs"],
        package_name="tree_sitter_rust",
        comment_prefix="//",
        string_delimiters=['"'],
    ),
}

# 文件扩展名 -> 语言名称 的快速映射
_EXT_TO_LANG: dict[str, str] = {
    ext: lang
    for lang, cfg in SUPPORTED_LANGUAGES.items()
    for ext in cfg.extensions
}


class LanguageLoader:
    """
    Tree-sitter 语言加载器。

    采用懒加载策略，仅在首次需要时加载对应语言的解析器，
    并缓存已加载的解析器实例。

    示例::

        loader = LanguageLoader()
        parser = loader.get_parser("python")
        tree = parser.parse(source_code.encode())
    """

    def __init__(self) -> None:
        self._parsers: dict[str, object] = {}
        self._languages: dict[str, object] = {}

    def get_language_for_file(self, file_path: str | Path) -> Optional[str]:
        """
        根据文件路径推断编程语言。

        Args:
            file_path: 文件路径

        Returns:
            语言名称字符串，无法识别时返回 None
        """
        ext = Path(file_path).suffix.lower()
        return _EXT_TO_LANG.get(ext)

    def get_parser(self, language: str) -> Optional[object]:
        """
        获取指定语言的 Tree-sitter Parser 实例。

        Args:
            language: 语言名称（如 "python"）

        Returns:
            tree_sitter.Parser 实例，加载失败时返回 None
        """
        if language in self._parsers:
            return self._parsers[language]

        parser = self._load_parser(language)
        if parser:
            self._parsers[language] = parser
        return parser

    def get_language(self, language: str) -> Optional[object]:
        """
        获取指定语言的 tree_sitter.Language 对象。

        Args:
            language: 语言名称

        Returns:
            Language 对象，加载失败返回 None
        """
        if language in self._languages:
            return self._languages[language]

        lang_obj = self._load_language(language)
        if lang_obj:
            self._languages[language] = lang_obj
        return lang_obj

    def _load_language(self, language: str) -> Optional[object]:
        """内部：加载语言对象。"""
        config = SUPPORTED_LANGUAGES.get(language)
        if not config:
            logger.warning(f"不支持的语言: {language}")
            return None

        try:
            import importlib
            from tree_sitter import Language

            module = importlib.import_module(config.package_name)

            # tree-sitter-typescript 分为 language_typescript / language_tsx
            if language == "typescript":
                if hasattr(module, "language_typescript"):
                    return Language(module.language_typescript())
                if hasattr(module, "language_tsx"):
                    return Language(module.language_tsx())

            # 通用：tree-sitter v0.22+ 使用 language()
            if hasattr(module, "language"):
                return Language(module.language())

            logger.warning(f"语言模块 {config.package_name} 不符合预期接口")
            return None
        except ImportError:
            logger.warning(f"语言包未安装: {config.package_name}，跳过 {language}")
            return None
        except Exception as e:
            logger.error(f"加载语言 {language} 失败: {e}")
            return None

    def _load_parser(self, language: str) -> Optional[object]:
        """内部：创建并配置 Parser 实例。"""
        try:
            from tree_sitter import Parser

            lang_obj = self._load_language(language)
            if lang_obj is None:
                return None

            parser = Parser(lang_obj)
            logger.debug(f"成功加载 Tree-sitter 解析器: {language}")
            return parser
        except Exception as e:
            logger.error(f"创建 {language} 解析器失败: {e}")
            return None

    def supported_languages(self) -> list[str]:
        """返回所有支持的语言名称列表。"""
        return list(SUPPORTED_LANGUAGES.keys())

    def get_config(self, language: str) -> Optional[LanguageConfig]:
        """获取指定语言的配置信息。"""
        return SUPPORTED_LANGUAGES.get(language)

    def detect_language(self, file_path: str | Path) -> Optional[LanguageConfig]:
        """
        检测文件语言并返回完整配置。

        Args:
            file_path: 文件路径

        Returns:
            LanguageConfig 对象，无法识别返回 None
        """
        lang = self.get_language_for_file(file_path)
        return SUPPORTED_LANGUAGES.get(lang) if lang else None


# 模块级单例，供其他模块直接使用
default_loader = LanguageLoader()


if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    loader = LanguageLoader()
    print("支持的语言:", loader.supported_languages())
    print("检测 main.py:", loader.get_language_for_file("main.py"))
    print("检测 app.ts:", loader.get_language_for_file("app.ts"))
    p = loader.get_parser("python")
    print("Python 解析器:", p)
