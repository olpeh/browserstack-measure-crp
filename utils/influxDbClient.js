const axios = require('axios');
const { debounce, map, size } = require('lodash');

function assert(expectedTruthyVal, description) {
  if (!expectedTruthyVal) throw new Error(`Assertion Error: ${description}`);
}

/**
 * Implements low-level bindings for sending values to a remote InfluxDB instance.
 *
 * @example const client = createInfluxDbClient('https://metrics-db.infra.fiba3x3.com/', 'metrics_custom');
 *          client.writeData('cpu_load', { host: 'heroku-1' }, { value: 1.23 });
 *
 * The writes are buffered for better write performance. Set bufferTime to 0 for fastest possible writes.
 *
 * @see https://docs.influxdata.com/influxdb/v1.2/guides/writing_data/
 */
function init(dbUrl, dbName, credentials = '', bufferTime = 100) {
  const url = dbUrl.replace(/\/*$/, '/write?db=' + dbName);
  const [username, password] = credentials.split(':');
  const auth = username && password ? { username, password } : undefined;
  const bufferedSend = debounce(sendData, bufferTime, {
    maxWait: bufferTime * 10
  });

  let buffer = [];

  return {
    writeData
  };

  function writeData(measurement, tags, fields, timestampInMs) {
    const line = toInfluxLineProtocol(measurement, tags, fields, timestampInMs);
    buffer.push(line);
    bufferedSend();
    return line;
  }

  function sendData() {
    const size = buffer.length;
    if (!size) return; // nothing to send, so don't!
    const data = buffer.join('\n');
    buffer = [];
    return axios
      .post(url, data, { auth })
      .then(
        () =>
          console.log(`Successfully sent buffer of ${size} lines`, '\n' + data),
        err =>
          console.log(
            `Could not send buffer of ${size} lines (error was "${
              err.message
            }")`,
            err
          )
      );
  }
}

// @see https://docs.influxdata.com/influxdb/v1.2/concepts/glossary/#line-protocol
// @example "weather,location=us-midwest temperature=82,bug_concentration=98 1465839830100000000"
function toInfluxLineProtocol(measurement, tags, fields, timestampInMs) {
  assert(measurement, `Measurement name required, "${measurement}" given`);
  assert(size(fields), 'At least 1 field required, 0 given');
  const tagString = map(tags, (val, key) => `${key}=${val}`).join(',');
  const tagSeparator = size(tags) ? ',' : '';
  const fieldString = map(fields, (val, key) => `${key}=${val}`).join(',');
  const timeString = timestampInMs ? ` ${timestampInMs * 1e6}` : ''; // convert from milliseconds to nanoseconds
  return `${measurement}${tagSeparator}${tagString} ${fieldString}${timeString}`;
}

module.exports = init;
