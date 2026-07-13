# WFM Backend — Robust Auto-Restart Supervisor

Keeps `node dist/main.js` alive: restarts on crash (with backoff), self-heals a memory leak,
and comes back after a reboot. Two options — **PM2 is recommended** (Node-native, no external
binary, full logs/monitor). Config: `backend/ecosystem.config.js`.

> **First, stop the manual instance** so it doesn't fight the supervisor for port 3000:
> ```powershell
> Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
>   ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
> ```

---

## Option A — PM2 (recommended)

```powershell
cd "C:\Users\t.bassam\Desktop\WFM System\backend"
npm run build                 # make sure dist/ is current
npm i -g pm2                   # install PM2 (one time)
pm2 start ecosystem.config.js  # launch under the supervisor
pm2 save                       # remember this process across restarts
```

**Boot persistence** (starts automatically after a Windows reboot/login):
```powershell
npm i -g pm2-windows-startup
pm2-startup install
pm2 save
```

**Daily operations:**
```powershell
pm2 status                 # is it up? restarts? memory?
pm2 logs wfm-backend       # live logs (Ctrl+C to exit)
pm2 restart wfm-backend    # after a new build/deploy
pm2 stop wfm-backend       # stop it
pm2 monit                  # live dashboard
```

After a code update: `npm run build; pm2 restart wfm-backend`.

---

## Option B — NSSM (a true Windows Service, starts before login)

More robust for an unattended server, but needs the `nssm.exe` binary
(download from https://nssm.cc, place it somewhere on PATH). Then, in an **admin** shell:

```powershell
nssm install WFM-Backend "C:\Program Files\nodejs\node.exe" "dist\main.js"
nssm set WFM-Backend AppDirectory "C:\Users\t.bassam\Desktop\WFM System\backend"
nssm set WFM-Backend AppExit Default Restart
nssm set WFM-Backend AppStdout "C:\Users\t.bassam\Desktop\WFM System\backend\logs\service.out.log"
nssm set WFM-Backend AppStderr "C:\Users\t.bassam\Desktop\WFM System\backend\logs\service.err.log"
nssm start WFM-Backend
```
Manage: `nssm restart WFM-Backend` · `nssm stop WFM-Backend` · `nssm status WFM-Backend`.

---

## Health check (either option)
```powershell
Invoke-WebRequest http://localhost:3000/api/v1/health -UseBasicParsing | Select StatusCode
```

Once a supervisor owns the process, restart the backend **through the supervisor**
(`pm2 restart` / `nssm restart`) — do NOT `Stop-Process` + relaunch manually, or the
supervisor will fight you by relaunching its own copy.
