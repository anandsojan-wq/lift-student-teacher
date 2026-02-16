const serverless = require('serverless-http');

let cachedHandler = null;
let appReadyPromise = null;

async function buildHandler() {
  if (cachedHandler) return cachedHandler;
  if (appReadyPromise) return appReadyPromise;

  appReadyPromise = (async () => {
    const [{ buildApp }, { connectDb }] = await Promise.all([
      import('../backend/src/app.js'),
      import('../backend/src/config/db.js')
    ]);

    await connectDb();
    cachedHandler = serverless(buildApp());
    return cachedHandler;
  })().catch((error) => {
    appReadyPromise = null;
    throw error;
  });

  return appReadyPromise;
}

module.exports = async (req, res) => {
  try {
    const handler = await buildHandler();
    return handler(req, res);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'API bootstrap failed.',
      error: error.message
    });
  }
};
