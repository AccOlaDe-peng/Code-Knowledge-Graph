import { describe, it, expect } from 'vitest'
import { NodeTypes, EdgeTypes } from '../src/types/graph.js'

describe('NodeTypes', () => {
  it('包含 Repository 类型', () => {
    expect(NodeTypes.Repository).toBe('repository')
  })

  it('包含 37 种类型', () => {
    expect(Object.keys(NodeTypes)).toHaveLength(37)
  })

  it('所有值为小写', () => {
    for (const val of Object.values(NodeTypes)) {
      expect(val).toBe(val.toLowerCase())
    }
  })
})

describe('EdgeTypes', () => {
  it('包含 contains 类型', () => {
    expect(EdgeTypes.contains).toBe('contains')
  })

  it('包含 30+ 种类型', () => {
    expect(Object.keys(EdgeTypes).length).toBeGreaterThanOrEqual(30)
  })
})
