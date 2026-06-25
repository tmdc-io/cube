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

  public sqlTemplates() {
    const templates = super.sqlTemplates();

    templates.quotes.identifiers = '`';
    templates.quotes.escape = '\\`';
    templates.types.string = 'STRING';
    templates.types.float = 'FLOAT';
    templates.types.binary = 'BINARY';

    templates.expressions.timestamp_literal = 'to_timestamp(\'{{ value }}\')';

    templates.functions.DATEDIFF = 'DATEDIFF({{ args[2] }}, {{ args[1] }})';
    templates.functions.DATEPART = 'EXTRACT({{ args_concat }})';

    templates.expressions.binary = '{% if op == \'||\' %}' +
      'CONCAT(CAST({{ left }} AS STRING), CAST({{ right }} AS STRING))' +
      '{% else %}({{ left }} {{ op }} {{ right }}){% endif %}';

    templates.functions.STRING_AGG = 'CONCAT_WS(COALESCE({{ args[1] }}, \'\'), COLLECT_LIST({% if distinct %}DISTINCT {% endif %}{{ args[0] }}))';

    templates.statements.time_series_select = 'SELECT to_timestamp(dates.f) date_from, to_timestamp(dates.t) date_to \n' +
      'FROM (\n' +
      '{% for time_item in seria  %}' +
      '    select \'{{ time_item[0] }}\' f, \'{{ time_item[1] }}\' t \n' +
      '{% if not loop.last %} UNION ALL\n{% endif %}' +
      '{% endfor %}' +
      ') AS dates';

    templates.statements.generated_time_series_select = 'SELECT d AS date_from,\n' +
      'd + interval {{ granularity }} - interval 1 millisecond AS date_to\n' +
      'FROM (\n' +
      'SELECT EXPLODE(SEQUENCE(to_timestamp({{ start }}), to_timestamp({{ end }}), INTERVAL {{ granularity }})) AS d\n' +
      ')';

    templates.statements.generated_time_series_with_cte_range_source = 'SELECT d AS date_from,\n' +
      'd + interval {{ granularity }} - interval 1 millisecond AS date_to\n' +
      'FROM {{ range_source }} LATERAL VIEW EXPLODE(\n' +
      'SEQUENCE(CAST({{ range_source }}.{{ min_name }} AS TIMESTAMP), CAST({{ range_source }}.{{ max_name }} AS TIMESTAMP), INTERVAL {{ granularity }})\n' +
      ') dates AS d';

    return templates;
  }
}
