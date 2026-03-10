module.exports = {
  timeout: 120000,
  use: {
    headless: true,
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure'
  },
  reporter: [['line']]
};
