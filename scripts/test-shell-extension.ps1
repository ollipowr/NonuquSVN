$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-shell-extension.ps1') -Test
