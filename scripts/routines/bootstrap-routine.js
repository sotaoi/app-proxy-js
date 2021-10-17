#!/bin/env node

process.env.NODE_ENV = 'production';
const { init } = require('@app/omni/init');
init();
const { config } = require('@app/omni/config');
const { AppKernel } = require('@sotaoi/api/app-kernel');
const { getAppInfo } = require('@sotaoi/omni/get-app-info');
const { Store } = require('@sotaoi/api/store');
const { sconnect } = require('@sotaoi/api/db');
const { Model } = require('@sotaoi/api/db/model');

const bootstrapRoutine = async () => {
  new AppKernel().bootstrap(config);
  await Store.init(getAppInfo(), {}, {}, null);
  await sconnect();
  return async () => {
    await Model.sdriver().destroy();
  };
};

module.exports = { bootstrapRoutine };
