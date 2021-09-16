#!/usr/bin/env node

import Server from './server';
import Zen from './index';
import * as Util from './util.js';
import Profiler from './profiler'

// Normalize whether the cli is run directly or via node
if (process.argv[0].match(/\.js$/)) process.argv.shift();

const mode = process.argv[2] || 'run';
switch (mode) {
  case 'server':
    new Server();
    break;

  case 'run':
    run();

  case 'deploy':
    // TODO implement
    console.log('DEPLOY IS NOT IMPLEMENTED YET');
    break;

  default:
    console.error(`Invalid mode: ${mode}`);
}

async function run() {
  let t0 = Date.now();
  if (Zen.webpack) {
    console.log('Webpack building');
    let previousPercentage = 0;
    Zen.webpack.on(
      'status',
      (_status: string, stats: { message: string; percentage: number }) => {
        if (stats.percentage && stats.percentage > previousPercentage) {
          previousPercentage = stats.percentage;
          console.log(`${stats.percentage}% ${stats.message}`);
        }
      }
    );
    await Zen.webpack.build();
    console.log(`Took ${Date.now() - t0}ms`);
  }

  t0 = Date.now();
  console.log('Syncing to S3');
  Zen.s3Sync.on(
    'status',
    (msg: string) => process.env.DEBUG && console.log(msg)
  );
  await Zen.s3Sync.run(Zen.indexHtml('worker', true));
  console.log(`Took ${Date.now() - t0}ms`);

  t0 = Date.now();
  console.log('Getting test names');
  let workingSet = await Util.invoke('zen-listTests', {
    sessionId: Zen.config.sessionId,
  });
  let groups = Zen.journal.groupTests(workingSet, Zen.config.lambdaConcurrency);
  console.log(`Took ${Date.now() - t0}ms`);

  let failed = 0;
  t0 = Date.now();
  console.log(`Running ${workingSet.length} tests on ${groups.length} workers`);
  await Promise.all(
    groups.map(async (group: { tests: unknown[] }) => {
      try {
        let deflakeLimit = parseInt(process.env.RERUN_LIMIT);
        if (isNaN(deflakeLimit)) deflakeLimit = 3;

        let response = await Util.invoke('zen-workTests', {
          deflakeLimit,
          testNames: group.tests,
          sessionId: Zen.config.sessionId,
        });
        let metrics = response.map(
          (r: { attempts: number; error: boolean; fullName: string }) => {
            let metric = { name: 'log.test_failed', fields: {
                value: r.attempts,
                testName: r.fullName,
                error: r.error
              }
            }

            if (r.attempts > 1 && !r.error) {
              console.log(`⚠️ ${r.fullName} (flaked ${r.attempts - 1}x)`);
              return metric
            } else if (r.error) {
              failed++;
              console.log(
                `🔴 ${r.fullName} ${r.error} (tried ${r.attempts || 1} times)`
              );
              return metric
            }
          }
        ).filter((m : Profiler.metric) => m);
        await Profiler.logBatch(metrics)
      } catch (e) {
        console.error(e);
        failed += group.tests.length;
      }
    })
  );
  console.log(`Took ${Date.now() - t0}ms`);
  console.log(
    `${failed ? '😢' : '🎉'} ${failed} failed test${failed === 1 ? '' : 's'}`
  );
  process.exit(failed ? 1 : 0);
}
