require('dotenv').config();
const webdriver = require('selenium-webdriver');
const BrowserStack = require('browserstack-client');
const { map } = require('lodash');

const createInfluxDbClient = require('../utils/influxDbClient');

const {
  INLUX_DB_URL,
  INLUX_DB_NAME,
  INFLUX_USER,
  INFLUX_PASSWORD,
  BROWSERSTACK_USERNAME,
  BROWSERSTACK_KEY,
  BROWSERSTACK_PROJECT,
  BROWSERSTACK_BUILD,
  TEST_ENDPOINTS,
  BASIC_AUTH,
  PRODUCT,
  TEST_ENVS
} = process.env;
const INFLUX_DB_CREDENTIALS = `${INFLUX_USER}:${INFLUX_PASSWORD}`;

const client = createInfluxDbClient(
  INLUX_DB_URL,
  INLUX_DB_NAME,
  INFLUX_DB_CREDENTIALS
);

// BrowserStack Automate API
const automateClient = new BrowserStack.AutomateClient({
  username: BROWSERSTACK_USERNAME,
  key: BROWSERSTACK_KEY
});

const rounds = process.argv[2] ? process.argv[2] : 3,
  repeatViewCount = process.argv[3] ? process.argv[3] : 6,
  endPoints = TEST_ENDPOINTS.split(' '),
  testEnvs = TEST_ENVS.split(' ');

// Input capabilities
const capabilities = {
  'browserstack.user': BROWSERSTACK_USERNAME,
  'browserstack.key': BROWSERSTACK_KEY,
  'browserstack.debug': 'true',
  project: BROWSERSTACK_PROJECT,
  build: `${BROWSERSTACK_BUILD}-${new Date().toLocaleDateString()}`
};

const createBrowserStackCapability = (browserName, otherCapabilities) => ({
  ...capabilities,
  ...otherCapabilities,
  browserName
});

const mobile = (browserName, rest) =>
  createBrowserStackCapability(browserName, {
    realMobile: true,
    ...rest
  });

const android = args =>
  mobile('chrome', {
    platform: 'ANDROID',
    ...args
  });

const iPhone = args =>
  mobile('iPhone', {
    platform: 'MAC',
    ...args
  });

const capabilitiesUsed = [
  android({
    device: 'Google Pixel',
    os_version: '7.1'
  }),
  android({
    device: 'Google Nexus 6',
    os_version: '6.0'
  }),
  android({
    device: 'Samsung Galaxy S6',
    os_version: '5.0'
  })
  // iPhone({
  //   device: 'iPhone SE',
  //   os_version: '11.2'
  // }),
  // iPhone({
  //   device: 'iPhone X',
  //   os_version: '11.0'
  // }),
  // iPhone({
  //   device: 'iPhone 8',
  //   os_version: '11.0'
  // })
];

const executeScript = (driver, script) =>
  driver.executeScript(`return ${script}`);

const postResults = (testEnv, capabilities, repetition, results, path) => {
  console.log(PRODUCT, capabilities, repetition, results);
  let valid = true;
  map(results, (val, key) => {
    if (typeof val === 'undefined' || val < 0) {
      console.warn(`${key} has an invalid value of ${val}, ignoring...`);
      valid = false;
    }
  });

  if (valid) {
    return client.writeData(
      `performance-${testEnv}`,
      {
        product: PRODUCT,
        platform: capabilities.platform,
        browser: capabilities.browserName,
        os_version: capabilities.os_version,
        repeatView: !!repetition,
        path
      },
      results,
      new Date().getTime()
    );
  }
  return;
};

async function getPerfResults(driver) {
  // const host = driver.execute_script window.location.host,
  const t = await executeScript(driver, 'window.performance.timing'),
    host = await executeScript(driver, 'window.location.host'),
    perfResults = {
      host: `"${host}"`,
      navigationStart: t.navigationStart,
      responseStart: t.responseStart,
      domInteractive: t.domInteractive - t.domLoading,
      domContentLoaded: t.domContentLoadedEventStart - t.domLoading,
      complete: t.domComplete - t.domLoading
    };
  return perfResults;
}

async function doRun({ testEnv, url, capabilities, path, queued }) {
  console.log('doRun called', testEnv, url, capabilities, path);
  const driver = new webdriver.Builder()
    .usingServer('https://hub-cloud.browserstack.com/wd/hub')
    .withCapabilities(capabilities)
    .build();

  try {
    // First page load happens empty caches
    for (let repetition = 0; repetition < repeatViewCount; repetition++) {
      console.log(
        `Trying to get ${url}, repetition: ${repetition}, on browser ${
          capabilities.browserName
        }`
      );
      driver.get(url);
      const perfResults = await getPerfResults(driver);
      postResults(testEnv, capabilities, repetition, perfResults, path);
      // Make sure the browser need to load the page again on next round
      driver.get('about:blank');
    }
    if (queued) {
      queuedCount--;
    }
    driver.quit();
  } catch (ex) {
    console.log('Failed on url ', url);
    console.log('With capabilities: ', JSON.stringify(capabilities));
    console.log(ex);
    if (queued) {
      queuedCount--;
    }
    driver.quit();
  }
}

const generateTests = () => {
  let pending = [];
  for (let i = 0; i < rounds; i++) {
    console.log(`Round ${i}`);
    for (const capabilities of capabilitiesUsed) {
      console.log(capabilities);
      for (const testEnv of testEnvs) {
        console.log(
          `Test for ${testEnv} on ${capabilities.device} ${
            capabilities.platform
          } ${capabilities.os_version} browser ${capabilities.browserName}`
        );
        const basicAuth = BASIC_AUTH ? `${BASIC_AUTH}@` : '';
        const share = '1835316cb9609f93bff9d09f4cd8460e';
        const baseUrl = `https://${basicAuth}${testEnv}`;
        for (const path of endPoints) {
          // Path includes / in the beginning
          const url = `${baseUrl}${path}?share=${share}`;
          pending.push({ testEnv, url, capabilities, path });
          console.log(pending.length);
        }
      }
    }
  }
  return pending;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getStatus() {
  return automateClient
    .getStatus()
    .then(status => {
      console.log('Status', status);
      /* {
        automate_plan: 'Automate Mobile',
        parallel_sessions_running: 0,
        team_parallel_sessions_max_allowed: 5,
        parallel_sessions_max_allowed: 5,
        queued_sessions: 0,
        queued_sessions_max_allowed: 5
      } */
      return status;
    })
    .catch(e => {
      console.error(e);
      return null;
    });
}

async function runAsManyAsPossible(tests) {
  let pending = JSON.parse(JSON.stringify(tests));

  const status = await getStatus();
  const availableParallel =
      status.team_parallel_sessions_max_allowed -
      status.parallel_sessions_running,
    availableQueue =
      status.queued_sessions_max_allowed - status.queued_sessions;

  // Run and queue as many parallel tests as possible
  for (let i = 0; i < availableParallel + availableQueue; i++) {
    const testToRun = pending.pop();
    doRun({ ...testToRun, queued: false });
  }
  return pending;
}

async function processTests(tests) {
  let pending = JSON.parse(JSON.stringify(tests));
  do {
    pending = await runAsManyAsPossible(pending);
    console.log(`Going to sleep for 15s and waiting for queue to get emptier`);
    await sleep(15000);
  } while (pending.length > 0);
  console.log('All tests are now running, pending or done.');
}

async function main() {
  const tests = generateTests();
  await processTests(tests);
  console.log('Done!');
}

main();
