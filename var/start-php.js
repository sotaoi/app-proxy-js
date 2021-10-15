#!/usr/bin/env node

const path = require('path');
const { execSync } = require('child_process');

const main = async () => {
  const apacheBinary = process.platform === 'darwin' ? 'httpd' : process.platform === 'linux' ? 'apache2' : null;
  const httpdConf =
    process.platform === 'darwin' ? 'httpd.mac.conf' : process.platform === 'linux' ? 'httpd.linux.conf' : null;
  execSync(`${apacheBinary} -X -d ./ -f var/httpd/${httpdConf}`, {
    cwd: path.resolve(__dirname, '../'),
    stdio: 'inherit',
  });
};

main();
