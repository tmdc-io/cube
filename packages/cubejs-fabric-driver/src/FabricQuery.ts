import { MssqlQuery } from '@cubejs-backend/schema-compiler';

// Fabric does not support SQL Server's legacy implicit int-to-datetime
// conversion (DATEADD(day, ..., 0) / DATEDIFF(day, 0, ...)), so date
// truncation anchors on an explicitly cast epoch instead of `0`.
const EPOCH = 'CAST(\'1900-01-01\' AS DATETIME2(6))';

const GRANULARITY_TO_INTERVAL: Record<string, (date: string) => string> = {
  day: (date) => `DATEADD(day, DATEDIFF(day, ${EPOCH}, ${date}), ${EPOCH})`,
  week: (date) => `DATEADD(week, DATEDIFF(week, ${EPOCH}, ${date}), ${EPOCH})`,
  hour: (date) => `DATEADD(hour, DATEDIFF(hour, ${EPOCH}, ${date}), ${EPOCH})`,
  minute: (date) => `DATEADD(minute, DATEDIFF(minute, ${EPOCH}, ${date}), ${EPOCH})`,
  // MssqlQuery uses FORMAT() here, which Fabric does not support (CLR
  // function). Measure the offset from midnight of the same day instead,
  // which always fits in an INT.
  second: (date) => {
    const midnight = `CAST(CAST(${date} AS DATE) AS DATETIME2(6))`;
    return `DATEADD(second, DATEDIFF(second, ${midnight}, ${date}), ${midnight})`;
  },
  month: (date) => `DATEADD(month, DATEDIFF(month, ${EPOCH}, ${date}), ${EPOCH})`,
  quarter: (date) => `DATEADD(quarter, DATEDIFF(quarter, ${EPOCH}, ${date}), ${EPOCH})`,
  year: (date) => `DATEADD(year, DATEDIFF(year, ${EPOCH}, ${date}), ${EPOCH})`,
};

/**
 * Query dialect for Microsoft Fabric Data Warehouse.
 *
 * Fabric shares most of T-SQL's syntax but has a reduced surface area and
 * stricter type rules. The differences below were verified by transpiling
 * the SQL patterns MssqlQuery generates through SQLGlot's `fabric` dialect:
 *
 * - Temporal types are capped at 6 digits of precision (T-SQL allows 7);
 *   bare DATETIME2 casts are made explicit as DATETIME2(6).
 * - The DATETIMEOFFSET data type is not supported outside of AT TIME ZONE
 *   expressions - timestamp params are cast to DATETIME2(6) instead.
 * - VARCHAR/CHAR without a length default to length 1, so string casts
 *   carry an explicit length.
 * - No implicit int-to-datetime conversion: DATEADD/DATEDIFF date-anchor
 *   shorthands (`0`, bare string literals) require explicit casts.
 * - FORMAT() is not supported (CLR function), so the `second` granularity
 *   truncation uses DATEADD/DATEDIFF instead.
 * - Unicode types (NCHAR/NVARCHAR) and TINYINT are not supported.
 *
 * References:
 * - https://learn.microsoft.com/en-us/fabric/data-warehouse/data-types
 * - https://learn.microsoft.com/en-us/fabric/data-warehouse/tsql-surface-area
 */
export class FabricQuery extends MssqlQuery {
  public castToString(sql: string): string {
    // Bare VARCHAR defaults to a tiny length in Fabric - always be explicit
    return `CAST(${sql} as VARCHAR(8000))`;
  }

  public timeStampCast(value: string): string {
    // Fabric does not support the DATETIMEOFFSET data type; timestamps are
    // DATETIME2 capped at 6 digits of precision
    return `CAST(${value} AS DATETIME2(6))`;
  }

  public dateTimeCast(value: string): string {
    // Fabric caps DATETIME2 precision at 6 (T-SQL default is 7)
    return `CAST(${value} AS DATETIME2(6))`;
  }

  public convertTz(field: string): string {
    // Reuse the MSSQL SWITCHOFFSET/TODATETIMEOFFSET (or AT TIME ZONE) logic,
    // but the resulting cast must be precision-capped for Fabric
    return super.convertTz(field).replace(/AS DATETIME2\)/g, 'AS DATETIME2(6))');
  }

  public timeGroupedColumn(granularity: string, dimension: string): string {
    return GRANULARITY_TO_INTERVAL[granularity](dimension);
  }

  public unixTimestampSql(): string {
    // DATEDIFF cannot implicitly convert a string literal or GETUTCDATE()
    // result in Fabric - both operands need explicit DATETIME2 casts
    return `DATEDIFF(SECOND, CAST('1970-01-01' AS DATETIME2(6)), CAST(GETUTCDATE() AS DATETIME2(6)))`;
  }

  public sqlTemplates() {
    const templates = super.sqlTemplates();

    // Explicit lengths/precisions: bare VARCHAR/VARBINARY default to length 1
    // in Fabric, bare DATETIME2 precision is capped at 6
    templates.types.string = 'VARCHAR(8000)';
    templates.types.binary = 'VARBINARY(8000)';
    templates.types.timestamp = 'DATETIME2(6)';

    // Fabric maps TINYINT to SMALLINT (TINYINT is not supported)
    templates.types.tinyint = 'SMALLINT';

    // Cap bare DATETIME2 casts in the time-series templates inherited from MSSQL
    for (const key of [
      'time_series_select',
      'generated_time_series_select',
      'generated_time_series_with_cte_range_source',
    ]) {
      if (templates.statements[key]) {
        templates.statements[key] = templates.statements[key]
          .replace(/AS DATETIME2\)/g, 'AS DATETIME2(6))');
      }
    }

    // Fabric supports regular CTEs but not recursive queries or the MSSQL
    // MAXRECURSION hint. GENERATE_SERIES provides the same date ranges
    // without recursion.
    templates.statements.generated_time_series_select =
      'SELECT DATEADD({{ minimal_time_unit }}, series.value, CAST({{ start }} AS DATETIME2(6))) AS date_from,\n' +
      '       DATEADD(MILLISECOND, -1, DATEADD({{ minimal_time_unit }}, series.value + 1, CAST({{ start }} AS DATETIME2(6)))) AS date_to\n' +
      'FROM GENERATE_SERIES(\n' +
      '  0,\n' +
      '  DATEDIFF({{ minimal_time_unit }}, CAST({{ start }} AS DATETIME2(6)), CAST({{ end }} AS DATETIME2(6)))\n' +
      ') AS series';

    templates.statements.generated_time_series_with_cte_range_source =
      'SELECT DATEADD({{ minimal_time_unit }}, series.value, {{ range_source }}.{{ min_name }}) AS date_from,\n' +
      '       DATEADD(MILLISECOND, -1, DATEADD({{ minimal_time_unit }}, series.value + 1, {{ range_source }}.{{ min_name }})) AS date_to,\n' +
      '       {{ range_source }}.{{ max_name }} AS max_date\n' +
      'FROM {{ range_source }}\n' +
      'CROSS APPLY GENERATE_SERIES(\n' +
      '  0,\n' +
      '  DATEDIFF({{ minimal_time_unit }}, {{ range_source }}.{{ min_name }}, {{ range_source }}.{{ max_name }})\n' +
      ') AS series';

    templates.statements.select = templates.statements.select.replace(
      '{% if ctes %}\nOPTION (MAXRECURSION 0){% endif %}',
      ''
    );

    return templates;
  }
}
