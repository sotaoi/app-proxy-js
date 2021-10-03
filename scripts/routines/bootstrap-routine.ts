import { getAppInfo } from '@sotaoi/omni/get-app-info';
import { Store } from '@sotaoi/api/store';
import { sconnect } from '@sotaoi/api/db';
import { Model } from '@sotaoi/api/db/model';

require('dotenv').config();

const bootstrapRoutine = async () => {
  await Store.init(getAppInfo(require('dotenv')), {}, {}, null);
  await sconnect();
  return async () => {
    await Model.sdriver().destroy();
  };
};

export { bootstrapRoutine };
