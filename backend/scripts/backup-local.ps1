# WFM local nightly backup — pg_dump -Fc of wfm_db with 14-day rotation.
# Scheduled via Windows Task Scheduler (see deploy/DEPLOY_RUNBOOK.md §backups for the server version).
# Manual run:  powershell -ExecutionPolicy Bypass -File backend\scripts\backup-local.ps1
# Restore:     pg_restore -h localhost -p 5433 -U wfm_user -d wfm_db --clean --if-exists <file>.dump

$ErrorActionPreference = 'Stop'
$RepoRoot   = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # ...\WFM System
$BackupDir  = 'C:\WFM-Backups'
$PgDump     = 'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe'        # match server 16.14
$KeepDays   = 14
$LogFile    = Join-Path $BackupDir 'backup.log'

# read POSTGRES_* from the repo .env (never hardcode credentials here)
$envFile = Join-Path $RepoRoot '.env'
$vars = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*(POSTGRES_[A-Z_]+)\s*=\s*(.*)\s*$') { $vars[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
}
$dbHost = if ($vars['POSTGRES_HOST']) { $vars['POSTGRES_HOST'] } else { 'localhost' }
$dbPort = if ($vars['POSTGRES_PORT']) { $vars['POSTGRES_PORT'] } else { '5433' }
$dbName = if ($vars['POSTGRES_DB'])   { $vars['POSTGRES_DB'] }   else { 'wfm_db' }
$dbUser = if ($vars['POSTGRES_USER']) { $vars['POSTGRES_USER'] } else { 'wfm_user' }
$env:PGPASSWORD = $vars['POSTGRES_PASSWORD']

if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$out   = Join-Path $BackupDir "wfm_db_$stamp.dump"

$t0 = Get-Date
& $PgDump -h $dbHost -p $dbPort -U $dbUser -Fc -f $out $dbName
if ($LASTEXITCODE -ne 0) {
  Add-Content $LogFile "$(Get-Date -Format s)  FAIL  pg_dump exit $LASTEXITCODE"
  exit 1
}
$sizeMb = [math]::Round((Get-Item $out).Length / 1MB, 1)
$secs   = [math]::Round(((Get-Date) - $t0).TotalSeconds)

# rotation: delete dumps older than KeepDays (only our own naming pattern)
Get-ChildItem $BackupDir -Filter 'wfm_db_*.dump' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  ForEach-Object { Remove-Item $_.FullName -Force -Confirm:$false }

$kept = (Get-ChildItem $BackupDir -Filter 'wfm_db_*.dump').Count
Add-Content $LogFile "$(Get-Date -Format s)  OK    $out  ${sizeMb}MB  ${secs}s  kept=$kept"
Write-Output "OK $out (${sizeMb} MB, ${secs}s, kept=$kept)"
