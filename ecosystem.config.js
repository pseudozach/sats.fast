module.exports = {
  apps: [
    {
      name: 'sats-fast-bot',
      script: 'apps/bot/dist/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        START_SERVER: 'true',
      },
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 1000,
    },
    {
      name: 'sats-fast-admin',
      script: 'apps/admin/dist/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '256M',
      exp_backoff_restart_delay: 1000,
    },
  ],
};
