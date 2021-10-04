import { config } from '@app/omni/config';
config('');
import { getAppInfo } from '@sotaoi/omni/get-app-info';
import { Store } from '@sotaoi/api/store';
import { sconnect } from '@sotaoi/api/db';
import { Model } from '@sotaoi/api/db/model';

const bootstrapRoutine = async () => {
  await Store.init(getAppInfo(), {}, {}, null);
  await sconnect();
  return async () => {
    await Model.sdriver().destroy();
  };
};

export { bootstrapRoutine };
