#!/usr/bin/env node

const importLocal = require('import-local');

if (!importLocal(__filename)) {
  if (process.env.NODE_ENV == null) {
    process.env.NODE_ENV = 'test';
  }

  require('../build').run();
}