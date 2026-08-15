param(
  [int]$PreviousPid = 0
)

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
$env:GEMINI_API_KEY = Read-ProtectedSecret (Join-Path $root 'artifacts/.gemini-key.dpapi')
$env:DISCORD_CLIENT_ID = '1501215133345648801'
$env:AI_PROVIDER = 'gemini'
$env:GEMINI_MODEL = 'gemini-2.5-flash'
$env:PORT = '8080'
$env:NODE_ENV = 'production'
$env:FIREBASE_PROJECT_ID = 'apexbot-discord'
$secretBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
$env:COOKIE_SECRET = [Convert]::ToBase64String($secretBytes)

if ($PreviousPid -gt 0) {
  $previous = Get-Process -Id $PreviousPid -ErrorAction SilentlyContinue
  if ($previous) {
    Stop-Process -Id $PreviousPid
    Wait-Process -Id $PreviousPid -ErrorAction SilentlyContinue
  }
}

$artifacts = Join-Path $root 'artifacts'
$process = Start-Process `
  -FilePath 'C:\Program Files\nodejs\node.exe' `
  -ArgumentList 'dist/index.js' `
  -WorkingDirectory (Join-Path $root 'apps/bot') `
  -RedirectStandardOutput (Join-Path $artifacts 'bot-live.out.log') `
  -RedirectStandardError (Join-Path $artifacts 'bot-live.err.log') `
  -WindowStyle Hidden `
  -PassThru

$env:DISCORD_TOKEN = $null
$env:GEMINI_API_KEY = $null
$env:COOKIE_SECRET = $null

[pscustomobject]@{ ProcessId = $process.Id }
