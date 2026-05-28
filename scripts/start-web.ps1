# Launches the Expo web dev server FULLY DETACHED so it survives the agent's
# task lifecycle. Background tasks started by the agent get reaped (exit 127);
# a process created via WMI is owned by the system, not the agent's shell, so
# it keeps running. Output is redirected to web-dev.log at the repo root.

$root = Split-Path $PSScriptRoot -Parent
$log  = Join-Path $root 'web-dev.log'

# Clean (re)start: stop whatever is already listening on port 8081.
$existing = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $existing) {
  Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
}

# Detached launch: the new process is parented to the WMI service, not this shell.
$cmd = 'cmd.exe /c npm run web > "' + $log + '" 2>&1'
$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine      = $cmd
  CurrentDirectory = $root
}

if ($res.ReturnValue -eq 0) {
  Write-Output ("Expo web launched detached (PID " + $res.ProcessId + ").")
  Write-Output ("Logs -> " + $log)
  Write-Output "Open: http://localhost:8081"
} else {
  Write-Output ("Failed to launch (Win32_Process ReturnValue=" + $res.ReturnValue + ")")
}
