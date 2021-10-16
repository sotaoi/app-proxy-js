const { init } = require('@app/omni/init');
init();
const { getAppInfo } = require('@sotaoi/omni/get-app-info');
const { Store } = require('@sotaoi/api/store');
const { sconnect } = require('@sotaoi/api/db');
const { Model } = require('@sotaoi/api/db/model');

const bootstrapRoutine = async () => {
  await Store.init(getAppInfo(), {}, {}, null);
  await sconnect();
  return async () => {
    await Model.sdriver().destroy();
  };
};

export { bootstrapRoutine };
