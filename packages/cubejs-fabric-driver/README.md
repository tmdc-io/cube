# Cube.js Microsoft Fabric Database Driver

Driver for the [Microsoft Fabric Data Warehouse](https://learn.microsoft.com/en-us/fabric/data-warehouse/).

Fabric warehouses speak the TDS protocol, so this driver builds on the MSSQL
driver but accounts for Fabric's reduced T-SQL surface area:

- Azure AD Service Principal authentication (Fabric does not support SQL auth)
- Temporal types capped at 6 digits of precision (`DATETIME2(6)`)
- No `DATETIMEOFFSET` data type; timestamp params are cast to `DATETIME2(6)`
- No unicode types (`NVARCHAR`/`NCHAR`); explicit lengths on `VARCHAR`/`VARBINARY`
- No implicit int-to-datetime conversion; date truncation anchors on an
  explicitly cast epoch instead of `0`
- No `FORMAT()`; second-granularity truncation uses `DATEADD`/`DATEDIFF`

## Configuration

```bash
CUBEJS_DB_TYPE=fabric
CUBEJS_DB_HOST=<workspace>.datawarehouse.fabric.microsoft.com
CUBEJS_DB_NAME=<warehouse name>
CUBEJS_DB_USER=<service principal client id>
CUBEJS_DB_PASS=<service principal client secret>
CUBEJS_DB_DOMAIN=<azure ad tenant id>
```

When `CUBEJS_DB_DOMAIN` (tenant id) is set, the driver authenticates as an
Azure Service Principal. Without it, the connection configuration is passed
through unchanged, which is only useful for testing against plain SQL Server.

## Case sensitivity

Unlike SQL Server, Fabric Warehouse is case-sensitive:

- **Identifiers**: `dbo.Orders` and `dbo.orders` are different tables. Table
  and column names in cube definitions (`sql_table`, `sql`) must match the
  physical casing exactly - a mismatch that SQL Server forgives will fail on
  Fabric.
- **String data**: the default warehouse collation
  (`Latin1_General_100_BIN2_UTF8`) makes `equals`/`notEquals` filters
  case-sensitive (`'Apple' != 'apple'`). `contains`, `startsWith`, and
  `endsWith` filters lowercase both sides and are unaffected. A
  case-insensitive collation can only be chosen when the warehouse is
  created.

## License

Cube.js Microsoft Fabric Database Driver is [Apache 2.0 licensed](./LICENSE).
