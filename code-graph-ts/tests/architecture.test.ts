import { describe, it, expect } from 'bun:test';
import { detectLayer, LayerId } from '../src/api/routes/frontend.ts';
import type { GraphNode } from '../src/graph/schema.ts';

describe('detectLayer', () => {
  const makeNode = (label: string, file: string, annotations?: string[]): GraphNode => ({
    id: `test:${label}`,
    label,
    type: 'Class',
    file,
    metadata: annotations ? { annotations } : {},
  });

  it('识别 @Controller 注解为 API 层', () => {
    const node = makeNode('UserController', '/src/controller/UserController.java', ['@Controller', '@RequestMapping']);
    expect(detectLayer(node)).toBe(LayerId.api);
  });

  it('识别 @Service 注解为业务层', () => {
    const node = makeNode('UserService', '/src/service/UserService.java', ['@Service']);
    expect(detectLayer(node)).toBe(LayerId.business);
  });

  it('识别 @Repository 注解为数据层', () => {
    const node = makeNode('UserRepository', '/src/repository/UserRepository.java', ['@Repository']);
    expect(detectLayer(node)).toBe(LayerId.data);
  });

  it('通过包名识别 API 层', () => {
    const node = makeNode('OrderApi', '/src/api/rest/OrderApi.java');
    expect(detectLayer(node)).toBe(LayerId.api);
  });

  it('通过包名识别业务层', () => {
    const node = makeNode('PaymentFacade', '/src/facade/PaymentFacade.java');
    expect(detectLayer(node)).toBe(LayerId.business);
  });

  it('通过包名识别数据层', () => {
    const node = makeNode('ProductDao', '/src/dao/ProductDao.java');
    expect(detectLayer(node)).toBe(LayerId.data);
  });

  it('通过类名后缀识别 API 层', () => {
    const node = makeNode('HealthEndpoint', '/src/misc/HealthEndpoint.java');
    expect(detectLayer(node)).toBe(LayerId.api);
  });

  it('通过类名后缀识别业务层', () => {
    const node = makeNode('CacheManager', '/src/misc/CacheManager.java');
    expect(detectLayer(node)).toBe(LayerId.business);
  });

  it('未匹配节点归入基础设施层', () => {
    const node = makeNode('StringUtils', '/src/misc/StringUtils.java');
    expect(detectLayer(node)).toBe(LayerId.infrastructure);
  });
});