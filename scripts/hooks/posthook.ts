#!/bin/env node

import fs from 'fs';
import path from 'path';

const main = async (): Promise<void> => {
  !fs.existsSync(path.resolve('./.env')) && fs.copyFileSync(path.resolve('./.env.example'), path.resolve('./.env'));
};

main();
