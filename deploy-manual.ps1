# One-command deploy for Game Server manual (HTML + Markdown backup)
# ASCII-only script (avoid PS5 ANSI decode issues with CJK literals);
# md filename is resolved from filesystem instead.
$ErrorActionPreference = 'Stop'
$base = 'e:\code\nest'
$src = "$base\manual-src"
$destHtml = 'odoo:/opt/1panel/apps/openresty/openresty/www/sites/game.joho.cn/manual/index.html'
$md = Get-ChildItem "$base\manual\*.md" | Select-Object -First 1
if (-not $md) { Write-Host 'NO MD FILE FOUND'; exit 1 }
$destMd = "odoo:/opt/1panel/apps/openresty/openresty/www/sites/game.joho.cn/manual/$($md.Name)"

Write-Host '[1/5] merge parts -> index.html'
node "$src\merge.js"
if ($LASTEXITCODE -ne 0) { Write-Host 'MERGE FAILED'; exit 1 }

Write-Host '[2/5] consistency check'
node "$src\check.js"
if ($LASTEXITCODE -ne 0) { Write-Host 'CHECK FAILED'; exit 1 }

Write-Host '[3/5] generate markdown backup'
node "$src\html2md.js"
if ($LASTEXITCODE -ne 0) { Write-Host 'MD FAILED'; exit 1 }
$md = Get-ChildItem "$base\manual\*.md" | Select-Object -First 1
$destMd = "odoo:/opt/1panel/apps/openresty/openresty/www/sites/game.joho.cn/manual/$($md.Name)"

Write-Host '[4/5] upload html + md'
scp "$base\manual\index.html" $destHtml
if ($LASTEXITCODE -ne 0) { Write-Host 'UPLOAD HTML FAILED'; exit 1 }
scp $md.FullName $destMd
if ($LASTEXITCODE -ne 0) { Write-Host 'UPLOAD MD FAILED'; exit 1 }

Write-Host '[5/5] verify on server'
$r = ssh odoo "curl -s -o /dev/null -w '%{http_code}' -H 'Host: game.joho.cn' http://127.0.0.1/manual/ && echo / && curl -s -o /dev/null -w '%{http_code}' -H 'Host: game.joho.cn' 'http://127.0.0.1/manual/%E6%B8%B8%E6%88%8F%E6%9C%8D%E5%8A%A1%E5%99%A8%E5%BC%80%E5%8F%91%E6%89%8B%E5%86%8C.md'"
Write-Host "server verify: $r"
if ($r -notmatch '200') { Write-Host 'VERIFY FAILED'; exit 1 }

Write-Host 'DEPLOY OK'
