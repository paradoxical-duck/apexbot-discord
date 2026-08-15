$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Read-ProtectedSecret([string]$Path) {
  $secure = ConvertTo-SecureString (Get-Content -LiteralPath $Path -Raw)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$env:DISCORD_TOKEN = Read-ProtectedSecret (Join-Path $root 'artifacts/.discord-token.dpapi')
$env:DISCORD_CLIENT_ID = '1501215133345648801'
try {
  Push-Location $root
  npm run deploy:commands
  if ($LASTEXITCODE -ne 0) { throw "Command registration failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
  $env:DISCORD_TOKEN = $null
}
