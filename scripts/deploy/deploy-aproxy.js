#!/bin/env node

const fs = require('fs');
const path = require('path');
const { Helper } = require('@sotaoi/omni/helper');
const { execSync } = require('child_process');

const main = async () => {
  fs.rmdirSync(path.resolve('./deployment'), { recursive: true });
  fs.rmdirSync(path.resolve('./tmp.deployment'), { recursive: true });
  fs.mkdirSync(path.resolve('./deployment'));
  fs.writeFileSync(path.resolve('./deployment/.gitkeep'), '');

  const packageJson = JSON.parse(fs.readFileSync(path.resolve('./package.json')).toString());

  fs.mkdirSync(path.resolve('./tmp.deployment'));
  execSync(`git clone git@github.com:sotaoi/app-proxy . && git checkout -b ${packageJson.version}`, {
    cwd: path.resolve('./tmp.deployment'),
    stdio: 'inherit',
  });

  Helper.copyRecursiveSync(fs, path, path.resolve('./'), path.resolve('./deployment'), [
    path.resolve('.git'),
    path.resolve('./deployment'),
    path.resolve('./certs'),
    path.resolve('./node_modules'),
    path.resolve('./tmp.deployment'),
  ]);

  execSync('npm run bootstrap:prod', { cwd: path.resolve('./deployment'), stdio: 'inherit' });

  fs.renameSync(path.resolve('./tmp.deployment/.git'), path.resolve('./deployment/.git'));
  fs.rmdirSync(path.resolve('./tmp.deployment'), { recursive: true });
  execSync(
    `git add --all && git commit -m "release ${packageJson.version}" && git push -f -u origin ${packageJson.version}`,
    {
      cwd: path.resolve('./deployment'),
      stdio: 'inherit',
    },
  );
  fs.rmdirSync(path.resolve('./deployment/.git'), { recursive: true });
};

main();
