const fromExports = require('./dist/src');
const { SparkDriver } = require('./dist/src/SparkDriver');

const toExport = SparkDriver;

// eslint-disable-next-line no-restricted-syntax
for (const [key, module] of Object.entries(fromExports)) {
  toExport[key] = module;
}

module.exports = toExport;
