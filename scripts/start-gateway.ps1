$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\.env"

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $index = $line.IndexOf("=")
    if ($index -lt 1) {
      return
    }

    $key = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

node "$PSScriptRoot\..\src\gateway.js"
