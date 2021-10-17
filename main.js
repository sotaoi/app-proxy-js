const { Deployment } = require('@sotaoi/api/var/deployment');

const main = new Deployment(async (setReload) => {
  const { init } = require('@app/omni/init');
  init();
  const { config } = require('@app/omni/config');
  const { execSync, spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const express = require('express');
  const { createProxyMiddleware } = require('http-proxy-middleware');
  const { getAppInfo } = require('@sotaoi/omni/get-app-info');
  const { getAppDomain } = require('@sotaoi/omni/get-app-info');
  const knex = require('knex');
  const { logger } = require('@sotaoi/logger');
  const rateLimit = require('express-rate-limit');
  const { runServer } = require('@sotaoi/api/var/run-server');

  logger(path.resolve('./logs'));

  let sconnected = false;
  let db = null;
  let greenlock = false;
  let appMaintenance = false;
  let needsGreenlock = false;

  let initInterval = null;
  let startServerInterval = null;

  let app = null;
  let server = null;

  let dbDestroyTimeout = null;

  const appInfo = getAppInfo();
  const appDomain = getAppDomain();

  const middleware = {
    rlm: rateLimit({
      windowMs: 10 * 60 * 1000, // 10 minutes
      max: 2000, // limit each IP to 2000 requests per windowMs
    }),
  };
  const routeMiddleware = {
    '/api': (req, res, next) => {
      if (appMaintenance === null || appMaintenance === true) {
        return;
      }

      return createProxyMiddleware({
        secure: false,
        // pathRewrite: {
        //   '^/api/': '/api/',
        // },
        // pathRewrite: {
        //   '^/api': '/api',
        // },
        target: `https://${appDomain}:${appInfo.apiPort}`,
        ws: false,
        changeOrigin: true,
      })(req, res, next);
    },

    '/socket.io': (req, res, next) => {
      if (appMaintenance === null || appMaintenance === true) {
        return;
      }

      return createProxyMiddleware({
        secure: false,
        target: `https://${appDomain}:${appInfo.streamingPort}`,
        ws: true,
        changeOrigin: true,
      })(req, res, next);
    },
  };

  JSON.parse(execSync('php artisan routes', { cwd: path.resolve('../app-php') }).toString()).map((route) => {
    route = route.replace(new RegExp('{(?:\\s+)?(.*)(?:\\s+)?}'), ':$1');
    routeMiddleware[route] = (req, res, next) => {
      return createProxyMiddleware({
        secure: false,
        target: `https://${appDomain}:4000`,
        ws: true,
        changeOrigin: true,
      })(req, res, next);
    };
  });

  appInfo.oauthPrefix &&
    (routeMiddleware[appInfo.oauthPrefix] = (req, res, next) => {
      if (appMaintenance === null || appMaintenance === true) {
        return;
      }

      return createProxyMiddleware({
        secure: false,
        target: `http://${appDomain}:${config('app.oauth_port')}`,
        ws: false,
        changeOrigin: false,
      })(req, res, next);
    });

  routeMiddleware['/'] = (req, res, next) => {
    if (appMaintenance === null || appMaintenance === true) {
      return res.send({
        code: 200,
        title: appMaintenance === null ? 'Proxy server is starting up' : 'Service is currently unavailable',
        message:
          appMaintenance === null
            ? 'Proxy server is spinning, please wait'
            : 'We are currently undergoing maintenance operations',
      });
    }

    if (needsGreenlock) {
      if (req.url.substr(0, 12) === '/.well-known') {
        logger().info(`running acme verification: ${req.url}`);
        const acme = fs.readdirSync(path.resolve('./var/greenlock.d/accounts'));
        const urlSplit = req.url.substr(1).split('/');
        const credentials = require(path.resolve(
          `./var/greenlock.d/accounts/${acme[0]}/directory/${appInfo.sslMaintainer}.json`,
        ));
        logger().info('greenlock credentials:', credentials);
        return res.send(urlSplit[2] + '.' + credentials.publicKeyJwk.kid);
      }
      return res.send('waiting for greenlock...');
    }

    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(`https://${appDomain}${req.url}`);
    }

    if (appMaintenance === null || appMaintenance === true) {
      return;
    }

    return createProxyMiddleware({
      secure: false,
      target: `https://${appDomain}:8080`,
      ws: true,
      changeOrigin: false,
    })(req, res, next);
  };

  const sconnect = async () => {
    if (sconnected) {
      return;
    }
    sconnected = true;
    const dbConfig = config('db');

    db = await knex({
      client: 'mysql',
      connection: {
        host: dbConfig.connection.host,
        user: dbConfig.connection.user,
        password: dbConfig.connection.password,
        database: dbConfig.connection.control_panel_database,
      },
      migrations: {
        directory: path.resolve(path.dirname(require.resolve('@sotaoi/api/package.json')), 'db', 'migrations'),
      },
      seeds: {
        directory: path.resolve(path.dirname(require.resolve('@sotaoi/api/package.json')), 'db', 'seeds'),
      },
    });
  };

  const hasCerts = () => {
    return !(
      !fs.existsSync(path.resolve(appInfo.sslKey)) ||
      !fs.existsSync(path.resolve(appInfo.sslCert)) ||
      !fs.existsSync(path.resolve(appInfo.sslCa))
    );
  };

  const certs = () => {
    const keyPath = path.resolve(appInfo.sslKey);
    const certPath = path.resolve(appInfo.sslCert);
    const chainPath = path.resolve(appInfo.sslCa);
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: fs.readFileSync(chainPath),
    };
  };

  const getTimestamp = () => {
    return new Date().toISOString().substr(0, 19).replace('T', ' ');
  };

  const startServer = async () => {
    clearInterval(initInterval);
    initInterval = setInterval(async () => {
      try {
        const appRecord = (await db('app').where('bundleUid', appInfo.bundleUid).first()) || null;
        const appPocket =
          typeof appRecord?.pocket === 'string' && appRecord.pocket.length ? JSON.parse(appRecord.pocket) : {};
        appMaintenance = !!appPocket.coreState?.appMaintenance;
      } catch (err) {
        logger().error(err);
      }
    }, 2000);

    server = await runServer(
      { ...certs(appInfo), rejectUnauthorized: false },
      app,
      '@app/proxy/main',
      async (nextModule) => {
        await nextModule.main.run();
      },
      () => {
        logger().info(`[${getTimestamp()}] Proxy server running on port ${appInfo.proxyPort}`);
      },
      5000,
    );

    server.start(appInfo.proxyPort);

    setReload(async () => {
      console.info('Reloading...');
      clearInterval(initInterval);
      clearInterval(startServerInterval);
      clearTimeout(dbDestroyTimeout);
      try {
        await new Promise((resolve, reject) => {
          clearTimeout(dbDestroyTimeout);
          let resolved = false;
          sconnected = false;
          db.destroy(() => {
            clearTimeout(dbDestroyTimeout);
            if (resolved) {
              return;
            }
            resolved = true;
            resolve();
          });
          db = null;
          dbDestroyTimeout = setTimeout(() => {
            if (resolved) {
              return;
            }
            resolved = true;
            reject(new Error('Failed to properly disconnect MySQL connection'));
          }, 5000);
        });
      } catch (err) {
        logger().error(err);
      }
      await server.reload();
    });
  };

  //

  needsGreenlock = !hasCerts(appInfo);

  await sconnect();

  app = express();

  for (const middlewareItem of Object.values(middleware)) {
    app.use(middlewareItem);
  }
  for (const [routeScheme, middleware] of Object.entries(routeMiddleware)) {
    app.use(routeScheme, middleware);
  }

  clearInterval(startServerInterval);
  startServerInterval = setInterval(async () => {
    if (!hasCerts(appInfo)) {
      logger().info('certificates not yet installed. waiting to start server...');
      if (!greenlock && appInfo.greenlockExecution === 'autorun') {
        greenlock = true;
        const greenlockCmd = appInfo.environment !== 'production' ? 'ssl:greenlock' : 'ssl:greenlock:prod';
        const greenlockProcess = spawn('npm', ['run', greenlockCmd]);
        greenlockProcess.stdout.on('data', (data) => {
          logger().info(data.toString());
        });
        greenlockProcess.stderr.on('data', (data) => {
          logger().error(data.toString());
        });
      }
      return;
    }
    needsGreenlock = false;
    clearInterval(startServerInterval);
    await startServer();
  }, 5000);
});

module.exports = { main };
