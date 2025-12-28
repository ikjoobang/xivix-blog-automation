// PM2 ecosystem configuration for Blog Automation System
module.exports = {
  apps: [
    {
      name: 'blog-automation',
      script: 'npx',
      args: 'wrangler pages dev dist --ip 0.0.0.0 --port 3000 --env-file .dev.vars',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}