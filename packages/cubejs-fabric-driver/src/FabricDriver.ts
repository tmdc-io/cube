/**
 * @copyright Cube Dev, Inc.
 * @license Apache-2.0
 * @fileoverview The `FabricDriver` and related types declaration.
 */

import { MSSqlDriver, MSSqlDriverConfiguration } from '@cubejs-backend/mssql-driver';
import { getEnv, assertDataSource } from '@cubejs-backend/shared';
import { FabricQuery } from './FabricQuery';

export type FabricDriverConfiguration = MSSqlDriverConfiguration & {
  /**
   * Azure AD tenant id used for Service Principal authentication.
   * Falls back to CUBEJS_DB_DOMAIN.
   */
  tenantId?: string,

  /**
   * Service Principal application (client) id.
   * Falls back to CUBEJS_DB_USER.
   */
  clientId?: string,

  /**
   * Service Principal client secret.
   * Falls back to CUBEJS_DB_PASS.
   */
  clientSecret?: string,
};

// Fabric does not support unicode string types (NVARCHAR/NCHAR), bare
// VARCHAR defaults to length 1, and temporal precision is capped at 6.
// https://learn.microsoft.com/en-us/fabric/data-warehouse/data-types
const GenericTypeToFabric: Record<string, string> = {
  boolean: 'bit',
  string: 'varchar(8000)',
  text: 'varchar(8000)',
  timestamp: 'datetime2(6)',
  uuid: 'uniqueidentifier',
};

/**
 * Microsoft Fabric Data Warehouse driver.
 *
 * Fabric warehouses speak the TDS protocol, so the standard `mssql` client
 * used by MSSqlDriver works as-is. The differences are:
 * - Fabric only accepts Azure AD authentication. When a tenant id is
 *   configured (CUBEJS_DB_DOMAIN), the driver authenticates as an Azure
 *   Service Principal using CUBEJS_DB_USER as the client id and
 *   CUBEJS_DB_PASS as the client secret.
 * - Connections must always be encrypted.
 * - Generic types are mapped to Fabric-supported column types.
 */
export class FabricDriver extends MSSqlDriver {
  public constructor(config: FabricDriverConfiguration & {
    dataSource?: string,
    preAggregations?: boolean,
    maxPoolSize?: number,
    minPoolSize?: number,
    testConnectionTimeout?: number,
  } = {}) {
    super(FabricDriver.enrichConfig(config));
  }

  /**
   * Returns the Fabric-specific query dialect class.
   */
  public static dialectClass() {
    return FabricQuery;
  }

  private static enrichConfig(config: FabricDriverConfiguration & {
    dataSource?: string,
    preAggregations?: boolean,
  }): FabricDriverConfiguration {
    const dataSource = config.dataSource || assertDataSource('default');
    const preAggregations = config.preAggregations || false;

    const tenantId = config.tenantId || getEnv('dbDomain', { dataSource, preAggregations });
    const clientId = config.clientId || getEnv('dbUser', { dataSource, preAggregations });
    const clientSecret = config.clientSecret || getEnv('dbPass', { dataSource, preAggregations });

    if (tenantId && (!clientId || !clientSecret)) {
      throw new Error(
        'Fabric Service Principal authentication requires tenantId, clientId, and clientSecret'
      );
    }

    const enriched: FabricDriverConfiguration = {
      ...config,
      options: {
        trustServerCertificate: false,
        useUTC: true,
        ...(config as any).options,
        // Fabric requires encrypted connections; user config must not disable it.
        encrypt: true,
      },
    };

    if (tenantId) {
      // Fabric only supports Azure AD auth; authenticate as a Service Principal
      (enriched as any).authentication = {
        type: 'azure-active-directory-service-principal-secret',
        options: {
          tenantId,
          clientId,
          clientSecret,
        },
      };
      // Unset SQL-auth fields the base driver picks up from the environment so
      // they don't conflict with the Azure AD authentication block
      (enriched as any).user = undefined;
      (enriched as any).password = undefined;
      (enriched as any).domain = undefined;
    }

    return enriched;
  }

  protected fromGenericType(columnType: string): string {
    return GenericTypeToFabric[columnType] || super.fromGenericType(columnType);
  }
}
