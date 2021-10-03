process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
process.env.SIGNATURE_1 = process.env.DB_NAME;
process.env.SIGNATURE_2 = process.env.DB_CONTROL_PANEL_NAME;
import { proxy } from '@sotaoi/api/proxy';
import { getAppInfo, getAppDomain } from '@sotaoi/omni/get-app-info';
import yargs from 'yargs';

const argv: { [key: string]: any } = yargs
  .option('testserver', {
    description: 'Start non https express on port 80',
    type: 'boolean',
  })
  .help()
  .alias('help', 'h').argv;

proxy(getAppInfo(require('dotenv')), getAppDomain(require('dotenv')), !!argv.testserver);
