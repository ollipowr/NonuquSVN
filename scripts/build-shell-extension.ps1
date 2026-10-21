param([switch]$Test)
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio Build Tools with Desktop development with C++.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'The Visual C++ x86/x64 build tools are required.' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvarsall.bat'
$sourceDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\build-resources\shell-extension'))
$resources = Split-Path $sourceDir
foreach ($arch in @('x64', 'x86')) {
    $bits = if ($arch -eq 'x64') { '64' } else { '32' }
    $output = Join-Path $sourceDir "out\$arch"
    [void][IO.Directory]::CreateDirectory($output)
    $dll = Join-Path $resources "NonuquShellExtension$bits.dll"
    $compile = 'call "{0}" {1} >nul && cl /nologo /std:c++17 /EHsc /W4 /O2 /MT /utf-8 /DUNICODE /D_UNICODE /LD "{2}\NonuquShellExtension.cpp" /link /DEF:"{2}\NonuquShellExtension.def" /OUT:"{3}" user32.lib shell32.lib ole32.lib uuid.lib' -f $vcvars, $arch, $sourceDir, $dll
    Push-Location $output
    try {
        $header = "@echo off`r`nset `"PATH=$(Split-Path $vswhere);%PATH%`"`r`n"
        Set-Content -LiteralPath 'build.cmd' -Value ($header + $compile) -Encoding Default
        & $env:ComSpec /d /c .\build.cmd
        if ($LASTEXITCODE -ne 0) { throw "Native shell extension build failed ($arch)." }
        if ($Test) {
            $testExe = Join-Path $output 'shell-extension-test.exe'
            $compileTest = 'call "{0}" {1} >nul && cl /nologo /std:c++17 /EHsc /W4 /MT /utf-8 /DUNICODE /D_UNICODE "{2}\ShellExtension.test.cpp" /Fe:"{3}" /link user32.lib shell32.lib ole32.lib uuid.lib' -f $vcvars, $arch, $sourceDir, $testExe
            Set-Content -LiteralPath 'test-build.cmd' -Value ($header + $compileTest) -Encoding Default
            & $env:ComSpec /d /c .\test-build.cmd
            if ($LASTEXITCODE -ne 0) { throw "Native shell test build failed ($arch)." }
            & $testExe $dll
            if ($LASTEXITCODE -ne 0) { throw "Native shell tests failed ($arch)." }
        }
    } finally { Pop-Location }
    Write-Host "Built $dll"
}
