$ErrorActionPreference = 'Stop'
$base = 'e:\code\nest\manual-src'

# ---- 解析字段说明 ----
$desc = @{}
foreach ($line in Get-Content "$base\fields-desc.txt" -Encoding UTF8) {
  if ($line -match '^([^|]+)\|([^|]+)\|(.+)$') {
    $desc["$($Matches[1])|$($Matches[2])"] = $Matches[3]
  }
}

# ---- 解析数据库字典 ----
$rows = @{}
foreach ($line in Get-Content "$base\dict.txt" -Encoding UTF8) {
  $line = $line.TrimStart([char]0xFEFF)
  if ($line -match '^([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|(.*)$') {
    $t = $Matches[1]; $c = $Matches[2]; $dt = $Matches[3]; $udt = $Matches[4]; $nn = $Matches[5]; $def = $Matches[6]
    if (-not $rows.ContainsKey($t)) { $rows[$t] = @() }
    $rows[$t] += @{ col = $c; type = $dt; udt = $udt; nn = $nn; def = $def }
  }
}

function Get-FieldType($r) {
  $t = $r.type; $udt = $r.udt
  if ($t -eq 'USER-DEFINED') { return ($udt -replace '^.*?_','' -replace '_enum$','') + ' 枚举' }
  if ($t -eq 'ARRAY') { return 'int[]' }
  switch ($t) {
    'character varying' { return 'varchar' }
    'integer' { return 'int' }
    'timestamp without time zone' { return 'timestamp' }
    'double precision' { return 'float8' }
    'bigint' { return 'bigint' }
    'boolean' { return 'bool' }
    'jsonb' { return 'jsonb' }
    'numeric' { return 'numeric' }
    'text' { return 'text' }
    'date' { return 'date' }
    default { return $t }
  }
}

function Get-FieldDefault($r) {
  $d = $r.def
  if ([string]::IsNullOrWhiteSpace($d)) { return '' }
  $d = $d -replace '^''','' -replace '''$',''
  if ($d -match 'nextval') { return '自增' }
  if ($d -match '^now\(\)') { return 'now()' }
  if ($d.Length -gt 40) { $d = $d.Substring(0,40) + '…' }
  return $d
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('<section class="dict-chapter" id="chapter16">')
[void]$sb.AppendLine('<h2 class="ch-title">第 16 章 · 数据字典全集</h2>')
[void]$sb.AppendLine('<p class="ch-desc">共 64 张表、602 个字段。字段类型与默认值取自生产库 <code>game_server</code> 实际结构；说明按源码实体语义整理。枚举类型取值详见<b>附录 B 枚举全集</b>。</p>')
[void]$sb.AppendLine('<div class="dict-toc">')
foreach ($t in ($rows.Keys | Sort-Object)) {
  $cnt = $rows[$t].Count
  $anchor = $t
  [void]$sb.AppendLine("<a href='#dict-$anchor'>$t ($cnt)</a>")
}
[void]$sb.AppendLine('</div>')

foreach ($t in ($rows.Keys | Sort-Object)) {
  $cnt = $rows[$t].Count
  [void]$sb.AppendLine("<div class='dict-table' id='dict-$t'>")
  [void]$sb.AppendLine("<h3>📄 $t <span class='tbl-meta'>$cnt 字段</span></h3>")
  [void]$sb.AppendLine('<table><thead><tr><th>列名</th><th>类型</th><th>可空</th><th>默认值</th><th>说明</th></tr></thead><tbody>')
  foreach ($r in $rows[$t]) {
    $descKey = "$t|$($r.col)"
    $d = ''
    if ($desc.ContainsKey($descKey)) { $d = $desc[$descKey] }
    $nullText = if ($r.nn -eq 'YES') { '是' } else { '否' }
    $defText = Get-FieldDefault $r
    $typeText = Get-FieldType $r
    [void]$sb.AppendLine("<tr><td><code>$($r.col)</code></td><td>$typeText</td><td>$nullText</td><td>$defText</td><td>$d</td></tr>")
  }
  [void]$sb.AppendLine('</tbody></table></div>')
}
[void]$sb.AppendLine('</section>')
[System.IO.File]::WriteAllText("$base\dict-part.html", $sb.ToString(), [System.Text.Encoding]::UTF8)
echo "DICT_OK: $($rows.Count) tables"
