# Frontend Architecture Upgrade

## 📁 New Directory Structure

```
src/
├── app/                    # Application core
│   ├── router/            # Route configuration
│   └── providers/         # Global providers
│
├── core/                   # Core infrastructure
│   ├── api/               # API client & endpoints
│   │   ├── client.ts      # Axios client with interceptors
│   │   └── endpoints/     # API endpoint modules
│   │       ├── graph.ts
│   │       └── rag.ts
│   └── hooks/             # Shared hooks
│       ├── useAsync.ts
│       └── useDebounce.ts
│
├── components/             # Shared component library
│   ├── graph/             # Graph visualization components
│   │   ├── GraphViewer/   # Main graph renderer (Cytoscape.js)
│   │   ├── NodeDetailPanel/  # Node details drawer
│   │   └── GraphToolbar/  # Graph controls toolbar
│   └── ui/                # UI components
│       ├── SearchBar/     # Node search with filters
│       ├── FilterPanel/   # Advanced filtering
│       ├── StatCard/      # Metric display card
│       └── ChartCard/     # Chart container
│
├── features/               # Feature modules (new architecture)
│   └── architecture/      # Architecture Explorer
│       ├── components/    # Feature-specific components
│       ├── hooks/         # Feature-specific hooks
│       ├── types/         # Feature-specific types
│       └── index.tsx      # Feature entry point
│
├── pages/                  # Legacy pages (to be migrated)
├── layouts/                # Layout components
├── store/                  # Global state (Zustand)
├── types/                  # Global TypeScript types
└── theme/                  # Design system & theming
```

## 🎯 Key Improvements

### 1. Modular Architecture
- **Feature modules**: Self-contained features with their own components, hooks, and types
- **Separation of concerns**: Clear boundaries between UI, business logic, and data
- **Scalability**: Easy to add new features without affecting existing code

### 2. Reusable Component Library
- **Graph components**: Production-ready graph visualization components
- **UI components**: Consistent, reusable UI elements
- **Type-safe**: Full TypeScript support with exported types

### 3. Centralized API Layer
- **Single client**: Unified Axios client with interceptors
- **Endpoint modules**: Organized by domain (graph, rag, etc.)
- **Error handling**: Consistent error handling across all requests
- **Type safety**: Full type definitions for requests and responses

### 4. Custom Hooks
- **useAsync**: Generic async operation handler with loading/error states
- **useDebounce**: Debounce values for search and filters
- **Reusable**: Can be used across all features

## 🚀 Usage Examples

### Using New Components

```tsx
import { GraphViewer, NodeDetailPanel, GraphToolbar, SearchBar } from '@/components'

function MyFeature() {
  const [layout, setLayout] = useState<LayoutName>('force')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)

  return (
    <>
      <SearchBar nodes={nodes} onSearch={handleSearch} onSelect={setSelectedNode} />
      <GraphToolbar layout={layout} onLayoutChange={setLayout} />
      <GraphViewer nodes={nodes} edges={edges} layout={layout} onNodeClick={setSelectedNode} />
      <NodeDetailPanel node={selectedNode} edges={edges} allNodes={nodes} onClose={() => setSelectedNode(null)} />
    </>
  )
}
```

### Using New API Layer

```tsx
import { graphEndpoints, ragEndpoints } from '@/core/api'

// List all graphs
const graphs = await graphEndpoints.listGraphs()

// Get specific graph
const graph = await graphEndpoints.getGraph('my-graph-id')

// Execute RAG query
const result = await ragEndpoints.query({
  graph_id: 'my-graph-id',
  question: 'How does authentication work?',
})
```

### Using Custom Hooks

```tsx
import { useAsync, useDebounce } from '@/core/hooks'

function MyComponent() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)

  const { data, loading, error, execute } = useAsync(
    async () => await searchNodes(debouncedQuery),
    false
  )

  useEffect(() => {
    if (debouncedQuery) {
      execute()
    }
  }, [debouncedQuery])

  return <div>{/* ... */}</div>
}
```

## 📦 Component Library

### Graph Components

| Component | Description | Props |
|-----------|-------------|-------|
| `GraphViewer` | Main graph visualization using Cytoscape.js | `nodes`, `edges`, `layout`, `onNodeClick` |
| `NodeDetailPanel` | Drawer showing node details and connections | `node`, `edges`, `allNodes`, `onClose` |
| `GraphToolbar` | Toolbar with layout switcher and controls | `layout`, `onLayoutChange`, `onZoomIn`, etc. |

### UI Components

| Component | Description | Props |
|-----------|-------------|-------|
| `SearchBar` | Search nodes with type filters | `nodes`, `onSearch`, `onSelect` |
| `FilterPanel` | Advanced filtering drawer | `filters`, `onFiltersChange` |
| `StatCard` | Metric display card with icon | `icon`, `label`, `value`, `color` |
| `ChartCard` | Container for charts | `title`, `children` |

## 🔄 Migration Strategy

### Phase 1: Infrastructure (✅ Complete)
- [x] Create new directory structure
- [x] Refactor API layer
- [x] Create shared components
- [x] Create custom hooks

### Phase 2: Feature Modules (🚧 In Progress)
- [x] Architecture Explorer (new feature module)
- [ ] Service Map
- [ ] Business Flow
- [ ] Call Graph (migrate from pages)
- [ ] Data Lineage (migrate from pages)
- [ ] Impact Analysis (migrate from pages)
- [ ] AI Query (migrate from pages)

### Phase 3: Optimization (⏳ Pending)
- [ ] Implement virtualization for large graphs
- [ ] Add Web Worker for graph calculations
- [ ] Implement node clustering
- [ ] Add layout caching

### Phase 4: Testing & Documentation (⏳ Pending)
- [ ] Unit tests for components
- [ ] Integration tests for features
- [ ] E2E tests for critical flows
- [ ] Storybook documentation

## 🎨 Design System

The project uses a custom "Mission Control Dark" theme with:
- **Color tokens**: Defined in `src/theme/index.ts`
- **CSS variables**: Defined in `src/styles/global.css`
- **Ant Design theme**: Customized in `src/theme/index.ts`

### Color Palette

| Token | Color | Usage |
|-------|-------|-------|
| `--a-cyan` | #00d4ff | Primary accent, Module nodes |
| `--a-green` | #00f084 | Success, Service nodes |
| `--a-amber` | #ffc145 | Warning, Function nodes |
| `--a-purple` | #b08eff | Class nodes, Database |
| `--s-void` | #07090d | Deepest background |

## 🔧 Development

### Running the Project

```bash
cd code-graph-ui
npm install
npm run dev
```

### Building for Production

```bash
npm run build
npm run preview
```

### Code Quality

```bash
npm run lint
npm run type-check
```

## 📝 Next Steps

1. **Migrate remaining pages** to feature modules
2. **Add performance optimizations** for large graphs (100k+ nodes)
3. **Implement testing** infrastructure
4. **Create Storybook** documentation
5. **Add error boundaries** for better error handling
6. **Implement analytics** tracking

## 🤝 Contributing

When adding new features:
1. Create a new feature module in `src/features/`
2. Use shared components from `src/components/`
3. Use the centralized API layer from `src/core/api/`
4. Follow the existing TypeScript patterns
5. Add proper type definitions

---

**Status**: Phase 1 Complete ✅ | Phase 2 In Progress 🚧
