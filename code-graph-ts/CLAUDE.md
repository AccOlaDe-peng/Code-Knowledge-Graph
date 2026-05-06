# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 运行时

- 使用 `bun <file>` 而非 `node <file>` 或 `ts-node <file>`
- 使用 `bun test` 运行测试
- 使用 `bun install` 安装依赖
- Bun 自动加载 `.env`，无需 dotenv

## 服务器框架

本项目使用 **Fastify**（非 `Bun.serve()`）：

- `src/api/server.ts` — Fastify 服务器，注册 CORS、WebSocket 插件及所有路由
- 路由有两条注册路径：`/api/*` 前缀（新 API）和 `/` 前缀（前端兼容路由）
- 生产环境日志写入 `logs/server.log`，开发环境使用 pino-pretty 美化输出

## tsconfig 限制

`erasableSyntaxOnly: true`，**禁止使用 `enum`**，所有类型常量使用 `const` 对象 + `as const` 模式（见 `src/graph/schema.ts`）。

## 关键依赖

- `fastify` + `@fastify/cors` + `@fastify/websocket` — HTTP + WebSocket
- `graphology` — 内存图谱存储
- `web-tree-sitter` — AST 解析
- `@anthropic-ai/sdk` — LLM 调用
