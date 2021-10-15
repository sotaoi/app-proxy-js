process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { config } = require('@app/omni/config');
config('');
const { execSync, spawn } = require('child_process');
const path = require('path');
const express = require('express');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const { getAppInfo, getAppDomain } = require('@sotaoi/omni/get-app-info');
const knex = require('knex');
const { logger } = require('@sotaoi/logger');

logger(path.resolve('./logs'));

let sconnected = false;
let db = null;
let greenlock = false;
let exitHandled = false;
let appMaintenance = null;

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

const rateLimit = require('express-rate-limit');
const servers = [];

const hasCerts = (appInfo) => {
  const keyPath = path.resolve(appInfo.sslKey);
  const certPath = path.resolve(appInfo.sslCert);
  const chainPath = path.resolve(appInfo.sslCa);
  return !(!fs.existsSync(keyPath) || !fs.existsSync(certPath) || !fs.existsSync(chainPath));
};

const certs = (appInfo) => {
  const keyPath = path.resolve(appInfo.sslKey);
  const certPath = path.resolve(appInfo.sslCert);
  const chainPath = path.resolve(appInfo.sslCa);
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), ca: fs.readFileSync(chainPath) };
};

const getTimestamp = () => {
  return new Date().toISOString().substr(0, 19).replace('T', ' ');
};

const shutDown = (servers, logger) => {
  const output = logger || (() => console);

  if (!servers.length) {
    output().info('No servers to close, terminating...');
    process.exit(0);
  }

  let serverShutDownCount = 0;
  output().info('\n\nReceived kill signal, shutting down servers\n');
  servers.map((server) => {
    server.close(() => {
      serverShutDownCount++;
      if (servers.length === serverShutDownCount) {
        process.exit(0);
      }
    });
  });

  setTimeout(() => {
    output().error('\nCould not close connections in time, forcefully shutting down\n');
    process.exit(1);
  }, 10000);
};

process.stdin.resume();
const exitHandler = () => {
  if (exitHandled) {
    return;
  }
  exitHandled = true;
  shutDown(servers, logger);
};
process.on('exit', exitHandler.bind(null, { code: 0 }));
process.on('SIGINT', exitHandler.bind(null, { code: 0 }));
process.on('SIGTERM', exitHandler.bind(null, { code: 0 }));
process.on('SIGQUIT', exitHandler.bind(null, { code: 0 }));
process.on('SIGUSR1', exitHandler.bind(null, { code: 0 }));
// process.on('SIGUSR2', exitHandler.bind(null, { code: 0 })); // <-- this is nodemon
// process.on('uncaughtException', exitHandler.bind(null, { code: 1 })); // <-- you don't want shutdown on uncaughtException

const startServer = async (app, domain) => {
  const appInfo = getAppInfo();
  await sconnect();

  setInterval(async () => {
    try {
      const app = (await db('app').where('bundleUid', appInfo.bundleUid).first()) || null;
      const appPocket = typeof app?.pocket === 'string' && app.pocket.length ? JSON.parse(app.pocket) : {};
      appMaintenance = !!appPocket.coreState?.appMaintenance;
    } catch (err) {
      logger().error(err);
    }
  }, 2000);

  servers.push(
    https
      .createServer(
        {
          ...certs(appInfo),
          // SNICallback: async (currentDomain, cb) => {
          //   const tls  = require('tls');
          //   const secureContext = tls.createSecureContext(
          //     await (async (): Promise<{ [key]: any }> => {
          //       // other sync / async procedures can go here
          //       return {
          //         ...certs(),
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
        app,
      )
      .listen(appInfo.proxyPort),
  );
  logger().info(`[${getTimestamp()}] Proxy server running on port ${appInfo.proxyPort}`);

  // # REDIRECT HTTP to HTTPS
  if (appInfo.proxyPort === '443' && appInfo.redirectFromPort) {
    const expressrdr = express();
    expressrdr.get('*', (req, res) => res.redirect(`https://${domain}${req.url}`));
    servers.push(expressrdr.listen(appInfo.redirectFromPort));
    logger().info(`[${getTimestamp()}] Proxy server redirecting from port ${appInfo.redirectFromPort}`);
  }
};

const main = async () => {
  const appInfo = getAppInfo();
  const domain = getAppDomain();
  const testserver = false;

  let needsGreenlock = !hasCerts(appInfo);

  const app = express();

  if (testserver) {
    app.get('*', (req, res) => {
      return res.send('ok');
    });
    servers.push(app.listen(80));
    logger().info(`[${getTimestamp()}] Test non https server listening on port 80`);
    return;
  }

  const validDomains = [
    appInfo.prodDomain,
    appInfo.prodDomainAlias,
    appInfo.stageDomain,
    appInfo.stageDomainAlias,
    appInfo.devDomain,
    appInfo.devDomainAlias,
    appInfo.localDomain,
    appInfo.localDomainAlias,
  ];

  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 2000, // limit each IP to 2000 requests per windowMs
  });

  app.use(limiter);

  app.use('/api', (req, res, next) => {
    if (appMaintenance === null || appMaintenance === true) {
      return;
    }

    let ok = false;
    for (const validDomain of validDomains) {
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
    return createProxyMiddleware({
      secure: false,
      // pathRewrite: {
      //   '^/api/': '/api/',
      // },
      // pathRewrite: {
      //   '^/api': '/api',
      // },
      target: `https://${domain}:${appInfo.apiPort}`,
      ws: false,
      changeOrigin: true,
    })(req, res, next);
  });

  app.use('/socket.io', (req, res, next) => {
    if (appMaintenance === null || appMaintenance === true) {
      return;
    }

    return createProxyMiddleware({
      secure: false,
      target: `https://${domain}:${appInfo.streamingPort}`,
      ws: true,
      changeOrigin: true,
    })(req, res, next);
  });

  JSON.parse(execSync('php artisan routes', { cwd: path.resolve('../app-php') }).toString()).map((route) => {
    route = route.replace(new RegExp('{(?:\\s+)?(.*)(?:\\s+)?}'), ':$1');
    app.use(route, (req, res, next) => {
      return createProxyMiddleware({
        secure: false,
        target: `https://${domain}:4000`,
        ws: true,
        changeOrigin: true,
      })(req, res, next);
    });
  });

  appInfo.oauthPrefix &&
    app.use(appInfo.oauthPrefix, (req, res, next) => {
      if (appMaintenance === null || appMaintenance === true) {
        return;
      }

      return createProxyMiddleware({
        secure: false,
        target: `http://${domain}:${config('app.oauth_port')}`,
        ws: false,
        changeOrigin: false,
      })(req, res, next);
    });

  app.use('/', (req, res, next) => {
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
      return res.redirect(`https://${domain}${req.url}`);
    }

    if (appMaintenance === null || appMaintenance === true) {
      return;
    }

    return createProxyMiddleware({
      secure: false,
      target: `https://${domain}:8080`,
      ws: true,
      changeOrigin: false,
    })(req, res, next);
  });

  const startServerInterval = setInterval(async () => {
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
    await startServer(app, domain);
  }, 5000);
};

main();
