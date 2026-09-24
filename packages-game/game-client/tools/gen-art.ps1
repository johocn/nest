# gen-art.ps1 — 程序化生成 S9 美术素材（实体 @2x PNG-32 + 背景 PNG）+ 配套 .meta
#
# 依赖：Windows 自带 System.Drawing（零新依赖）。
# 落盘：assets/resources/<resKey>.png（resKey 原文即相对路径），尺寸/透明通道见 docs/art-handover.md §3。
# 用法：powershell -ExecutionPolicy Bypass -File tools/gen-art.ps1 [-BgScale 2]
param([int]$BgScale = 2)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\assets\resources')).Path

# ---------- 基础工具 ----------

function Col([string]$hex, [int]$a = 255) {
  $h = $hex.TrimStart('#')
  $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
  $g2 = [Convert]::ToInt32($h.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
  return [System.Drawing.Color]::FromArgb($a, $r, $g2, $b)
}

function Brsh([string]$hex, [int]$a = 255) {
  return [System.Drawing.SolidBrush]::new((Col $hex $a))
}

function PnOf([string]$hex, [double]$w, [int]$a = 255) {
  $p = [System.Drawing.Pen]::new((Col $hex $a), [float]$w)
  $p.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $p.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $p.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  return $p
}

function PathOf([string]$s) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $list = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
  foreach ($pair in ($s -split ';')) {
    $xy = $pair -split ','
    $list.Add([System.Drawing.PointF]::new([float]$xy[0], [float]$xy[1]))
  }
  $path.AddPolygon($list.ToArray())
  return $path
}

function Ell($g, [double]$x, [double]$y, [double]$w, [double]$h, [string]$hex, [int]$a = 255) {
  $b = Brsh $hex $a
  $g.FillEllipse($b, [float]$x, [float]$y, [float]$w, [float]$h)
  $b.Dispose()
}

function EllS($g, [double]$x, [double]$y, [double]$w, [double]$h, [string]$hex, [double]$pw, [int]$a = 255) {
  $p = PnOf $hex $pw $a
  $g.DrawEllipse($p, [float]$x, [float]$y, [float]$w, [float]$h)
  $p.Dispose()
}

function EllF($g, [double]$x, [double]$y, [double]$w, [double]$h, [string]$fill, [string]$stroke = '#5B4A3A', [double]$pw = 1.4) {
  Ell $g $x $y $w $h $fill
  if ($pw -gt 0) { EllS $g $x $y $w $h $stroke $pw }
}

function Rct($g, [double]$x, [double]$y, [double]$w, [double]$h, [string]$hex, [int]$a = 255) {
  $b = Brsh $hex $a
  $g.FillRectangle($b, [float]$x, [float]$y, [float]$w, [float]$h)
  $b.Dispose()
}

function RctS($g, [double]$x, [double]$y, [double]$w, [double]$h, [string]$hex, [double]$pw, [int]$a = 255) {
  $p = PnOf $hex $pw $a
  $g.DrawRectangle($p, [float]$x, [float]$y, [float]$w, [float]$h)
  $p.Dispose()
}

function RctF($g, [double]$x, [double]$y, [double]$w, [double]$h, [string]$fill, [string]$stroke = '#5B4A3A', [double]$pw = 1.4) {
  Rct $g $x $y $w $h $fill
  if ($pw -gt 0) { RctS $g $x $y $w $h $stroke $pw }
}

function Ln($g, [double]$x1, [double]$y1, [double]$x2, [double]$y2, [string]$hex, [double]$pw, [int]$a = 255) {
  $p = PnOf $hex $pw $a
  $g.DrawLine($p, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
  $p.Dispose()
}

function Fill-Poly($g, [string]$s, [string]$hex, [int]$a = 255) {
  $p = PathOf $s
  $b = Brsh $hex $a
  $g.FillPath($b, $p)
  $b.Dispose(); $p.Dispose()
}

function Stroke-Poly($g, [string]$s, [string]$hex, [double]$pw, [int]$a = 255) {
  $p = PathOf $s
  $pen = PnOf $hex $pw $a
  $g.DrawPath($pen, $p)
  $pen.Dispose(); $p.Dispose()
}

# 圆头宽笔触（地面小径）：沿折线按步长盖圆，得到平滑缎带
function Ribbon($g, [string]$s, [double]$w, [string]$hex, [int]$a = 255) {
  $xs = @(); $ys = @()
  foreach ($pair in ($s -split ';')) {
    $xy = $pair -split ','
    $xs += [double]$xy[0]; $ys += [double]$xy[1]
  }
  for ($i = 0; $i -lt $xs.Count - 1; $i++) {
    for ($t = 0.0; $t -le 1.0; $t += 0.07) {
      $x = $xs[$i] + ($xs[$i + 1] - $xs[$i]) * $t
      $y = $ys[$i] + ($ys[$i + 1] - $ys[$i]) * $t
      Ell $g ($x - $w / 2) ($y - $w / 2) $w $w $hex $a
    }
  }
}

# 确定性伪随机（保证每次生成逐像素一致）
$script:RngState = 20260924
function Rnd([double]$min, [double]$max) {
  $script:RngState = (1103515245 * $script:RngState + 12345) % 2147483648
  $v = [double]$script:RngState / 2147483648.0
  return $min + ($max - $min) * $v
}

function Canvas([int]$w, [int]$h, [string]$baseHex = '') {
  $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  if ($baseHex -ne '') { $fmt = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
  $bmp = [System.Drawing.Bitmap]::new($w, $h, $fmt)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($baseHex -eq '') { $g.Clear([System.Drawing.Color]::Transparent) } else { $g.Clear((Col $baseHex)) }
  return @{ bmp = $bmp; g = $g }
}

function Save-Art($c, [string]$rel) {
  $w = $c.bmp.Width; $h = $c.bmp.Height
  $c.g.Dispose()
  $path = Join-Path $root ($rel -replace '/', '\')
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $c.bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $c.bmp.Dispose()
  $uuid = [guid]::NewGuid().ToString()
  $txt = "{`n  `"uuid`": `"$uuid`",`n  `"importer`": {`n    `"textureType`": 2,`n    `"sRGB`": true,`n    `"generateMipmap`": true`n  }`n}"
  [System.IO.File]::WriteAllText("$path.meta", $txt, [System.Text.UTF8Encoding]::new($false))
  $kb = [math]::Round((Get-Item $path).Length / 1KB, 1)
  Write-Output ("OK  {0,-34} {1}x{2}  {3} KB" -f $rel, $w, $h, $kb)
}

# ---------- 调色板（治愈系国风 · 低饱和） ----------
$P = @{
  line = '#5B4A3A'; skin = '#F0D6BC'; skinS = '#D9B491'
  hair = '#4A3B30'; gray = '#D5D0C7'; white = '#F6F2EA'
  blue = '#88A6BE'; blueD = '#6B8AA4'
  green = '#8FB487'; greenD = '#6E9468'; greenL = '#A9C9A0'
  earth = '#C7A87F'; earthD = '#A98A63'
  wood = '#B98F63'; woodD = '#8E6A45'; woodL = '#CBA97F'
  stoneL = '#C6C4BA'; stone = '#ABAA9F'; stoneD = '#8C8B80'
  gold = '#D9B45E'; goldD = '#B4923F'
  red = '#C67A6D'; roof = '#8E6F63'; roofD = '#6F554B'; roofL = '#A88A7E'
  plaster = '#E3D2AF'; glass = '#BFD4D6'
  grass = '#9CBB8D'; dirt = '#C9A87F'; dirtD = '#AE8C61'; dirtL = '#D8BF9A'
  water = '#9FC0C6'; waterD = '#87AEB6'; waterL = '#B4D2D7'
}

function Shadow($g, [double]$x, [double]$y, [double]$w, [double]$h) { Ell $g $x $y $w $h '#2A241E' 46 }

# ---------- 实体：玩家 72x72（逻辑 36） ----------
function Draw-Player($g) {
  Shadow $g 22 63 28 8
  RctF $g 28 60 8 6 $P.hair $P.line 1.2
  RctF $g 37 60 8 6 $P.hair $P.line 1.2
  Fill-Poly $g '36,24;51,40;56,62;16,62;21,40' $P.blue
  Stroke-Poly $g '36,24;51,40;56,62;16,62;21,40' $P.line 1.6
  Fill-Poly $g '54,55;56.5,62;15.5,62;18,55' $P.blueD
  Fill-Poly $g '20,43;52,43;53,49;19,49' $P.red
  EllF $g 10 35 16 23 $P.blueD
  EllF $g 46 35 16 23 $P.blueD
  EllF $g 19 52 9 9 $P.skin $P.skinS 1.1
  EllF $g 45 52 9 9 $P.skin $P.skinS 1.1
  EllF $g 25 9 22 22 $P.skin $P.skinS 1.4
  EllF $g 23 4 26 17 $P.hair
  EllF $g 22 15 8 15 $P.hair
  EllF $g 42 15 8 15 $P.hair
  EllF $g 31 1 10 8 $P.hair
  EllF $g 36 30 11 12 $P.white '' 0
  Fill-Poly $g '36,30;41.5,34;36,41;30.5,34' $P.blue
  Ell $g 31 19 2.6 3.4 $P.hair
  Ell $g 39 19 2.6 3.4 $P.hair
  Ell $g 27 23 6 3.4 $P.red 90
  Ell $g 41 23 6 3.4 $P.red 90
}

# ---------- 实体：长老 64x64（逻辑 32） ----------
function Draw-Elder($g) {
  Shadow $g 18 57 28 7
  Ln $g 51 13 51 59 $P.woodD 3.6
  EllF $g 46 7 10 10 $P.gold $P.goldD 1.3
  Fill-Poly $g '32,22;44,36;49,60;15,60;20,36' $P.earth
  Stroke-Poly $g '32,22;44,36;49,60;15,60;20,36' $P.line 1.6
  Fill-Poly $g '47,54;49,60;15,60;17,54' $P.earthD
  EllF $g 8 33 14 19 $P.earthD
  EllF $g 18 47 9 9 $P.skin $P.skinS 1.1
  EllF $g 44 38 9 9 $P.skin $P.skinS 1.1
  EllF $g 23 9 19 19 $P.skin $P.skinS 1.4
  EllF $g 21 5 23 14 $P.gray
  EllF $g 28 1 9 8 $P.gray
  Fill-Poly $g '24,19;40,19;38,37;32,44;26,37' $P.white
  Stroke-Poly $g '24,19;40,19;38,37;32,44;26,37' $P.gray 1.1
  Ln $g 26 14 31 13 $P.gray 1.6
  Ln $g 33 13 38 14 $P.gray 1.6
  Ell $g 27 17 2.4 3 $P.hair
  Ell $g 35 17 2.4 3 $P.hair
}

# ---------- 实体：铁匠 64x64 ----------
function Draw-Smith($g) {
  Shadow $g 18 57 28 7
  Fill-Poly $g '32,24;45,38;48,60;16,60;19,38' '#6E5B4B'
  Stroke-Poly $g '32,24;45,38;48,60;16,60;19,38' $P.line 1.6
  Fill-Poly $g '26,38;38,38;40,60;24,60' $P.woodD
  Stroke-Poly $g '26,38;38,38;40,60;24,60' $P.line 1.2
  EllF $g 9 33 14 19 '#8C7A66'
  EllF $g 43 34 14 19 '#8C7A66'
  Ln $g 52 30 55 58 $P.wood 3.6
  Fill-Poly $g '44,18;59,22;56,30;41,25' $P.stone
  Stroke-Poly $g '44,18;59,22;56,30;41,25' $P.stoneD 1.4
  EllF $g 18 47 9 9 $P.skin $P.skinS 1.1
  EllF $g 49 37 9 9 $P.skin $P.skinS 1.1
  EllF $g 23 9 19 19 $P.skin $P.skinS 1.4
  EllF $g 21 5 23 14 $P.hair
  Rct $g 21 13 23 4.5 $P.red
  Ell $g 31 8 5 4 $P.red
  Ell $g 27 18 2.4 3 $P.hair
  Ell $g 35 18 2.4 3 $P.hair
}

# ---------- 实体：货郎 64x64 ----------
function Draw-Peddler($g) {
  Shadow $g 18 57 28 7
  Fill-Poly $g '32,26;44,38;48,60;16,60;20,38' $P.green
  Stroke-Poly $g '32,26;44,38;48,60;16,60;20,38' $P.line 1.6
  Fill-Poly $g '46,54;48,60;16,60;18,54' $P.greenD
  Fill-Poly $g '20,42;46,42;47,48;19,48' $P.earth
  EllF $g 10 37 13 18 $P.greenD
  EllF $g 40 38 13 18 $P.greenD
  EllF $g 24 15 17 17 $P.skin $P.skinS 1.4
  EllF $g 12 22 40 9 $P.earth
  Ln $g 12 22 50 22 $P.earthD 1.3
  Fill-Poly $g '32,7;15,25;49,25' $P.earthD
  Stroke-Poly $g '32,7;15,25;49,25' $P.line 1.4
  RctF $g 42 42 16 15 $P.woodL $P.line 1.3
  EllS $g 44 34 12 14 $P.woodD 2
  Ell $g 46 46 8 6 $P.earthD
  EllF $g 19 50 8 8 $P.skin $P.skinS 1.1
  EllF $g 45 40 8 8 $P.skin $P.skinS 1.1
  Ell $g 28 20 2.2 2.8 $P.hair
  Ell $g 36 20 2.2 2.8 $P.hair
}

# ---------- 实体：草药 64x64 ----------
function Draw-Plant($g) {
  Shadow $g 18 50 28 8
  Ln $g 32 52 32 40 $P.greenD 2.4
  EllF $g 6 31 24 21 $P.greenD
  EllF $g 34 31 24 21 $P.green
  EllF $g 12 25 40 27 $P.green
  EllF $g 18 19 28 20 $P.greenL
  Ell $g 21 36 5.4 5.4 $P.red
  Ell $g 32 30 5.4 5.4 $P.red
  Ell $g 41 40 4.6 4.6 $P.red
  Ell $g 26 44 4.2 4.2 $P.gold
  Ell $g 37 47 3.6 3.6 $P.gold
}

# ---------- 实体：矿石 64x64 ----------
function Draw-Stone($g) {
  Shadow $g 13 47 34 9
  Fill-Poly $g '12,51;19,30;32,24;46,33;51,51' $P.stone
  Stroke-Poly $g '12,51;19,30;32,24;46,33;51,51' $P.line 1.6
  Fill-Poly $g '20,33;32,25;37,30;26,42' $P.stoneL
  Fill-Poly $g '36,33;46,34;50,51;34,51' $P.stoneD 150
  Ln $g 32 25 32 51 $P.stoneD 1.1 120
  EllF $g 10 47 10 7 $P.stone $P.line 1.2
  EllF $g 45 47 11 7 $P.stone $P.line 1.2
}

# ---------- 实体：宝箱 64x64 ----------
function Draw-Chest($g) {
  Shadow $g 13 45 38 10
  RctF $g 13 31 38 21 $P.wood $P.line 1.5
  Fill-Poly $g '13,32;17,23;24,18;40,18;47,23;51,32' $P.woodD
  Stroke-Poly $g '13,32;17,23;24,18;40,18;47,23;51,32' $P.line 1.5
  Rct $g 17 21 5 31 $P.goldD
  Rct $g 42 21 5 31 $P.goldD
  Rct $g 13 30 38 3.6 $P.gold
  Rct $g 14 33 36 2.8 $P.woodL 120
  RctF $g 27 33 10 11 $P.gold $P.goldD 1.2
  Ell $g 30 37 4 4.4 $P.hair
  Ln $g 32 39 32 42 $P.hair 1.6
}

# ---------- 实体：路牌 64x64 ----------
function Draw-Landmark($g) {
  Shadow $g 19 49 26 8
  EllF $g 16 43 15 10 $P.stone $P.line 1.2
  EllF $g 36 44 13 9 $P.stone $P.line 1.2
  RctF $g 28 22 8 30 $P.wood $P.line 1.4
  RctF $g 8 10 47 17 $P.woodL $P.line 1.6
  Ln $g 15 18 27 18 $P.earthD 2.2
  Ln $g 32 18 38 18 $P.earthD 2.2
  Ln $g 43 18 49 18 $P.earthD 2.2
  Ell $g 12 14 3 3 $P.goldD
  Ell $g 51 14 3 3 $P.goldD
}

# ---------- 建筑：石墙 64x64（占地 1x1） ----------
function Draw-StoneWall($g) {
  RctF $g 2 16 60 46 $P.stone $P.line 1.6
  Rct $g 3 17 58 8 $P.stoneL
  Ln $g 3 25 61 25 $P.stoneD 1.4 170
  Ln $g 3 40 61 40 $P.stoneD 1.4 170
  Ln $g 3 58 61 58 $P.stoneD 1.4 170
  Ln $g 22 25 22 40 $P.stoneD 1.3 170
  Ln $g 42 25 42 40 $P.stoneD 1.3 170
  Ln $g 12 40 12 58 $P.stoneD 1.3 170
  Ln $g 32 40 32 58 $P.stoneD 1.3 170
  Ln $g 52 40 52 58 $P.stoneD 1.3 170
  Ln $g 20 17 20 25 $P.stoneD 1.3 170
  Ln $g 44 17 44 25 $P.stoneD 1.3 170
  Rct $g 4 18 56 2 $P.white 70
}

# ---------- 建筑：木屋 128x128（占地 2x2） ----------
function Draw-WoodenHouse($g) {
  Shadow $g 16 106 96 16
  RctF $g 30 56 68 52 $P.plaster $P.line 1.7
  Rct $g 28 56 5 52 $P.wood
  Rct $g 95 56 5 52 $P.wood
  Ln $g 64 56 64 108 $P.woodD 1.8
  Ln $g 30 82 98 82 $P.woodD 1.8
  RctF $g 54 81 21 27 $P.woodD $P.line 1.5
  Ell $g 70 95 4 4 $P.gold
  RctF $g 35 63 18 15 $P.glass $P.woodD 1.6
  Ln $g 44 63 44 78 $P.woodD 1.4
  Ln $g 35 70.5 53 70.5 $P.woodD 1.4
  RctF $g 75 63 18 15 $P.glass $P.woodD 1.6
  Ln $g 84 63 84 78 $P.woodD 1.4
  Ln $g 75 70.5 93 70.5 $P.woodD 1.4
  RctF $g 91 24 15 30 $P.stone $P.line 1.4
  Rct $g 89 22 19 5 $P.stoneL
  Fill-Poly $g '9,61;64,15;119,61' $P.roof
  Stroke-Poly $g '9,61;64,15;119,61' $P.line 2
  Fill-Poly $g '9,61;64,15;64,61' $P.roofL 70
  Fill-Poly $g '9,61;119,61;113,69;15,69' $P.roofD
  Stroke-Poly $g '9,61;119,61;113,69;15,69' $P.line 1.6
  Ln $g 64 16 64 60 $P.roofD 1.4 120
}

# ---------- 建筑：议事厅 192x192（占地 3x3） ----------
function Draw-TownHall($g) {
  Shadow $g 24 162 144 22
  RctF $g 34 132 124 34 $P.plaster $P.line 1.8
  Rct $g 34 100 124 38 '#D9C6A0'
  RctF $g 42 98 11 40 $P.stoneL $P.line 1.4
  RctF $g 68 98 11 40 $P.stoneL $P.line 1.4
  RctF $g 94 98 11 40 $P.stoneL $P.line 1.4
  RctF $g 120 98 11 40 $P.stoneL $P.line 1.4
  RctF $g 146 98 11 40 $P.stoneL $P.line 1.4
  Fill-Poly $g '16,104;96,52;176,104' $P.roof
  Stroke-Poly $g '16,104;96,52;176,104' $P.line 2
  Fill-Poly $g '16,104;96,52;96,104' $P.roofL 65
  Fill-Poly $g '46,78;96,30;146,78' $P.roof
  Stroke-Poly $g '46,78;96,30;146,78' $P.line 2
  Fill-Poly $g '46,78;96,30;96,78' $P.roofL 65
  Fill-Poly $g '16,104;176,104;168,114;24,114' $P.roofD
  Stroke-Poly $g '16,104;176,104;168,114;24,114' $P.line 1.7
  Fill-Poly $g '46,78;146,78;140,86;52,86' $P.roofD
  EllF $g 90 20 12 12 $P.gold $P.goldD 1.4
  RctF $g 83 130 26 36 $P.woodD $P.line 1.6
  Ln $g 96 130 96 166 $P.line 1.3 200
  Ell $g 102 148 3.6 3.6 $P.gold
  RctF $g 50 114 16 14 $P.glass $P.woodD 1.5
  RctF $g 126 114 16 14 $P.glass $P.woodD 1.5
  RctF $g 24 158 144 10 $P.stone $P.line 1.4
  RctF $g 20 167 152 9 $P.stoneD $P.line 1.2
}

# ---------- 背景：bg_scene1（1280x960 逻辑 → @BgScale） ----------
function Draw-Bg($g) {
  # 注意：PowerShell 变量名大小写不敏感，地图尺寸必须用 MW/MH，避免被循环里的 $w/$h 覆盖
  $MW = 1280.0; $MH = 960.0
  Rct $g 0 0 $MW $MH $P.grass
  # 草地色斑
  $tones = @($P.grass, '#93B384', '#A6C497', '#8FAE81', '#A9C79A')
  for ($i = 0; $i -lt 190; $i++) {
    $cx = Rnd -80 ($MW + 80); $cy = Rnd -80 ($MH + 80)
    $w = Rnd 50 150; $h = $w * (Rnd 0.55 0.9)
    $ti = [int](Rnd 0 5)
    if ($ti -gt 4) { $ti = 4 }
    if ($ti -lt 0) { $ti = 0 }
    $t = $tones[$ti]
    $ta = [int](Rnd 30 58)
    Ell $g ($cx - $w / 2) ($cy - $h / 2) $w $h $t $ta
  }
  # 边缘压暗
  for ($i = 0; $i -lt 70; $i++) {
    $edge = [int](Rnd 0 4)
    if ($edge -eq 0) { $cx = Rnd -60 180; $cy = Rnd -60 ($MH + 60) }
    elseif ($edge -eq 1) { $cx = Rnd ($MW - 180) ($MW + 60); $cy = Rnd -60 ($MH + 60) }
    elseif ($edge -eq 2) { $cx = Rnd -60 ($MW + 60); $cy = Rnd -60 160 }
    else { $cx = Rnd -60 ($MW + 60); $cy = Rnd ($MH - 160) ($MH + 60) }
    $w = Rnd 90 200; $h = $w * (Rnd 0.6 0.95)
    $ea = [int](Rnd 20 40)
    Ell $g ($cx - $w / 2) ($cy - $h / 2) $w $h $P.greenD $ea
  }
  # 村中广场（入口点 640,480）
  Ell $g 440 340 400 280 '#D8C69E' 235
  EllS $g 440 340 400 280 '#BFAE86' 3 200
  EllS $g 500 390 280 180 '#C9B790' 2 170
  for ($i = 0; $i -lt 16; $i++) {
    $a = $i * 0.3927
    $x = 640 + [math]::Cos($a) * 140
    $y = 480 + [math]::Sin($a) * 90
    Ell $g ($x - 10) ($y - 7) 20 14 '#C2AE84' 175
  }
  # 主路（广场 → 右下）
  Ribbon $g '640,600;650,720;720,830;850,900;1030,935;1300,950' 62 $P.dirtD 150
  Ribbon $g '640,600;650,720;720,830;850,900;1030,935;1300,950' 50 $P.dirt 220
  Ribbon $g '640,600;650,720;720,830;850,900;1030,935;1300,950' 34 $P.dirtL 190
  # 支路（广场 → 左下）
  Ribbon $g '560,520;430,570;310,660;180,690;20,700' 48 $P.dirtD 150
  Ribbon $g '560,520;430,570;310,660;180,690;20,700' 38 $P.dirt 220
  Ribbon $g '560,520;430,570;310,660;180,690;20,700' 24 $P.dirtL 190
  # 池塘（左下，避开实体出生点）
  Fill-Poly $g '120,845;150,782;235,752;325,772;372,838;350,905;255,930;165,912' $P.water
  Stroke-Poly $g '120,845;150,782;235,752;325,772;372,838;350,905;255,930;165,912' $P.waterD 4
  Ell $g 175 800 140 90 $P.waterL 150
  EllS $g 175 800 140 90 $P.waterD 2 120
  Fill-Poly $g '150,860;200,845;235,868;200,882' $P.greenL 200
  Fill-Poly $g '265,835;305,828;318,855;275,862' $P.greenL 200
  Ell $g 235 862 10 8 $P.green 210
  Ln $g 196 856 202 856 $P.white 2 120
  Ln $g 286 840 292 840 $P.white 2 120
  # 芦苇
  Ln $g 138 790 132 764 $P.greenD 2.2
  Ln $g 148 786 146 758 $P.greenD 2.2
  Ln $g 158 784 160 756 $P.greenD 2.2
  Ln $g 340 882 346 858 $P.greenD 2.2
  Ln $g 352 890 360 868 $P.greenD 2.2
  # 零散小花草（低对比，不干扰实体）
  for ($i = 0; $i -lt 120; $i++) {
    $x = Rnd 40 ($MW - 40); $y = Rnd 40 ($MH - 40)
    $d = Rnd 3 6
    $c = $P.white
    if ((Rnd 0 1) -gt 0.55) { $c = $P.gold }
    $fa = [int](Rnd 110 180)
    Ell $g $x $y $d $d $c $fa
  }
}

# ---------- 主流程 ----------
$specs = @(
  @{ rel = 'player_default.png'; w = 72; h = 72; draw = 'Draw-Player' }
  @{ rel = 'obj/plant_01.png'; w = 64; h = 64; draw = 'Draw-Plant' }
  @{ rel = 'obj/stone_01.png'; w = 64; h = 64; draw = 'Draw-Stone' }
  @{ rel = 'obj/chest_01.png'; w = 64; h = 64; draw = 'Draw-Chest' }
  @{ rel = 'obj/landmark_01.png'; w = 64; h = 64; draw = 'Draw-Landmark' }
  @{ rel = 'npc/elder_01.png'; w = 64; h = 64; draw = 'Draw-Elder' }
  @{ rel = 'npc_smith_01.png'; w = 64; h = 64; draw = 'Draw-Smith' }
  @{ rel = 'npc/peddler_01.png'; w = 64; h = 64; draw = 'Draw-Peddler' }
  @{ rel = 'building/stone_wall.png'; w = 64; h = 64; draw = 'Draw-StoneWall' }
  @{ rel = 'building/wooden_house.png'; w = 128; h = 128; draw = 'Draw-WoodenHouse' }
  @{ rel = 'building/town_hall.png'; w = 192; h = 192; draw = 'Draw-TownHall' }
)

Write-Output ("root = {0}" -f $root)
foreach ($s in $specs) {
  $c = Canvas $s.w $s.h
  & $s.draw $c.g
  Save-Art $c $s.rel
}

$c = Canvas ([int](1280 * $BgScale)) ([int](960 * $BgScale)) $P.grass
$c.g.ScaleTransform([float]$BgScale, [float]$BgScale)
Draw-Bg $c.g
Save-Art $c 'bg_scene1.png'

Write-Output "生成完毕。"