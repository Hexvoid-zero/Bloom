$ErrorActionPreference='Stop'
$voiceRoot=Join-Path $env:LOCALAPPDATA 'com.sehaz.bloom\voice'
[IO.Directory]::CreateDirectory($voiceRoot) | Out-Null
$voiceZip=Join-Path $voiceRoot 'engine.zip'
$voiceModel=Join-Path $voiceRoot 'ggml-base.bin'
function Get-VerifiedVoiceFile([string]$url,[string]$path,[string]$expected) {
  if ((Test-Path -LiteralPath $path) -and ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected)) { return }
  $pending=$path+'.partial'
  & "$env:SystemRoot\System32\curl.exe" --fail --location --max-time 600 --retry 2 --output $pending $url
  if ($LASTEXITCODE -ne 0) { throw 'Speech engine download failed. Check your connection and retry.' }
  if ((Get-FileHash -LiteralPath $pending -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Speech engine checksum did not match.' }
  Move-Item -LiteralPath $pending -Destination $path -Force
}
Get-VerifiedVoiceFile 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip' $voiceZip 'd824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d'
Get-VerifiedVoiceFile 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' $voiceModel '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
Expand-Archive -LiteralPath $voiceZip -DestinationPath (Join-Path $voiceRoot 'engine') -Force
