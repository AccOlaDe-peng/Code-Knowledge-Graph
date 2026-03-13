import { GraphNode } from '../../types/graph';

/**
 * Level-of-Detail (LOD) Manager
 * Filters nodes based on zoom level to improve performance
 */
export class LODManager {
  private zoomLevel: number = 1.0;

  /**
   * Update zoom level
   */
  setZoomLevel(zoom: number): void {
    this.zoomLevel = zoom;
  }

  /**
   * Get current zoom level
   */
  getZoomLevel(): number {
    return this.zoomLevel;
  }

  /**
   * Filter nodes based on zoom level
   *
   * Rules:
   * - zoom < 0.3: Only Module nodes
   * - zoom < 0.6: Module + File nodes
   * - zoom < 0.8: Module + File + Class nodes
   * - zoom >= 0.8: All nodes (including Function)
   */
  filterNodesByZoom(nodes: GraphNode[]): GraphNode[] {
    if (this.zoomLevel < 0.3) {
      // Only show Module nodes
      return nodes.filter(node => node.type === 'Module');
    } else if (this.zoomLevel < 0.6) {
      // Show Module and File nodes
      return nodes.filter(node =>
        node.type === 'Module' || node.type === 'File'
      );
    } else if (this.zoomLevel < 0.8) {
      // Show Module, File, and Class nodes
      return nodes.filter(node =>
        node.type === 'Module' ||
        node.type === 'File' ||
        node.type === 'Class'
      );
    } else {
      // Show all nodes
      return nodes;
    }
  }

  /**
   * Get node size based on zoom level
   */
  getNodeSize(nodeType: string): number {
    const baseSizes: Record<string, number> = {
      Module: 15,
      File: 12,
      Class: 10,
      Function: 8,
      API: 10,
      Database: 12,
      Table: 10,
      Event: 10,
      Topic: 10,
    };

    const baseSize = baseSizes[nodeType] || 10;

    // Scale size based on zoom
    if (this.zoomLevel < 0.5) {
      return baseSize * 1.5;
    } else if (this.zoomLevel < 1.0) {
      return baseSize * 1.2;
    } else {
      return baseSize;
    }
  }

  /**
   * Should render node labels based on zoom
   */
  shouldRenderLabels(): boolean {
    return this.zoomLevel >= 0.5;
  }

  /**
   * Get label size threshold based on zoom
   */
  getLabelSizeThreshold(): number {
    if (this.zoomLevel < 0.5) {
      return 20;
    } else if (this.zoomLevel < 1.0) {
      return 15;
    } else {
      return 10;
    }
  }

  /**
   * Get current LOD level description
   */
  getLODLevel(): string {
    if (this.zoomLevel < 0.3) {
      return 'Module View';
    } else if (this.zoomLevel < 0.6) {
      return 'File View';
    } else if (this.zoomLevel < 0.8) {
      return 'Class View';
    } else {
      return 'Detail View';
    }
  }
}
