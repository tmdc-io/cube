# Pre-Aggregation Column Naming Fix for the sql4sql Path

## Summary

Consider a `users` cube with a pre-aggregation defined on it:

```yaml
cubes:
  - name: users
    sql_table: public.users

    measures:
      - name: total_users
        type: count
        sql: user_id
      - name: active_users
        type: count
        sql: "email || user_id"
        filters:
          - sql: "{CUBE}.status = 'active'"
      - name: paid_users
        type: count
        sql: "email || user_id"

    dimensions:
      - name: user_id
        sql: user_id
        type: number
        primary_key: true
      - name: plan_type
        sql: plan_type
        type: string
      - name: industry
        sql: industry
        type: string
      - name: signup_date
        sql: signup_date
        type: time

    pre_aggregations:
      - name: signups_01
        type: rollup
        measures: [total_users, active_users, paid_users]
        dimensions: [plan_type, industry]
        time_dimension: signup_date
        granularity: month
```

When a query selects those measures and dimensions grouped by month, Cube matches
the `signups_01` pre-aggregation and rewrites the query to read from the
materialized rollup table instead of `public.users`. That table is
`dev_pre_aggregations.users_signups_01`, and its physical columns follow Cube's
`<cube>__<member>` convention:

| member                  | physical column             |
| ----------------------- | --------------------------- |
| `users.plan_type`       | `users__plan_type`          |
| `users.industry`        | `users__industry`           |
| `users.signup_date` (month) | `users__signup_date_month` |
| `users.total_users`     | `users__total_users`        |
| `users.active_users`    | `users__active_users`       |
| `users.paid_users`      | `users__paid_users`         |

On the SQL-to-SQL (`format=sql`) path, the rewrite used the **wrong source column
names**: it referenced bare member / output names instead of those physical
`<cube>__<member>` columns. Because those identifiers do not exist in
`dev_pre_aggregations.users_signups_01`, the generated SQL did not correspond to
what the rollup physically stores.

For the query above, the rewritten SQL looked like this (**incorrect** — none of
the selected source columns exist in the rollup table):

```sql
SELECT
  "plan_type"            "plan_type",
  "industry"            "industry",
  "signup_month"        "signup_month",
  sum("total_users")    "total_users",
  sum("active_users")   "active_users",
  sum("paid_users")     "paid_users"
FROM dev_pre_aggregations.users_signups_01 AS "users__signups_01"
GROUP BY 1, 2, 3
```

The REST path was unaffected — it builds pre-aggregation source references
through a different code route — so the two paths diverged for the same logical
query. The corrected output is shown in the [Result](#result) section below.

## Root Cause

The sql4sql path supplies a per-query `memberToAlias` map. This map is an
**output alias override**: it tells the generator to project the final result
columns under the identifiers expected by the consuming SQL query.

`aliasName()` in
`cube/packages/cubejs-schema-compiler/src/adapter/BaseQuery.js`
consulted `memberToAlias` for **every** alias lookup. That is correct for the
final output projection, but it is wrong when the pre-aggregation code asks for
the **physical source column** of the rollup table.

The physical pre-aggregation column name is intrinsic to the rollup table and has
the form `<cube>__<member>` (and `<cube>__<member>_<granularity>` for time
dimensions). It must not be rewritten by a per-query output-alias map.

Because the same `aliasName()` was used for both purposes, the `memberToAlias`
override leaked into the pre-aggregation source references, producing the bare
names instead of the physical `<cube>__<member>` columns.

## The Fix

Separate the two concepts:

- **Output alias** — may be overridden per query via `memberToAlias`.
- **Physical pre-aggregation source column** — always the intrinsic
  `<cube>__<member>` name, never overridden.

This is done by adding an explicit opt-out (`ignoreMemberToAlias`) to the alias
machinery, and by having the pre-aggregation source-reference call sites request
the physical name.

### Files Changed

**`cube/packages/cubejs-schema-compiler/src/adapter/BaseQuery.js`**

`aliasName(name, isPreAggregationName = false, ignoreMemberToAlias = false)` now
takes a third argument. The `memberToAlias` short-circuit only fires when
`ignoreMemberToAlias` is `false`. Callers that need the intrinsic
`<cube>__<member>` name pass `ignoreMemberToAlias = true` so the override applies
only to the final output alias. This is the core change; the rest thread this
flag through to the pre-aggregation call sites.

**`cube/packages/cubejs-schema-compiler/src/adapter/BaseDimension.ts`**

Adds `unescapedAliasNamePhysical()`, which resolves the dimension's physical
pre-aggregation column via `aliasName(..., false, true)`. The existing
`unescapedAliasName()` is left untouched so the output path continues to honor
`memberToAlias`.

**`cube/packages/cubejs-schema-compiler/src/adapter/BaseTimeDimension.ts`**

Adds `unescapedAliasNamePhysical(granularity?)`, returning
`<cube>__<member>_<granularity>` (e.g. `users__signup_date_month`) while ignoring
any `memberToAlias` override. It is intentionally a separate method rather than a
new parameter on `unescapedAliasName()`, so the method signature stays compatible
with the `BaseDimension` method it overrides.

**`cube/packages/cubejs-schema-compiler/src/adapter/BaseMeasure.ts`**

`aliasName(ignoreMemberToAlias = false)` and
`unescapedAliasName(ignoreMemberToAlias = false)` thread the flag through, so a
measure's physical pre-aggregation source column can be requested independently
of its output alias.

**`cube/packages/cubejs-schema-compiler/src/adapter/PreAggregations.ts`**

The call sites that build the rollup's **source** references now request physical
names:

- measures: `measure.aliasName(true)` (including the `sum(...)` fallback)
- dimensions: `dimension.unescapedAliasNamePhysical()`
- time dimensions: `timeDimension.unescapedAliasNamePhysical(rollupGranularity)`

The final **output** aliases continue to flow through `memberToAlias`, unchanged.

## Result

After the fix, pre-aggregation **source** columns are always the intrinsic
`<cube>__<member>` names that match the physical rollup table, while the consuming
query's **output** aliases still honor `memberToAlias`. The sql4sql path now
produces the same pre-aggregation references as the REST path.

For the query matching the `signups_01` rollup, the rewritten SQL correctly reads:

```sql
SELECT
  "users__plan_type"            "plan_type",
  "users__industry"             "industry",
  "users__signup_date_month"    "signup_month",
  sum("users__total_users")     "total_users",
  sum("users__active_users")    "active_users",
  sum("users__paid_users")      "paid_users"
FROM dev_pre_aggregations.users_signups_01 AS "users__signups_01"
GROUP BY 1, 2, 3
```

Running the rollup-matched query and the equivalent non-pre-aggregated query
against the same data produced identical aggregates for the additive measures
(e.g. `total_users` and `active_users`), confirming the rewrite is both
structurally and semantically correct.
