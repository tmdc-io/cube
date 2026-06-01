# syntax=docker/dockerfile:1.4
# transpiler-base: RapidFort base + multi-stage runtime + CVE scrub (0 critical target).
# Override base for local fallback: --build-arg NODE_BASE_IMAGE=node:22.22.0-bookworm-slim

ARG NODE_BASE_IMAGE=quay.io/rfcurated/node:22.22.3-jammy-rfcurated

# ============================================================================
# Stage 1: Builder (full toolchain — not in final image)
# ============================================================================
FROM ${NODE_BASE_IMAGE} AS builder

ARG IMAGE_VERSION=dev

ENV CUBEJS_DOCKER_IMAGE_VERSION=$IMAGE_VERSION
ENV CUBEJS_DOCKER_IMAGE_TAG=dev
ENV CI=0

USER root
RUN mkdir -p /var/lib/apt/lists/partial && \
    chmod -R 755 /var/lib/apt

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libssl3 \
        curl \
        cmake \
        python3 \
        python3.12 \
        libpython3.12-dev \
        gcc \
        g++ \
        make \
        openjdk-17-jdk-headless && \
    rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

# [DataOS fork] Rust toolchain pinned to 1.90.0 for native module compilation
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- --profile minimal --default-toolchain 1.90.0 -y

ENV CUBESTORE_SKIP_POST_INSTALL=true
ENV NODE_ENV=development

WORKDIR /cubejs

COPY package.json .
COPY lerna.json .
COPY yarn.lock .
COPY tsconfig.base.json .
COPY rollup.config.js .
COPY packages/cubejs-linter packages/cubejs-linter

COPY rust/cubesql/package.json rust/cubesql/package.json
COPY rust/cubestore/package.json rust/cubestore/package.json
COPY rust/cubestore/bin rust/cubestore/bin
COPY packages/cubejs-backend-shared/package.json packages/cubejs-backend-shared/package.json
COPY packages/cubejs-base-driver/package.json packages/cubejs-base-driver/package.json
COPY packages/cubejs-backend-native/package.json packages/cubejs-backend-native/package.json
COPY packages/cubejs-testing-shared/package.json packages/cubejs-testing-shared/package.json
COPY packages/cubejs-backend-cloud/package.json packages/cubejs-backend-cloud/package.json
COPY packages/cubejs-api-gateway/package.json packages/cubejs-api-gateway/package.json
COPY packages/cubejs-athena-driver/package.json packages/cubejs-athena-driver/package.json
COPY packages/cubejs-bigquery-driver/package.json packages/cubejs-bigquery-driver/package.json
COPY packages/cubejs-cli/package.json packages/cubejs-cli/package.json
COPY packages/cubejs-clickhouse-driver/package.json packages/cubejs-clickhouse-driver/package.json
COPY packages/cubejs-crate-driver/package.json packages/cubejs-crate-driver/package.json
COPY packages/cubejs-dremio-driver/package.json packages/cubejs-dremio-driver/package.json
COPY packages/cubejs-druid-driver/package.json packages/cubejs-druid-driver/package.json
COPY packages/cubejs-duckdb-driver/package.json packages/cubejs-duckdb-driver/package.json
COPY packages/cubejs-elasticsearch-driver/package.json packages/cubejs-elasticsearch-driver/package.json
COPY packages/cubejs-firebolt-driver/package.json packages/cubejs-firebolt-driver/package.json
COPY packages/cubejs-hive-driver/package.json packages/cubejs-hive-driver/package.json
COPY packages/cubejs-mongobi-driver/package.json packages/cubejs-mongobi-driver/package.json
COPY packages/cubejs-mssql-driver/package.json packages/cubejs-mssql-driver/package.json
COPY packages/cubejs-mysql-driver/package.json packages/cubejs-mysql-driver/package.json
COPY packages/cubejs-cubestore-driver/package.json packages/cubejs-cubestore-driver/package.json
COPY packages/cubejs-oracle-driver/package.json packages/cubejs-oracle-driver/package.json
COPY packages/cubejs-redshift-driver/package.json packages/cubejs-redshift-driver/package.json
COPY packages/cubejs-postgres-driver/package.json packages/cubejs-postgres-driver/package.json
COPY packages/cubejs-questdb-driver/package.json packages/cubejs-questdb-driver/package.json
COPY packages/cubejs-materialize-driver/package.json packages/cubejs-materialize-driver/package.json
COPY packages/cubejs-prestodb-driver/package.json packages/cubejs-prestodb-driver/package.json
COPY packages/cubejs-trino-driver/package.json packages/cubejs-trino-driver/package.json
COPY packages/cubejs-pinot-driver/package.json packages/cubejs-pinot-driver/package.json
COPY packages/cubejs-query-orchestrator/package.json packages/cubejs-query-orchestrator/package.json
COPY packages/cubejs-schema-compiler/package.json packages/cubejs-schema-compiler/package.json
COPY packages/cubejs-server/package.json packages/cubejs-server/package.json
COPY packages/cubejs-server-core/package.json packages/cubejs-server-core/package.json
COPY packages/cubejs-snowflake-driver/package.json packages/cubejs-snowflake-driver/package.json
COPY packages/cubejs-sqlite-driver/package.json packages/cubejs-sqlite-driver/package.json
COPY packages/cubejs-ksql-driver/package.json packages/cubejs-ksql-driver/package.json
COPY packages/cubejs-dbt-schema-extension/package.json packages/cubejs-dbt-schema-extension/package.json
COPY packages/cubejs-jdbc-driver/package.json packages/cubejs-jdbc-driver/package.json
COPY packages/cubejs-vertica-driver/package.json packages/cubejs-vertica-driver/package.json
# [DataOS fork] Added Spark driver
COPY packages/cubejs-spark-driver/package.json packages/cubejs-spark-driver/package.json
COPY packages/cubejs-templates/package.json packages/cubejs-templates/package.json
COPY packages/cubejs-client-core/package.json packages/cubejs-client-core/package.json
COPY packages/cubejs-client-react/package.json packages/cubejs-client-react/package.json
COPY packages/cubejs-client-vue3/package.json packages/cubejs-client-vue3/package.json
COPY packages/cubejs-client-ngx/package.json packages/cubejs-client-ngx/package.json
COPY packages/cubejs-client-ws-transport/package.json packages/cubejs-client-ws-transport/package.json
COPY packages/cubejs-playground/package.json packages/cubejs-playground/package.json

RUN yarn policies set-version v1.22.22 && \
    yarn config set network-timeout 120000 -g

RUN yarn install

# ============================================================================
# Stage 2: Production dependencies
# ============================================================================
FROM builder AS prod_base_dependencies
COPY packages/cubejs-databricks-jdbc-driver/package.json packages/cubejs-databricks-jdbc-driver/package.json
RUN mkdir packages/cubejs-databricks-jdbc-driver/bin
RUN echo '#!/usr/bin/env node' > packages/cubejs-databricks-jdbc-driver/bin/post-install
RUN yarn install --prod

FROM prod_base_dependencies AS prod_dependencies
COPY packages/cubejs-databricks-jdbc-driver/bin packages/cubejs-databricks-jdbc-driver/bin
RUN yarn install --prod --ignore-scripts

RUN HSQLDB_JAR="/cubejs/node_modules/@cubejs-backend/jdbc/drivers-10.17/hsqldb.jar" && \
    if [ -f "$HSQLDB_JAR" ]; then \
      curl -fsSL -o "$HSQLDB_JAR" \
        "https://repo1.maven.org/maven2/org/hsqldb/hsqldb/2.7.4/hsqldb-2.7.4.jar"; \
    fi

# ============================================================================
# Stage 3: Compile
# ============================================================================
FROM builder AS build

RUN yarn install

COPY rust/cubestore/ rust/cubestore/
COPY rust/cubesql/ rust/cubesql/
COPY rust/cube/ rust/cube/
COPY packages/cubejs-backend-shared/ packages/cubejs-backend-shared/
COPY packages/cubejs-base-driver/ packages/cubejs-base-driver/
COPY packages/cubejs-backend-native/ packages/cubejs-backend-native/
COPY packages/cubejs-testing-shared/ packages/cubejs-testing-shared/
COPY packages/cubejs-backend-cloud/ packages/cubejs-backend-cloud/
COPY packages/cubejs-api-gateway/ packages/cubejs-api-gateway/
COPY packages/cubejs-athena-driver/ packages/cubejs-athena-driver/
COPY packages/cubejs-bigquery-driver/ packages/cubejs-bigquery-driver/
COPY packages/cubejs-cli/ packages/cubejs-cli/
COPY packages/cubejs-clickhouse-driver/ packages/cubejs-clickhouse-driver/
COPY packages/cubejs-crate-driver/ packages/cubejs-crate-driver/
COPY packages/cubejs-dremio-driver/ packages/cubejs-dremio-driver/
COPY packages/cubejs-druid-driver/ packages/cubejs-druid-driver/
COPY packages/cubejs-duckdb-driver/ packages/cubejs-duckdb-driver/
COPY packages/cubejs-elasticsearch-driver/ packages/cubejs-elasticsearch-driver/
COPY packages/cubejs-firebolt-driver/ packages/cubejs-firebolt-driver/
COPY packages/cubejs-hive-driver/ packages/cubejs-hive-driver/
COPY packages/cubejs-mongobi-driver/ packages/cubejs-mongobi-driver/
COPY packages/cubejs-mssql-driver/ packages/cubejs-mssql-driver/
COPY packages/cubejs-mysql-driver/ packages/cubejs-mysql-driver/
COPY packages/cubejs-cubestore-driver/ packages/cubejs-cubestore-driver/
COPY packages/cubejs-oracle-driver/ packages/cubejs-oracle-driver/
COPY packages/cubejs-redshift-driver/ packages/cubejs-redshift-driver/
COPY packages/cubejs-postgres-driver/ packages/cubejs-postgres-driver/
COPY packages/cubejs-questdb-driver/ packages/cubejs-questdb-driver/
COPY packages/cubejs-materialize-driver/ packages/cubejs-materialize-driver/
COPY packages/cubejs-prestodb-driver/ packages/cubejs-prestodb-driver/
COPY packages/cubejs-trino-driver/ packages/cubejs-trino-driver/
COPY packages/cubejs-pinot-driver/ packages/cubejs-pinot-driver/
COPY packages/cubejs-query-orchestrator/ packages/cubejs-query-orchestrator/
COPY packages/cubejs-schema-compiler/ packages/cubejs-schema-compiler/
COPY packages/cubejs-server/ packages/cubejs-server/
COPY packages/cubejs-server-core/ packages/cubejs-server-core/
COPY packages/cubejs-snowflake-driver/ packages/cubejs-snowflake-driver/
COPY packages/cubejs-sqlite-driver/ packages/cubejs-sqlite-driver/
COPY packages/cubejs-ksql-driver/ packages/cubejs-ksql-driver/
COPY packages/cubejs-dbt-schema-extension/ packages/cubejs-dbt-schema-extension/
COPY packages/cubejs-jdbc-driver/ packages/cubejs-jdbc-driver/
COPY packages/cubejs-databricks-jdbc-driver/ packages/cubejs-databricks-jdbc-driver/
COPY packages/cubejs-vertica-driver/ packages/cubejs-vertica-driver/
COPY packages/cubejs-spark-driver/ packages/cubejs-spark-driver/
COPY packages/cubejs-templates/ packages/cubejs-templates/
COPY packages/cubejs-client-core/ packages/cubejs-client-core/
COPY packages/cubejs-client-react/ packages/cubejs-client-react/
COPY packages/cubejs-client-vue3/ packages/cubejs-client-vue3/
COPY packages/cubejs-client-ngx/ packages/cubejs-client-ngx/
COPY packages/cubejs-client-ws-transport/ packages/cubejs-client-ws-transport/
COPY packages/cubejs-playground/ packages/cubejs-playground/

# GHSA-3jch-9qgp-4844: bump flatbuffers@2.1.2 before compile
RUN cd /cubejs/rust/cube/cubeshared && cargo update flatbuffers && \
    cd /cubejs/rust/cube/cubestore-ws-transport && cargo update flatbuffers && \
    cd /cubejs/rust/cubesql && cargo update flatbuffers@2.1.2 && \
    cd /cubejs/packages/cubejs-backend-native && cargo update flatbuffers@2.1.2

RUN yarn build && yarn lerna run build

RUN cd packages/cubejs-backend-native && npm run native:build-release-python

RUN find . -name 'node_modules' -type d -prune -exec rm -rf '{}' +

# ============================================================================
# Stage 4: CVE scrub (examples, charts-gen, stale lockfiles)
# ============================================================================
FROM build AS scrub
RUN rm -rf packages/cubejs-server/examples packages/cubejs-playground/charts-gen && \
    find packages/cubejs-server -type d -name examples -prune -exec rm -rf {} + 2>/dev/null || true && \
    find packages/cubejs-playground -name yarn.lock -not -path '*/node_modules/*' -delete 2>/dev/null || true && \
    for lock in packages/cubejs-backend-native/Cargo.lock rust/cubesql/Cargo.lock; do \
      if [ -f "$lock" ] && grep -q 'name = "flatbuffers"' "$lock" && grep -q 'version = "2.1.2"' "$lock"; then \
        rm -f "$lock"; \
      fi; \
    done

# ============================================================================
# Stage 5: Runtime — RapidFort base only, no gcc/rust/jdk (smaller image)
# ============================================================================
FROM ${NODE_BASE_IMAGE} AS final

ENV DEBIAN_FRONTEND=noninteractive

USER root
RUN mkdir -p /var/lib/apt/lists/partial && \
    chmod -R 755 /var/lib/apt

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        python3.12 \
        libpython3.12 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /cubejs

COPY --from=scrub /cubejs .
COPY --from=prod_dependencies /cubejs .

COPY packages/cubejs-docker/bin/cubejs-dev /usr/local/bin/cubejs

ENV NODE_PATH=/cube/conf/node_modules:/cube/node_modules
ENV PYTHONUNBUFFERED=1
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

RUN ln -s /cubejs/packages/cubejs-docker /cube && \
    ln -s /cubejs/rust/cubestore/bin/cubestore-dev /usr/local/bin/cubestore-dev

WORKDIR /cube/conf

EXPOSE 4000

CMD ["cubejs", "server"]
