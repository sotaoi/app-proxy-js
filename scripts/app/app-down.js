#!/bin/env node

const { bootstrapRoutine } = require('@app/proxy/scripts/routines/bootstrap-routine');
const { Store } = require('@sotaoi/api/store');
const { logger } = require('@sotaoi/api/logger');

const main = async () => {
  const done = await bootstrapRoutine();
  await Store.setMaintenance(true);
  await done();
  logger().info('App is now in maintenance mode');
  return;
};

main();
