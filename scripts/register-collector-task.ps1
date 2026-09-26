# Registers (or replaces) the Windows Scheduled Task that runs the phase 2a
# status collector hourly. Idempotent: safe to re-run. Not run automatically by
# the implementer — the planner runs this after review.
#
# Usage: powershell -File scripts\register-collector-task.ps1

$ErrorActionPreference = 'Stop'

$TaskName = 'CommandCenterCollector'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$NodePath = (Get-Command node).Source
$ScriptPath = Join-Path $RepoRoot 'scripts\collector.mjs'
# SID, not DOMAIN\name: non-ASCII account names can fail to map ("No mapping between account names and security IDs").
$UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value

if (-not (Test-Path $ScriptPath)) {
    throw "collector.mjs not found at $ScriptPath"
}

# conhost --headless keeps node from flashing a console window every hour.
$Action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$NodePath`" `"$ScriptPath`"" -WorkingDirectory $RepoRoot

# No -RepetitionDuration: omitting it repeats indefinitely ([TimeSpan]::MaxValue is rejected on some builds).
$Triggers = @(
    # -User scopes the logon trigger to this account; an all-users logon trigger needs admin.
    New-ScheduledTaskTrigger -AtLogOn -User $UserId
    New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 60)
)

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task '$TaskName'."
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Settings $Settings -Principal $Principal | Out-Null
Write-Host "Registered '$TaskName': every 60 min + at logon, only when $env:USERNAME is logged on, 5 min time limit."
Write-Host "Action: conhost --headless `"$NodePath`" `"$ScriptPath`" (cwd: $RepoRoot)"
