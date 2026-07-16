const fromExports = require('./dist/src');
const { FabricDriver } = require('./dist/src/FabricDriver');

const toExport = FabricDriver;

// eslint-disable-next-line no-restricted-syntax
for (const [key, module] of Object.entries(fromExports)) {
  toExport[key] = module;
}

module.exports = toExport;
