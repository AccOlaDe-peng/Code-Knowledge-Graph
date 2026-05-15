import { Hono } from 'hono'

const meta = new Hono()

const ARCHITECTURE_TYPES = [
  'Module', 'Layer', 'Service', 'BoundedContext', 'Domain', 'Component',
  'APIEndpoint', 'ExternalAPI', 'DataSource', 'Database', 'API', 'DataSink',
]

const STRUCTURAL_EDGE_TYPES = [
  'contains', 'depends_on', 'imports', 'extends', 'uses', 'implements', 'overrides', 'belongs_to',
]

meta.get('/node-types', (c) => {
  return c.json({
    version: '2.0.0',
    architecture_types: ARCHITECTURE_TYPES,
    structural_edge_types: STRUCTURAL_EDGE_TYPES,
    call_edge_types: ['calls'],
  })
})

export default meta
