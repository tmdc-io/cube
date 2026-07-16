import * as shared from '@cubejs-backend/shared';

import { FabricDriver, FabricQuery } from '../src';

describe('FabricQuery', () => {
  const templates = FabricQuery.prototype.sqlTemplates();

  it('does not emit the unsupported MAXRECURSION query hint', () => {
    expect(templates.statements.select).not.toContain('MAXRECURSION');
  });

  it('uses non-recursive generated time series', () => {
    for (const key of [
      'generated_time_series_select',
      'generated_time_series_with_cte_range_source',
    ] as const) {
      expect(templates.statements[key]).toContain('GENERATE_SERIES');
      expect(templates.statements[key]).not.toContain('FROM time_series');
    }
  });
});

describe('FabricDriver configuration', () => {
  const enrichConfig = (FabricDriver as any).enrichConfig.bind(FabricDriver);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects incomplete Service Principal credentials', () => {
    jest.spyOn(shared, 'getEnv').mockReturnValue(undefined as never);

    expect(() => enrichConfig({
      dataSource: 'default',
      tenantId: 'tenant-id',
    })).toThrow(
      'Service Principal authentication requires tenantId, clientId, and clientSecret'
    );
  });

  it('does not allow encryption to be disabled', () => {
    const config = enrichConfig({
      dataSource: 'default',
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      options: {
        encrypt: false,
      },
    });

    expect(config.options.encrypt).toBe(true);
  });
});
