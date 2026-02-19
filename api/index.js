let cachedApp = null;
let appReadyPromise = null;

async function buildRuntimeApp() {
  if (cachedApp) return cachedApp;
  if (appReadyPromise) return appReadyPromise;

  appReadyPromise = (async () => {
    const [{ buildApp }, { connectDb }] = await Promise.all([
      import('../backend/src/app.js'),
      import('../backend/src/config/db.js')
    ]);

    await connectDb();
    cachedApp = buildApp();
    return cachedApp;
  })().catch((error) => {
    appReadyPromise = null;
    throw error;
  });

  return appReadyPromise;
}

module.exports = async (req, res) => {
  try {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      const routedPath = parsed.searchParams.get('path');
      if (routedPath) {
        parsed.searchParams.delete('path');
        const normalized = routedPath.startsWith('/') ? routedPath : `/${routedPath}`;
        const query = parsed.searchParams.toString();
        req.url = `/api${normalized}${query ? `?${query}` : ''}`;
      }
    } catch (error) {
      // keep original req.url
    }

    const app = await buildRuntimeApp();
    return app(req, res);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'API bootstrap failed.',
      error: error.message
    });
  }
};
