# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (Vite)
npm run build    # Type-check (vue-tsc) then build for production
npm run preview  # Preview production build
```

No test runner or linter is configured.

## Environment

Create a `.env` file to override the default API URL:

```
VITE_API_BASE_URL=http://localhost:3000/api
```

## Architecture

This is a Vue 3 + TypeScript + Vite SPA for visualizing code knowledge graphs (dependency analysis of codebases).

**Stack:** Vue 3 (Composition API / `<script setup>`), Pinia, Vue Router, Element Plus, AntV G6, Axios.

### Layer structure

- `src/api/` — Axios-based API clients. `index.ts` creates the shared axios instance with JWT Bearer token injection and 401 redirect. Sub-modules: `auth.ts`, `projects.ts`, `graph.ts`.
- `src/stores/` — Pinia stores using the Composition API style (`defineStore` with setup function). `user.ts` manages auth state; `project.ts` manages project list and current project.
- `src/router/index.ts` — Auth guard reads `token` from `localStorage`. Routes under `/` require auth and use `MainLayout.vue`. `/login` and `/register` are public.
- `src/views/` — Page components: `Login`, `Register`, `ProjectList`, `ProjectDetail`, `GraphView`.
- `src/layouts/MainLayout.vue` — Shell for authenticated pages with `Header` and `Sidebar`.

### Graph visualization

`GraphView.vue` uses AntV G6 (`@antv/g6` v5) to render force-directed dependency graphs. The `Graph` instance is created in `onMounted` and destroyed in `onBeforeUnmount`. Data comes from `graphApi.getProjectDependencies()`.

Graph nodes have types: `file | function | class`. Edges have types: `imports | contains | calls`.

### Auth flow

JWT token stored in `localStorage` under key `token`. The axios instance in `src/api/index.ts` attaches it to every request. On 401 responses, the interceptor clears the token and redirects to `/login`.

### Project model

Projects have a `status` enum: `pending | analyzing | completed | failed`. The backend analyzes repositories from GitHub, GitLab, or zip uploads via `projectsApi.analyzeProject(id)`.
