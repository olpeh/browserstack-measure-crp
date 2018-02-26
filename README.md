# browserstack-measure-crp

Use Browserstack Hub to measure Critical Rendering Path on your site using real devices and send the performance results to InfluxDB

## Usage

* Make sure you have a Browserstack account available
* Create a InfluxDb instance @TODO: instructions?
* Install dependencies: `yarn`
* Create `.env` with required parameters. See `.env.sample`
* Run: `npm start`

## Parameters

By default this script will test all `TEST_ENDPOINTS` in all `TEST_ENVS` defined in `.env` file. The tests are run 3 times by default unless a integer is passed as a parameter to `npm start`. The endpoint URLs are opened by default 6 times in order to test the first view with cold caches and 5 times the loading performance with caches warmed.

Example: `npm start 1 3` will run tests only once and open the endpoints 3 times.
