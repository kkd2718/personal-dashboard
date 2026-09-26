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

if (-not (Test-Path $ScriptPath)) {
    throw "collector.mjs not found at $ScriptPath"
}

$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$ScriptPath`"" -WorkingDirectory $RepoRoot

$Triggers = @(
    New-ScheduledTaskTrigger -AtLogOn
    New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 60) -RepetitionDuration ([TimeSpan]::MaxValue)
)

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task '$TaskName'."
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Settings $Settings -Principal $Principal | Out-Null
Write-Host "Registered '$TaskName': every 60 min + at logon, only when $env:USERNAME is logged on, 5 min time limit."
Write-Host "Action: `"$NodePath`" `"$ScriptPath`" (cwd: $RepoRoot)"
