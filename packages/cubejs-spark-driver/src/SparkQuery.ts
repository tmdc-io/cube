import { PrestodbQuery, BaseFilter } from '@cubejs-backend/schema-compiler';

const GRANULARITY_TO_INTERVAL = {
  day: 'day',
  week: 'week',
  hour: 'hour',
  minute: 'minute',
  second: 'second',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
};

class SparkFilter extends BaseFilter {
  public likeIgnoreCase(column, not, param, type) {
    const p = (!type || type === 'contains' || type === 'ends') ? '%' : '';
    const s = (!type || type === 'contains' || type === 'starts') ? '%' : '';
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
 * Spark SQL dialect: Prestodb/Trino lineage with Spark-specific SQL builders
 * (same pattern as ThemisQuery in lens2).
 */
export class SparkQuery extends PrestodbQuery {
  public get shouldReuseParams() {
    return true;
  }

  public newFilter(filter) {
    return new SparkFilter(this, filter);
  }

  public escapeColumnName(name) {
    return `\`${name}\``;
  }

  public convertTz(field) {
    return `from_utc_timestamp(${field}, '${this.timezone}')`;
  }

  public timeStampCast(value) {
    return `to_timestamp('${value}')`;
  }

  public dateTimeCast(value) {
    return `to_timestamp('${value}')`;
  }

  public timeStampParam() {
    return 'to_timestamp(?)';
  }

  public seriesSql(timeDimension) {
    const values = timeDimension.timeSeries().map(
      ([from, to]) => `select '${from}' f, '${to}' t`,
    ).join(' UNION ALL ');
    return `SELECT to_timestamp(dates.f) date_from, to_timestamp(dates.t) date_to FROM (${values}) AS dates`;
  }

  public subtractInterval(date, interval) {
    const [number, type] = this.parseInterval(interval);
    return `(${date} - INTERVAL '${number}' ${type})`;
  }

  public addInterval(date, interval) {
    const [number, type] = this.parseInterval(interval);
    return `(${date} + INTERVAL '${number}' ${type})`;
  }

  public timeGroupedColumn(granularity, dimension) {
    return `date_trunc('${GRANULARITY_TO_INTERVAL[granularity]}', ${dimension})`;
  }

  public unixTimestampSql() {
    return 'unix_timestamp()';
  }

  protected limitOffsetClause(limit, offset) {
    const limitClause = limit != null ? ` LIMIT ${limit}` : '';
    const offsetClause = offset != null ? ` OFFSET ${offset}` : '';
    return `${limitClause}${offsetClause}`;
  }

  public castToString(sql: string): string {
    return `CAST(${sql} as STRING)`;
  }

  public countDistinctApprox(sql: string): string {
    return `approx_count_distinct(${sql})`;
  }
}
