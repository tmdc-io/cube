# DataOS Transpiler — Cube Fork Documentation

This document describes all customizations made to this Cube fork for the
DataOS transpiler, how to build and release the Docker image, and how to
continue development. It is intended as a complete knowledge-transfer
reference for anyone inheriting this project.

## 1. Overview

This repository (`tmdc-io/cube`, **origin**) is a **fork of
[cube-js/cube](https://github.com/cube-js/cube)** (**upstream**). Active
development happens on the **`feat/spark`** branch.

Upstream Cube does not natively support Apache Spark as a data source. This
fork adds Spark (and related) support so that Cube can serve as a **SQL
transpiler for DataOS Vulcan**. The changes here are not for running Cube
as a standalone analytics platform — they exist to power Vulcan's transpiler
layer.

**What this fork adds on top of upstream Cube:**

- A new **Apache Spark driver** package (with formal registration as a database type).
- A **renamed SQL join field** (`__joinField` instead of `__cubeJoinField`).
- A **compatibility guard** in the server-core CompilerApi.
- Docker packaging under the image **`tmdcio/transpiler-base`** (built with
  `packages/cubejs-docker/dev.Dockerfile`).

All modifications to upstream files are tagged with `[DataOS fork]` comments
for easy identification during merge conflict resolution. Search with
`grep -r "[DataOS fork]"` to find every custom change.

The upstream Cube version at the branch point is **v1.5.10** (tag `31c86ae41`).

### Git remotes

| Remote | Repository | Purpose |
|--------|-----------|---------|
| `origin` | `git@github.com:tmdc-io/cube.git` | This fork (push/pull) |
| `upstream` | `https://github.com/cube-js/cube.git` | Upstream Cube (pull only, for syncing) |

---

## 2. What changed vs upstream

### 2.1 Spark Driver (`packages/cubejs-spark-driver/`)

A new Cube driver package for Apache Spark, added because upstream Cube does
not provide Spark support. This driver enables Vulcan to use Cube as a SQL
transpiler against Spark data sources. It is structured like the existing Trino
driver: it reuses the Presto client wire protocol but swaps in Spark-specific
SQL dialect.

**Key files:**

- `SparkDriver.ts` — extends `PrestoDriver`. Uses double-quoted string
  literals (for Python `fetchdf_with_params` compatibility). Introspection via
  `SHOW SCHEMAS`, `SHOW TABLES IN <schema>`, `DESCRIBE TABLE <schema>.<table>`.
- `SparkQuery.ts` — extends `BaseQuery`. Backtick identifiers, `date_trunc`
  for time grouping, `from_utc_timestamp` for timezone conversion, `STRING`
  type instead of `VARCHAR`, `approx_count_distinct`, Spark `INTERVAL` syntax.
  Includes a `sqlTemplates()` override that sets `quotes.identifiers` to
  backticks, ensuring template-generated SQL also uses the correct quoting
  (without this, Cube's template engine defaults to double-quotes).

**Registration:**

- `packages/cubejs-server-core/src/core/DriverDependencies.ts` — maps `'spark'`
  to `'@cubejs-backend/spark-driver'`.
- `packages/cubejs-server-core/src/core/types.ts` — adds `'spark'` to the
  `DatabaseType` union type.

### 2.2 CompilerApi guard (`packages/cubejs-server-core/src/core/CompilerApi.ts`)

The upstream code calls `sqlGenerator.collectAllMemberNames()` unconditionally.
Some custom driver code paths produce a generator that lacks this method. The
fork adds a runtime check:

```js
const memberNames = typeof (sqlGenerator as any).collectAllMemberNames === 'function'
  ? (sqlGenerator as any).collectAllMemberNames()
  : [];
```

This prevents a crash when using custom drivers that don't implement the full
interface.

### 2.3 `__joinField` rename (backward incompatible)

The virtual column used for cube-to-cube joins in SQL was renamed from
`__cubeJoinField` to `__joinField`. This is a **breaking change** — any
existing SQL queries or BI tool configurations that reference the old name
must be updated.

**Scope of the rename** (all changes carry `[DataOS fork]` comments in code):

- **9 Rust source files** in `rust/cubesql/` — field registration
  (`analysis.rs`), synthetic-field check (`ctx.rs`), join validation and
  error messages (`converter.rs`), join detection (`members.rs`), filter
  matching (`filters.rs`), planner split rule (`old_split.rs`), column
  metadata (`ext.rs`), alias truncation (`wrapper.rs`).
- **4 Rust test/benchmark files** — `compile/mod.rs`,
  `compile/test/test_cube_join.rs`, `compile/test/test_wrapper.rs`,
  `benches/benchmarks.rs` (~81 SQL string edits).
- **~20 auto-generated Rust snapshot files** (`.snap`) under
  `rust/cubesql/cubesql/src/compile/`.
- `packages/cubejs-schema-compiler/src/adapter/BaseQuery.js` — JS-side
  synthetic field allowlist (~line 3947).
- `packages/cubejs-testing/test/smoke-cubesql.test.ts` — integration test SQL.
- 2 JS snapshot files in `packages/cubejs-testing/test/__snapshots__/`.
- 2 documentation MDX files in `docs/`.

Comments and function names (e.g. `is_join_on_cube_join_field`) were
intentionally left unchanged; only string literals that affect runtime
behavior were updated.

### 2.4 Docker and build changes

- `.dockerignore`: whitelisted the full Rust crate directories (`cubesql`,
  `cubenativeutils`, `cubeorchestrator`, `cubesqlplanner`, `cubeshared`) so
  that `COPY` instructions in the Dockerfile can include them in the build
  context.
- `packages/cubejs-docker/dev.Dockerfile` **(the Dockerfile used for all
  transpiler builds)**: added `COPY` lines for `cubejs-spark-driver` and all
  Rust crate transitive dependencies; updated the Rust toolchain from
  `nightly-2022-03-08` to `1.90.0` (matching the repo's
  `rust-toolchain.toml`); added `npm run native:build-release-python` which
  compiles the `cubejs-native` Rust crate from source **with the Python
  feature flag**, so that changes to CubeSQL (like the `__joinField` rename)
  are reflected in the binary instead of using the pre-built upstream artifact.
- `packages/cubejs-docker/lite.Dockerfile`: an alternative lighter build
  variant — does **not** include the Spark driver or the native Rust rebuild,
  so it is not used for transpiler builds.
- `packages/cubejs-docker/release.yaml`: tracks custom Docker image build
  metadata and history.

---

## 3. Building the Docker image

The custom image is **`tmdcio/transpiler-base`**. It is built using
**`packages/cubejs-docker/dev.Dockerfile`** with the build context set to the
**repo root** (not the `cubejs-docker` directory). All commands below run from
`packages/cubejs-docker`.

> **Which Dockerfile?** This fork uses **`dev.Dockerfile`** for all builds.
> The repo also contains `latest.Dockerfile` (upstream's slim production
> image) and `lite.Dockerfile` (an alternate variant) but **neither includes
> the Spark driver or the native Rust rebuild** — they are not used for
> transpiler builds.

### How it works

`dev.Dockerfile` installs the Rust toolchain and copies the full Rust crate
source trees (`cubesql`, `cubenativeutils`, `cubeorchestrator`, `cubesqlplanner`,
`cubeshared`). During `yarn install`, the `cubejs-backend-native` package's
`postinstall` hook downloads a **pre-built** `index.node` from upstream GitHub
releases. A subsequent `npm run native:build-release-python` step then
**recompiles** the native module from your local Rust source with the `python`
feature flag enabled, producing a fresh `index.node` at the package root that
takes precedence at runtime. This is what makes source-level changes (like the
`__joinField` rename) appear in the final image.

The Rust release build adds roughly 15–30 minutes to the Docker build when
running natively (arm64 on Apple Silicon). Cross-platform emulation (building
amd64 on an arm64 host) will be significantly slower.

### Prerequisites

- Docker Desktop (with buildx support).
- Logged in to Docker Hub: `docker login`.

### Important: always use `--no-cache`

The `cubejs-backend-native` package has a `postinstall` hook that downloads a
pre-built `index.node` from upstream GitHub releases. Docker's layer cache will
preserve this downloaded binary across rebuilds, causing the subsequent
`native:build-release-python` step to silently overwrite a stale cached copy
— or worse, the cached layer may skip the build entirely. **Always pass
`--no-cache`** to ensure the Rust native module is compiled fresh from your
local source every time.

### Option 1: Separate per-platform builds (recommended)

This avoids buildx cache issues and gives more control. Replace `TAG` with
your version (e.g. `0.228.1.17`).

```bash
cd packages/cubejs-docker

# Step 1: Build arm64 (native on Apple Silicon — fast)
docker build --no-cache --platform linux/arm64 \
  -t tmdcio/transpiler-base:TAG-arm64 \
  -f dev.Dockerfile ../../

# Step 2: Build amd64 (emulated on Apple Silicon — slower)
docker build --no-cache --platform linux/amd64 \
  -t tmdcio/transpiler-base:TAG-amd64 \
  -f dev.Dockerfile ../../

# Step 3: Push both
docker push tmdcio/transpiler-base:TAG-arm64
docker push tmdcio/transpiler-base:TAG-amd64

# Step 4: Create multi-arch manifest
docker buildx imagetools create \
  -t tmdcio/transpiler-base:TAG \
  tmdcio/transpiler-base:TAG-arm64 \
  tmdcio/transpiler-base:TAG-amd64
```

### Option 2: Single buildx command

```bash
docker buildx build --no-cache \
  --platform linux/amd64,linux/arm64 \
  -t tmdcio/transpiler-base:TAG \
  -f dev.Dockerfile --push ../../
```

### After building

Update `packages/cubejs-docker/release.yaml` with the new tag, date, platforms,
and a summary of changes included in the build.

### Tag convention

Tags follow the pattern `0.228.1.N` where `N` is incremented for each custom
build. The `0.228.1` prefix corresponds to the upstream Cube version at the
time of the fork.

---

## 4. Local development setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 22.x | via nvm recommended |
| Yarn | 1.22.x | `yarn policies set-version v1.22.22` |
| Rust | 1.90.0 | via [rustup](https://rustup.rs); repo's `rust-toolchain.toml` auto-selects |
| Python | 3.11 | for node-gyp; 3.12+ breaks `distutils` in old gyp |
| JDK | 17+ | only for the `java` npm optional dep |

### Install and build

```bash
# Install JS dependencies
export PYTHON="/opt/homebrew/opt/python@3.11/bin/python3.11"
export npm_config_python="$PYTHON"
yarn install

# Compile TypeScript across all packages
yarn tsc

# Build the Rust native module (CubeSQL)
cd packages/cubejs-backend-native
yarn run native:build-debug

# Run CubeSQL Rust tests
cd ../../rust/cubesql
cargo test -p cubesql --lib
```

### Python 3.11 note

The `cpu-features` and `nice-napi` optional packages (pulled in via `duckdb`)
use an old `node-gyp` that imports `distutils`, which was removed in Python
3.12. Set `PYTHON` and `npm_config_python` to a Python 3.11 binary before
`yarn install` to avoid build failures for those optional deps. Yarn's own
`python` config (`yarn config set python ...`) does not reliably propagate
to all node-gyp invocations.

---

## 5. Key files reference

| File | What it does |
|------|-------------|
| **Spark driver (new package)** | |
| `packages/cubejs-spark-driver/src/SparkDriver.ts` | Spark driver: connection, introspection, query params |
| `packages/cubejs-spark-driver/src/SparkQuery.ts` | Spark SQL dialect: identifiers, timestamps, intervals, `sqlTemplates()` |
| **Spark registration (modified upstream)** | |
| `packages/cubejs-server-core/src/core/DriverDependencies.ts` | `'spark'` entry in driver map |
| `packages/cubejs-server-core/src/core/types.ts` | `'spark'` in `DatabaseType` union |
| **CompilerApi guard (modified upstream)** | |
| `packages/cubejs-server-core/src/core/CompilerApi.ts` | `collectAllMemberNames` guard for custom driver compatibility |
| **`__joinField` rename (modified upstream)** | |
| `packages/cubejs-schema-compiler/src/adapter/BaseQuery.js` | `__joinfield` synthetic field allowlist (~line 3947) |
| `rust/cubesql/cubesql/src/compile/rewrite/analysis.rs` | Virtual join field registration |
| `rust/cubesql/cubesql/src/transport/ctx.rs` | `is_synthetic_field_name` check |
| `rust/cubesql/cubesql/src/compile/rewrite/converter.rs` | Join validation + error messages |
| `rust/cubesql/cubesql/src/compile/rewrite/rules/members.rs` | Join detection logic |
| `rust/cubesql/cubesql/src/compile/rewrite/rules/filters.rs` | Filter join-field matching |
| `rust/cubesql/cubesql/src/compile/rewrite/rules/old_split.rs` | Planner split rule |
| `rust/cubesql/cubesql/src/transport/ext.rs` | CubeColumn metadata |
| `rust/cubesql/cubesql/src/compile/engine/df/wrapper.rs` | Alias truncation allowlist |
| `rust/cubesql/cubesql/src/compile/mod.rs` | Test SQL strings |
| `rust/cubesql/cubesql/src/compile/test/test_cube_join.rs` | Join test SQL strings |
| `rust/cubesql/cubesql/src/compile/test/test_wrapper.rs` | Wrapper test SQL strings |
| `rust/cubesql/cubesql/benches/benchmarks.rs` | Benchmark SQL strings |
| `packages/cubejs-testing/test/smoke-cubesql.test.ts` | Integration test SQL strings |
| `docs/pages/product/apis-integrations/sql-api/joins.mdx` | SQL API joins documentation |
| `docs/pages/product/data-modeling/concepts/working-with-joins.mdx` | Data model joins documentation |
| **Docker and build (modified/new)** | |
| `.dockerignore` | Whitelisted Rust crate directories |
| `packages/cubejs-docker/dev.Dockerfile` | **THE build Dockerfile**: Rust toolchain, Spark driver, native build |
| `packages/cubejs-docker/lite.Dockerfile` | Alternative lighter variant; does not include Spark or native rebuild |
| `packages/cubejs-docker/release.yaml` | Build metadata and history (new file) |
| **Guides (new)** | |
| `Transpiler.md` | This document |

---

## 6. Syncing with upstream

This repo (`origin`) is the fork at `tmdc-io/cube`. The upstream Cube repo
is `cube-js/cube`. To pull in new upstream changes:

```bash
# Add upstream remote (one-time, if not already configured)
git remote add upstream https://github.com/cube-js/cube.git

# Fetch and merge
git fetch upstream
git merge upstream/master
```

You can verify remotes with `git remote -v` — you should see `origin` pointing
to `tmdc-io/cube` and `upstream` pointing to `cube-js/cube`.

### Finding our changes

Every modification to an upstream file is tagged with a `[DataOS fork]` comment
explaining what was changed and why. To find them all:

```bash
grep -rn "\[DataOS fork\]" --include='*.ts' --include='*.js' --include='*.rs' --include='*.mdx' --include='Dockerfile' .
grep -n "\[DataOS fork\]" .dockerignore
```

### Likely conflict areas

- **`CompilerApi.ts`** — the `collectAllMemberNames` guard may conflict if
  upstream changes the surrounding `getSqlFn` closure. Accept ours and verify
  the guard is intact.
- **`DriverDependencies.ts` / `types.ts`** — the `spark` entry may conflict
  if upstream adds new drivers in the same region. Just ensure `spark` is
  still present after merging.
- **`rust/cubesql/cubesql/src/compile/rewrite/` files** — if upstream adds or
  modifies join-related logic, conflicts with the `__joinField` rename are
  likely. Resolve by ensuring all new `__cubeJoinField` string literals from
  upstream are also renamed to `__joinField`.
- **`BaseQuery.js`** — if upstream changes the synthetic field check, ensure
  `__joinfield` (lowercase) is in the allowlist.
- **`.dockerignore`** — if upstream changes the ignore patterns, ensure the
  Rust crate directories remain whitelisted.
- **`dev.Dockerfile`** — upstream may update the base Node image or build
  steps; merge carefully and re-add the `cubejs-spark-driver` COPY lines,
  Rust crate COPY lines, Rust toolchain pin, and the
  `native:build-release-python` step if lost.
- **Rust `.snap` files** — auto-generated; accept upstream then re-run
  `cargo insta test` to regenerate with `__joinField`.
- **JS `.snap` files** — auto-generated; accept upstream then re-run Jest
  to regenerate.
- **`yarn.lock`** — auto-generated; accept upstream then re-run `yarn install`.

### After resolving conflicts

```bash
# Rust tests (verifies __joinField rename + CubeSQL logic)
cd rust/cubesql && cargo test -p cubesql --lib

# Native module (verifies Rust compilation)
cd ../../packages/cubejs-backend-native && yarn run native:build-debug

# TypeScript compilation (verifies all JS/TS changes)
cd ../.. && yarn tsc
```
