import type { IconProps } from './index'

// Re-import icons from main file to avoid circular dependency
// This file is for the mapping only

// Node type icon mapping
// Note: Import the actual icon components from './index' when using this map
export const NODE_TYPE_ICON_NAMES: Record<string, string> = {
  Module: 'IconModule',
  Function: 'IconFunction',
  API: 'IconAPI',
  APIEndpoint: 'IconAPI',
  Database: 'IconDatabase',
  Table: 'IconTable',
  Event: 'IconEvent',
  EventHandler: 'IconEvent',
  Topic: 'IconTopic',
  Class: 'IconClass',
  Service: 'IconService',
  Component: 'IconComponent',
  Cluster: 'IconCluster',
  Repository: 'IconRepository',
  File: 'IconFunction',
  DataSource: 'IconDatabase',
  DataSink: 'IconDatabase',
  DataObject: 'IconTable',
  MessageQueue: 'IconTopic',
  Pipeline: 'IconFunction',
  Layer: 'IconModule',
  Flow: 'IconFunction',
  BusinessFlow: 'IconFunction',
  Domain: 'IconModule',
  BoundedContext: 'IconModule',
  DomainEntity: 'IconClass',
  ExternalAPI: 'IconAPI',
  Infrastructure: 'IconCluster',
}

// Helper type for icon component
export type IconComponent = React.FC<IconProps>
