/**
 * PM2 process-manager config — the robust auto-restart supervisor for the WFM backend.
 *
 * Why PM2 (vs a bare `node dist/main.js` or a Task-Scheduler restart):
 *   • autorestart + exponential backoff → survives crashes without a tight crash-loop.
 *   • max_memory_restart → self-heals a memory leak before it takes the box down.
 *   • kill_timeout → gives the app 8s to close DB pool / finish in-flight requests on stop
 *     (pairs with the SIGTERM-clean-exit handlers added in main.ts).
 *   • boot persistence (`pm2 save` + pm2-windows-startup) → comes back after a reboot.
 *   • `pm2 logs` / `pm2 monit` → real visibility.
 *
 * Setup + operate: see deploy/SUPERVISOR_SETUP.md.
 *
 * NODE_ENV is intentionally NOT forced here — the app loads it from .env. Forcing 'production'
 * would (correctly) trip the weak-JWT-secret boot guard until the secrets are hardened for prod.
 * instances:1 / fork mode is deliberate: the background loops are single-leader (advisory-locked),
 * so do NOT cluster this without the loop-exclusivity guards in place.
 */
module.exports = {
  apps: [
    {
      name: 'wfm-backend',
      script: 'dist/main.js',
      cwd: __dirname,                 // run from backend/ so .env + dist resolve
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 999,
      exp_backoff_restart_delay: 2000, // 2s, 4s, 8s… on a crash loop instead of hammering
      max_memory_restart: '700M',
      min_uptime: 10000,               // must stay up 10s to count as a good start
      kill_timeout: 8000,              // grace for clean SIGTERM shutdown
      watch: false,
      time: true,                      // timestamp every log line
    },
  ],
};
