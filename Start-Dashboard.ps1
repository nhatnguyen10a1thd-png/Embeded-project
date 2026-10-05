param(
  [ValidateSet("Wokwi", "Http")][string]$Transport = "Wokwi",
  [string]$Esp32Url = "http://192.168.1.100",
  [int]$Port = 8080,
  [int]$SerialPort = 4000,
  [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
# PlatformIO already installs Python: no extra packages or installation required.
$pythonPath = Join-Path $env:USERPROFILE ".platformio\penv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonPath)) {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if (-not $pythonCommand) { throw "Python not found. Install/initialize PlatformIO in VS Code first." }
  $pythonPath = $pythonCommand.Source
}
$serverArgs = @((Join-Path $PSScriptRoot "dashboard_server.py"), "--port", $Port, "--serial-port", $SerialPort)
if ($Transport -eq "Http") { $serverArgs += @("--esp32-url", $Esp32Url) }
if ($NoBrowser) { $serverArgs += "--no-browser" }
& $pythonPath @serverArgs
exit $LASTEXITCODE
