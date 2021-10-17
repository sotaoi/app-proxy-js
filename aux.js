const { Deployment } = require('@sotaoi/api/var/deployment');

const aux = new Deployment(async (setReload) => {
  // # REDIRECT HTTP to HTTPS
  const init = require('@app/omni/init').init;
  init();
  const { runServer } = require('@sotaoi/api/var/run-server');
  const path = require('path');
  const express = require('express');
  const getAppInfo = require('@sotaoi/omni/get-app-info').getAppInfo;
  const getAppDomain = require('@sotaoi/omni/get-app-info').getAppDomain;
  const logger = require('@sotaoi/logger').logger;

  getTimestamp = () => {
    return new Date().toISOString().substr(0, 19).replace('T', ' ');
  };

  const appInfo = getAppInfo();
  const appDomain = getAppDomain();

  logger(path.resolve('./logs'));

  if (appInfo.proxyPort === '443' && appInfo.redirectFromPort) {
    app = express();
    app.get('*', (req, res) => res.redirect(`https://${appDomain}${req.url}`));
    const server = await runServer(
      {},
      app,
      '@app/proxy/aux',
      async (nextModule) => {
        try {
          await nextModule.aux.run();
          console.info('Done');
        } catch (err) {
          console.error(err);
        }
      },
      () => {
        logger().info(`[${getTimestamp()}] Proxy server redirecting from port ${appInfo.redirectFromPort}`);
      },
      5000,
    );
    server.start('80');

    setReload(async () => {
      console.info('Reloading...');
      await server.reload();
    });
  }
});

module.exports = {
  aux,
};
