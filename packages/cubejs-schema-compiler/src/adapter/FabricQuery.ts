import { MssqlQuery } from './MssqlQuery';

export class FabricQuery extends MssqlQuery {
  public orderHashToString(hash: { id?: string; desc?: boolean }): string | null {
    if (!hash || !hash.id) {
      return null;
    }

    const fieldAlias = this.getFieldAlias(hash.id);

    if (fieldAlias === null) {
      return null;
    }

    const direction = hash.desc ? 'DESC' : 'ASC';
    return `${fieldAlias} ${direction}`;
  }

  public sqlTemplates() {
    const templates = super.sqlTemplates();

    // Fabric Warehouse doesn't support recursive CTEs. Removing the MSSQL
    // generated-series templates lets the planner use the finite VALUES path.
    delete templates.statements.generated_time_series_select;
    delete templates.statements.generated_time_series_with_cte_range_source;
    delete templates.statements.generated_time_series_recursive;

    // MSSQL appends MAXRECURSION whenever CTEs exist. Fabric can use regular
    // CTEs, but not the recursive-query hint.
    templates.statements.select = '{% if ctes %} WITH \n' +
      '{{ ctes | join(\',\n\') }}\n' +
      '{% endif %}' +
      'SELECT {% if limit is not none and not order_by %}TOP {{ limit }} {% endif %}{% if distinct %}DISTINCT {% endif %}' +
      '{{ select_concat | map(attribute=\'aliased\') | join(\', \') }} {% if from %}\n' +
      'FROM (\n' +
      '{{ from | indent(2, true) }}\n' +
      ') AS {{ from_alias }}{% elif from_prepared %}\n' +
      'FROM {{ from_prepared }}' +
      '{% endif %}' +
      '{% if filter %}\nWHERE {{ filter }}{% endif %}' +
      '{% if group_by %}\nGROUP BY {{ group_by }}{% endif %}' +
      '{% if having %}\nHAVING {{ having }}{% endif %}' +
      '{% if order_by %}\nORDER BY {{ order_by | map(attribute=\'expr\') | join(\', \') }}\nOFFSET {% if offset is not none %}{{ offset }}{% else %}0{% endif %} ROWS' +
      '\nFETCH NEXT {% if limit is not none %}{{ limit }}{% else %}2147483647{% endif %} ROWS ONLY{% endif %}';

    return templates;
  }
}
