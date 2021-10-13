process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { config } = require('@app/omni/config');
config('');
const { proxy } = require('@sotaoi/api/proxy');
const { getAppInfo, getAppDomain } = require('@sotaoi/omni/get-app-info');
const yargs = require('yargs');
const { AppKernel } = require('@sotaoi/api/app-kernel');

process.env.SIGNATURE_1 = process.env.DB_NAME;
process.env.SIGNATURE_2 = process.env.DB_CONTROL_PANEL_NAME;

new AppKernel().bootstrap(config);

const argv = yargs
  .option('testserver', {
    description: 'Start non https express on port 80',
    type: 'boolean',
  })
  .help()
  .alias('help', 'h').argv;

proxy(getAppInfo(), getAppDomain(), !!argv.testserver);
