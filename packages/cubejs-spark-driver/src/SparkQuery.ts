import { BaseQuery, BaseFilter } from '@cubejs-backend/schema-compiler';

/**
 * Custom filter for Spark SQL that handles parameter casting and LIKE operations
 */
class SparkFilter extends BaseFilter {
  public likeIgnoreCase(column, not, param, type) {
    const p = (!type || type === 'contains' || type === 'ends') ? '%' : '';
    const s = (!type || type === 'contains' || type === 'starts') ? '%' : '';
    // Spark SQL LIKE with CONCAT for pattern building
    return `LOWER(${column})${not ? ' NOT' : ''} LIKE CONCAT('${p}', LOWER(${this.allocateParam(param)}) , '${s}')`;
  }

  public castParameter() {
    if (this.definition().type === 'boolean') {
      return 'CAST(? AS BOOLEAN)';
    } else if (this.measure || this.definition().type === 'number') {
      return 'CAST(? AS DOUBLE)';
    }
    return '?';
  }
}

/**
 * Spark SQL query dialect that extends BaseQuery with Spark-specific syntax.
 * Based on Presto/Trino dialect but customized for Spark SQL:
 * - Uses backtick (`) identifiers instead of double quotes
 * - Uses Spark-specific timestamp functions (to_timestamp, from_utc_timestamp)
 * - Uses date_trunc for time grouping
 * - Uses STRING type instead of VARCHAR
 */
export class SparkQuery extends BaseQuery {
  public get shouldReuseParams() {
    return true;
  }

  public newFilter(filter) {
    return new SparkFilter(this, filter);
  }

  /**
   * Spark uses backticks for identifier escaping instead of double quotes
   */
  public escapeColumnName(name) {
    return `\`${name}\``;
  }

  /**
   * Convert UTC timestamp to target timezone using Spark's from_utc_timestamp
   */
  public convertTz(field) {
    return `from_utc_timestamp(${field}, '${this.timezone}')`;
  }

  /**
   * Cast string to timestamp using Spark's to_timestamp function
   */
  public timeStampCast(value) {
    return `to_timestamp(${value})`;
  }

  /**
   * Cast to timestamp (same as timeStampCast in Spark)
   */
  public dateTimeCast(value) {
    return `to_timestamp(${value})`;
  }

  /**
   * Parameter placeholder for timestamp values
   */
  public timeStampParam() {
    return `to_timestamp(?)`;
  }

  /**
   * Generate time series SQL using Spark's to_timestamp
   */
  public seriesSql(timeDimension) {
    const values = timeDimension.timeSeries().map(
      ([from, to]) => `select '${from}' f, '${to}' t`
    ).join(' UNION ALL ');
    return `SELECT to_timestamp(dates.f) date_from, to_timestamp(dates.t) date_to FROM (${values}) AS dates`;
  }

  /**
   * Subtract interval from date using Spark SQL INTERVAL syntax
   */
  public subtractInterval(date, interval) {
    const [number, type] = this.parseInterval(interval);
    return `(${date} - INTERVAL '${number}' ${type})`;
  }

  /**
   * Add interval to date using Spark SQL INTERVAL syntax
   */
  public addInterval(date, interval) {
    const [number, type] = this.parseInterval(interval);
    return `(${date} + INTERVAL '${number}' ${type})`;
  }

  /**
   * Group time dimension by granularity using date_trunc
   */
  public timeGroupedColumn(granularity, dimension) {
    const GRANULARITY_TO_INTERVAL = {
      day: 'day',
      week: 'week',
      hour: 'hour',
      minute: 'minute',
      second: 'second',
      month: 'month',
      quarter: 'quarter',
      year: 'year'
    };
    return `date_trunc('${GRANULARITY_TO_INTERVAL[granularity]}', ${dimension})`;
  }

  /**
   * Get current Unix timestamp (epoch seconds)
   */
  public unixTimestampSql() {
    return 'unix_timestamp()';
  }

  /**
   * LIMIT and OFFSET clause (order matters for Spark: LIMIT first, then OFFSET)
   */
  protected limitOffsetClause(limit, offset) {
    const limitClause = limit != null ? ` LIMIT ${limit}` : '';
    const offsetClause = offset != null ? ` OFFSET ${offset}` : '';
    return `${limitClause}${offsetClause}`;
  }

  /**
   * Cast to STRING type (Spark uses STRING instead of VARCHAR)
   */
  public castToString(sql: string): string {
    return `CAST(${sql} as STRING)`;
  }

  /**
   * Approximate count distinct using Spark's approx_count_distinct
   */
  public countDistinctApprox(sql: string): string {
    return `approx_count_distinct(${sql})`;
  }

  /**
   * Default refresh key renewal threshold in seconds
   */
  public defaultRefreshKeyRenewalThreshold(): number {
    return 120;
  }

  /**
   * Default refresh key interval
   */
  public defaultEveryRefreshKey(): any {
    return {
      every: '2 minutes'
    };
  }

  public sqlTemplates() {
    const templates = super.sqlTemplates();
    templates.functions.CURRENTDATE = 'CURRENT_DATE';
    templates.functions.DATETRUNC = 'DATE_TRUNC({{ args_concat }})';
    templates.functions.DATEPART = 'DATE_PART({{ args_concat }})';
    templates.functions.BTRIM = 'TRIM({% if args[1] is defined %}{{ args[1] }} FROM {% endif %}{{ args[0] }})';
    templates.functions.LTRIM = 'LTRIM({{ args|reverse|join(", ") }})';
    templates.functions.RTRIM = 'RTRIM({{ args|reverse|join(", ") }})';
    templates.functions.DATEDIFF = 'DATEDIFF({{ date_part }}, DATE_TRUNC(\'{{ date_part }}\', {{ args[1] }}), DATE_TRUNC(\'{{ date_part }}\', {{ args[2] }}))';
    templates.functions.LEAST = 'LEAST({{ args_concat }})';
    templates.functions.GREATEST = 'GREATEST({{ args_concat }})';
    templates.functions.TRUNC = 'CASE WHEN ({{ args[0] }}) >= 0 THEN FLOOR({{ args_concat }}) ELSE CEIL({{ args_concat }}) END';
    templates.expressions.timestamp_literal = 'from_utc_timestamp(\'{{ value }}\', \'UTC\')';
    templates.expressions.extract = '{% if date_part|lower == "epoch" %}unix_timestamp({{ expr }}){% else %}EXTRACT({{ date_part }} FROM {{ expr }}){% endif %}';
    templates.expressions.interval_single_date_part = 'INTERVAL \'{{ num }}\' {{ date_part }}';
    templates.quotes.identifiers = '`';
    templates.quotes.escape = '``';
    templates.statements.time_series_select = 'SELECT date_from::timestamp AS `date_from`,\n' +
      'date_to::timestamp AS `date_to` \n' +
      'FROM(\n' +
      '    VALUES ' +
      '{% for time_item in seria  %}' +
      '(\'{{ time_item | join(\'\\\', \\\'\') }}\')' +
      '{% if not loop.last %}, {% endif %}' +
      '{% endfor %}' +
      ') AS dates (date_from, date_to)';
    delete templates.types.time;
    delete templates.types.interval;
    return templates;
  }
}
