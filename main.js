const main = async (scope) => {
  if (typeof scope.reload === 'function') {
    await scope.reload();
  }

  for (const key of Object.keys(scope)) {
    delete scope[key];
  }

  scope.reload = async () => {
    // console.info(scope);
    // console.info(require.cache);
    scope.server.close(() => {
      console.log('yolo?');
    });
    return false;
  };

  scope.init = require('@app/omni/init').init;
  scope.init();
  scope.config = require('@app/omni/config').config;
  scope.execSync = require('child_process').execSync;
  scope.spawn = require('child_process').spawn;
  scope.fs = require('fs');
  scope.path = require('path');
  scope.express = require('express');
  scope.https = require('https');
  scope.createProxyMiddleware = require('http-proxy-middleware').createProxyMiddleware;
  scope.getAppInfo = require('@sotaoi/omni/get-app-info').getAppInfo;
  scope.getAppDomain = require('@sotaoi/omni/get-app-info').getAppDomain;
  scope.knex = require('knex');
  scope.logger = require('@sotaoi/logger').logger;
  scope.rateLimit = require('express-rate-limit');

  scope.logger(scope.path.resolve('./logs'));

  scope.appInfo = scope.getAppInfo();
  scope.appDomain = scope.getAppDomain();
  scope.validDomains = [
    scope.appInfo.prodDomain,
    scope.appInfo.prodDomainAlias,
    scope.appInfo.stageDomain,
    scope.appInfo.stageDomainAlias,
    scope.appInfo.devDomain,
    scope.appInfo.devDomainAlias,
    scope.appInfo.localDomain,
    scope.appInfo.localDomainAlias,
  ];

  scope.sconnected = false;
  scope.db = null;
  scope.greenlock = false;
  scope.exitHandled = false;
  scope.appMaintenance = null;
  scope.needsGreenlock = false;

  // app, server listener and middleware {{
  scope.server = null;
  scope.app = null;
  scope.middleware = {
    rlm: scope.rateLimit({
      windowMs: 10 * 60 * 1000, // 10 minutes
      max: 2000, // limit each IP to 2000 requests per windowMs
    }),
  };
  scope.routeMiddleware = {
    '/': (req, res, next) => {
      if (scope.appMaintenance === null || scope.appMaintenance === true) {
        return res.send({
          code: 200,
          title: scope.appMaintenance === null ? 'Proxy server is starting up' : 'Service is currently unavailable',
          message:
            scope.appMaintenance === null
              ? 'Proxy server is spinning, please wait'
              : 'We are currently undergoing maintenance operations',
        });
      }

      if (scope.needsGreenlock) {
        if (req.url.substr(0, 12) === '/.well-known') {
          scope.logger().info(`running acme verification: ${req.url}`);
          const acme = scope.fs.readdirSync(scope.path.resolve('./var/greenlock.d/accounts'));
          const urlSplit = req.url.substr(1).split('/');
          const credentials = require(scope.path.resolve(
            `./var/greenlock.d/accounts/${acme[0]}/directory/${scope.appInfo.sslMaintainer}.json`,
          ));
          scope.logger().info('greenlock credentials:', credentials);
          return res.send(urlSplit[2] + '.' + credentials.publicKeyJwk.kid);
        }
        return res.send('waiting for greenlock...');
      }

      if (req.headers['x-forwarded-proto'] === 'http') {
        return res.redirect(`https://${scope.appDomain}${req.url}`);
      }

      if (scope.appMaintenance === null || scope.appMaintenance === true) {
        return;
      }

      return scope.createProxyMiddleware({
        secure: false,
        target: `https://${scope.appDomain}:8080`,
        ws: true,
        changeOrigin: false,
      })(req, res, next);
    },
    '/api': (req, res, next) => {
      if (scope.appMaintenance === null || scope.appMaintenance === true) {
        return;
      }

      let ok = false;
      for (const validDomain of scope.validDomains) {
        const currentDomain = req.get('host') || '';
        if (currentDomain.indexOf(validDomain) === -1) {
          continue;
        }
        ok = true;
        break;
      }
      if (!ok) {
        return res.send({ error: 'Not Found', message: 'Not Found', code: 404 });
      }
      return scope.createProxyMiddleware({
        secure: false,
        // pathRewrite: {
        //   '^/api/': '/api/',
        // },
        // pathRewrite: {
        //   '^/api': '/api',
        // },
        target: `https://${scope.appDomain}:${scope.appInfo.apiPort}`,
        ws: false,
        changeOrigin: true,
      })(req, res, next);
    },
    '/socket.io': (req, res, next) => {
      if (scope.appMaintenance === null || scope.appMaintenance === true) {
        return;
      }

      return scope.createProxyMiddleware({
        secure: false,
        target: `https://${scope.appDomain}:${scope.appInfo.streamingPort}`,
        ws: true,
        changeOrigin: true,
      })(req, res, next);
    },
  };
  JSON.parse(scope.execSync('php artisan routes', { cwd: scope.path.resolve('../app-php') }).toString()).map(
    (route) => {
      route = route.replace(new RegExp('{(?:\\s+)?(.*)(?:\\s+)?}'), ':$1');
      scope.routeMiddleware[route] = (req, res, next) => {
        return scope.createProxyMiddleware({
          secure: false,
          target: `https://${scope.appDomain}:4000`,
          ws: true,
          changeOrigin: true,
        })(req, res, next);
      };
    },
  );
  scope.appInfo.oauthPrefix &&
    (scope.routeMiddleware[scope.appInfo.oauthPrefix] = (req, res, next) => {
      if (scope.appMaintenance === null || scope.appMaintenance === true) {
        return;
      }

      return scope.createProxyMiddleware({
        secure: false,
        target: `http://${scope.appDomain}:${config('scope.app.oauth_port')}`,
        ws: false,
        changeOrigin: false,
      })(req, res, next);
    });
  // }}

  scope.initInterval = null;
  scope.startServerInterval = null;

  scope.sconnect = async () => {
    if (scope.sconnected) {
      return;
    }
    scope.sconnected = true;
    const dbConfig = scope.config('db');

    scope.db = await scope.knex({
      client: 'mysql',
      connection: {
        host: dbConfig.connection.host,
        user: dbConfig.connection.user,
        password: dbConfig.connection.password,
        database: dbConfig.connection.control_panel_database,
      },
      migrations: {
        directory: scope.path.resolve(
          scope.path.dirname(require.resolve('@sotaoi/api/package.json')),
          'db',
          'migrations',
        ),
      },
      seeds: {
        directory: scope.path.resolve(scope.path.dirname(require.resolve('@sotaoi/api/package.json')), 'db', 'seeds'),
      },
    });
  };

  scope.hasCerts = () => {
    const keyPath = scope.path.resolve(scope.appInfo.sslKey);
    const certPath = scope.path.resolve(scope.appInfo.sslCert);
    const chainPath = scope.path.resolve(scope.appInfo.sslCa);
    return !(!scope.fs.existsSync(keyPath) || !scope.fs.existsSync(certPath) || !scope.fs.existsSync(chainPath));
  };

  scope.certs = () => {
    const keyPath = scope.path.resolve(scope.appInfo.sslKey);
    const certPath = scope.path.resolve(scope.appInfo.sslCert);
    const chainPath = scope.path.resolve(scope.appInfo.sslCa);
    return {
      key: scope.fs.readFileSync(keyPath),
      cert: scope.fs.readFileSync(certPath),
      ca: scope.fs.readFileSync(chainPath),
    };
  };

  scope.getTimestamp = () => {
    return new Date().toISOString().substr(0, 19).replace('T', ' ');
  };

  scope.startServer = async () => {
    clearInterval(scope.initInterval);
    scope.initInterval = setInterval(async () => {
      try {
        const app = (await scope.db('app').where('bundleUid', scope.appInfo.bundleUid).first()) || null;
        const appPocket = typeof app?.pocket === 'string' && app.pocket.length ? JSON.parse(app.pocket) : {};
        scope.appMaintenance = !!appPocket.coreState?.appMaintenance;
      } catch (err) {
        scope.logger().error(err);
      }
    }, 2000);

    scope.server = scope.https
      .createServer(
        {
          ...scope.certs(scope.appInfo),
          // SNICallback: async (currentDomain, cb) => {
          //   const tls  = require('tls');
          //   const secureContext = tls.createSecureContext(
          //     await (async (): Promise<{ [key]: any }> => {
          //       // other sync / async procedures can go here
          //       return {
          //         ...scope.certs(),
          //       };
          //     })(),
          //   );
          //   if (cb) {
          //     cb(null, secureContext);
          //     return;
          //   }
          //   return secureContext;
          // },
          rejectUnauthorized: false,
        },
        scope.app,
      )
      .listen(scope.appInfo.proxyPort);
    scope.logger().info(`[${scope.getTimestamp()}] Proxy server running on port ${scope.appInfo.proxyPort}`);
  };

  // run {{

  scope.run = async () => {
    scope.needsGreenlock = !scope.hasCerts(scope.appInfo);

    await scope.sconnect();

    scope.app = scope.express();

    for (const middleware of Object.values(scope.middleware)) {
      scope.app.use(middleware);
    }
    for (const [routeScheme, middleware] of Object.entries(scope.routeMiddleware)) {
      scope.app.use(routeScheme, middleware);
    }

    clearInterval(scope.startServerInterval);
    scope.startServerInterval = setInterval(async () => {
      if (!scope.hasCerts(scope.appInfo)) {
        scope.logger().info('certificates not yet installed. waiting to start server...');
        if (!greenlock && scope.appInfo.greenlockExecution === 'autorun') {
          greenlock = true;
          const greenlockCmd = scope.appInfo.environment !== 'production' ? 'ssl:greenlock' : 'ssl:greenlock:prod';
          const greenlockProcess = scope.spawn('npm', ['run', greenlockCmd]);
          greenlockProcess.stdout.on('data', (data) => {
            scope.logger().info(data.toString());
          });
          greenlockProcess.stderr.on('data', (data) => {
            scope.logger().error(data.toString());
          });
        }
        return;
      }
      scope.needsGreenlock = false;
      clearInterval(scope.startServerInterval);
      await scope.startServer();
    }, 5000);
  };

  // }}

  scope.run();
};

module.exports = { main };
