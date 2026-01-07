import { PrestoDriver } from '@cubejs-backend/prestodb-driver';
import { QuerySchemasResult, QueryTablesResult } from '@cubejs-backend/base-driver';
import { SparkQuery } from './SparkQuery';
import SqlString from 'sqlstring';

/**
 * Spark driver that extends PrestoDriver and uses SparkQuery for SQL generation.
 * Like TrinoDriver, this reuses the Presto client protocol but customizes the SQL dialect.
 */
export class SparkDriver extends PrestoDriver {
  public constructor(options: any) {
    super({ ...options, engine: 'trino' });
  }

  /**
   * Override to use double quotes for string literals (for Python compatibility)
   * instead of single quotes. Spark SQL supports both, but double quotes match
   * the escape_literal pattern in the Python fetchdf_with_params implementation.
   */
  public prepareQueryWithParams(query: string, values: unknown[]) {
    return SqlString.format(query, (values || []).map(value => {
      if (typeof value === 'string') {
        // Escape double quotes and wrap in double quotes (instead of single quotes)
        const escaped = value.replace(/"/g, '""');
        return { toSqlString: () => `"${escaped}"` };
      }
      return value;
    }));
  }

  /**
   * Return the Spark-specific query dialect class
   */
  public static dialectClass() {
    return SparkQuery;
  }

  /**
   * Get database schemas using Spark's SHOW SCHEMAS command
   */
  public getSchemas() {
    const query = 'show schemas';
    return this.query(query, []).then((data) => data.map(d => ({ schema_name: d['namespace'] })));
  }

  /**
   * Get tables for specific schemas using Spark's SHOW TABLES command
   */
  public getTablesForSpecificSchemas(schemas: QuerySchemasResult[]) {
    const schemaNames = schemas.map(s => s.schema_name);
    const query = `show tables in ${schemaNames[0]}`;
    return this.query(query, []).then((data) => data.map(d => ({
      schema_name: d['namespace'],
      table_name: d['tableName']
    })));
  }

  /**
   * Get column information using Spark's DESCRIBE TABLE command
   */
  public getColumnsForSpecificTables(tables: QueryTablesResult[]) {
    const { schema_name: schemaName, table_name: tableName } = tables[0];
    const query = `describe table ${schemaName}.${tableName}`;
    return this.query(query, []).then((data) => data.map(d => ({
      schema_name: schemaName,
      table_name: tableName,
      column_name: d['col_name'],
      data_type: d['data_type'],
      attributes: [d['comment']],
    })));
  }
}
