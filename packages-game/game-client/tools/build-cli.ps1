$ErrorActionPreference = 'Stop'
$ide = if ($env:LAYA_IDE_DIR) { Join-Path $env:LAYA_IDE_DIR 'LayaAirIDE.exe' } else { 'D:\Program Files\LayaAirIDE\LayaAirIDE.exe' }
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path $ide)) { throw "找不到 LayaAirIDE: $ide" }
Write-Host "IDE=$ide PROJECT=$project"
& $ide "--project=$project" '--script=Build.buildWeb'
$code = $LASTEXITCODE
Write-Host "exit=$code"
# LayaAir 3.x 的 Web 发布产物落在 release\web\，bin\ 只有编译中间产物
$web = Join-Path $project 'release\web\index.html'
$bin = Join-Path $project 'bin\index.html'
if (-not (Test-Path $web) -and -not (Test-Path $bin)) { Write-Host 'WARN: 未生成 release\web\index.html 与 bin\index.html'; exit 2 }
if (Test-Path $web) { Write-Host 'OK: release\web\index.html 已生成' }
if (Test-Path $bin) { Write-Host 'OK: bin\index.html 已生成' }
exit $code