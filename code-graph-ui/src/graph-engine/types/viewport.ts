// ─── Viewport Pan ─────────────────────────────────────────────────────────────

export type ViewportPan = {
  x: number
  y: number
}

// ─── Viewport BBox ────────────────────────────────────────────────────────────
// Axis-aligned bounding box in graph (model) coordinates.
// Computed from Cytoscape's `cy.extent()` and expanded by VIEWPORT_BUFFER_RATIO
// to pre-load nodes just outside the visible area.

export type ViewportBBox = {
  x1: number   // left edge
  y1: number   // top edge
  x2: number   // right edge
  y2: number   // bottom edge
}

// ─── Graph Viewport ───────────────────────────────────────────────────────────

export type GraphViewport = {
  /** Current pan offset in graph coordinates (matches cy.pan()). */
  pan: ViewportPan

  /**
   * Current zoom level.
   * 1.0 = 100%, < 1.0 = zoomed out, > 1.0 = zoomed in.
   * Matches cy.zoom().
   */
  zoom: number

  /**
   * Visible bounding box in graph coordinates, expanded by VIEWPORT_BUFFER_RATIO.
   * ViewportCuller uses this to determine which nodes are "in viewport".
   */
  bbox: ViewportBBox

  /** Canvas element pixel width (used to compute bbox from pan/zoom). */
  width: number

  /** Canvas element pixel height (used to compute bbox from pan/zoom). */
  height: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Fraction by which the viewport BBox is extended on each side.
 * 0.2 = 20% buffer. Prevents flickering when nodes enter the viewport edge.
 */
export const VIEWPORT_BUFFER_RATIO = 0.2

/**
 * Debounce delay (ms) for viewport change events (pan / zoom).
 * Prevents ViewportCuller from running on every pixel of a drag.
 */
export const VIEWPORT_DEBOUNCE_MS = 100

/**
 * Zoom level below which ALL Function-type nodes are hidden regardless of
 * viewport position (density guard for 50k+ function nodes).
 */
export const ZOOM_HIDE_FUNCTIONS_BELOW = 0.3

/**
 * Zoom level below which ALL Class-type nodes are hidden.
 */
export const ZOOM_HIDE_CLASSES_BELOW = 0.1

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Compute a buffered BBox from Cytoscape's raw extent + canvas dimensions. */
export function computeBufferedBBox(params: {
  pan:    ViewportPan
  zoom:   number
  width:  number
  height: number
}): ViewportBBox {
  const { pan, zoom, width, height } = params

  // Graph-space dimensions of the visible area
  const visW = width  / zoom
  const visH = height / zoom

  // Top-left corner in graph coordinates
  const x1raw = -pan.x / zoom
  const y1raw = -pan.y / zoom

  const bufX = visW * VIEWPORT_BUFFER_RATIO
  const bufY = visH * VIEWPORT_BUFFER_RATIO

  return {
    x1: x1raw - bufX,
    y1: y1raw - bufY,
    x2: x1raw + visW + bufX,
    y2: y1raw + visH + bufY,
  }
}

/** Returns true if a point (x, y) in graph coordinates is inside the BBox. */
export function isInBBox(bbox: ViewportBBox, x: number, y: number): boolean {
  return x >= bbox.x1 && x <= bbox.x2 && y >= bbox.y1 && y <= bbox.y2
}

/** Returns an initial "full world" viewport (zoom=1, centered at origin). */
export function createDefaultViewport(width = 800, height = 600): GraphViewport {
  return {
    pan:    { x: 0, y: 0 },
    zoom:   1,
    bbox:   computeBufferedBBox({ pan: { x: 0, y: 0 }, zoom: 1, width, height }),
    width,
    height,
  }
}
