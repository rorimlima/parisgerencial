# Gera ícones PWA usando .NET System.Drawing (nativo no Windows)
# Não requer npm, node_modules ou dependências externas

Add-Type -AssemblyName System.Drawing

$projectDir = $PSScriptRoot
$sourceFile = Join-Path $projectDir "public\icons\icon-source.jpg"
$outputDir  = Join-Path $projectDir "public\icons"

if (-not (Test-Path $sourceFile)) {
    Write-Error "Arquivo não encontrado: $sourceFile"
    exit 1
}

# Carrega a imagem fonte
$src = [System.Drawing.Image]::FromFile($sourceFile)

$sizes = @(72, 96, 128, 144, 152, 180, 192, 384, 512)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.DrawImage($src, 0, 0, $size, $size)
    $g.Dispose()
    $out = Join-Path $outputDir "icon-${size}x${size}.png"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "OK  icon-${size}x${size}.png"
}

# Maskable icon — imagem centralizada com padding 10% sobre fundo escuro
$padded = 462
$canvas = 512
$offset = [int](($canvas - $padded) / 2)
$bmpM = New-Object System.Drawing.Bitmap($canvas, $canvas)
$gM = [System.Drawing.Graphics]::FromImage($bmpM)
$gM.Clear([System.Drawing.Color]::FromArgb(255, 26, 23, 20))
$gM.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gM.DrawImage($src, $offset, $offset, $padded, $padded)
$gM.Dispose()
$bmpM.Save((Join-Path $outputDir "maskable-icon-512x512.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmpM.Dispose()
Write-Host "OK  maskable-icon-512x512.png"

# Apple Touch Icon 180x180 (já gerado acima, mas copia com nome correto)
Copy-Item (Join-Path $outputDir "icon-180x180.png") (Join-Path $outputDir "apple-touch-icon.png") -Force
Write-Host "OK  apple-touch-icon.png"

# Favicons pequenos
foreach ($fsize in @(32, 16)) {
    $bmpF = New-Object System.Drawing.Bitmap($fsize, $fsize)
    $gF = [System.Drawing.Graphics]::FromImage($bmpF)
    $gF.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gF.DrawImage($src, 0, 0, $fsize, $fsize)
    $gF.Dispose()
    $bmpF.Save((Join-Path $outputDir "favicon-${fsize}x${fsize}.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpF.Dispose()
    Write-Host "OK  favicon-${fsize}x${fsize}.png"
}

# OG Image 1200x630
$bmpOG = New-Object System.Drawing.Bitmap(1200, 630)
$gOG = [System.Drawing.Graphics]::FromImage($bmpOG)
$gOG.Clear([System.Drawing.Color]::FromArgb(255, 26, 23, 20))
$gOG.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
# Centraliza a imagem mantendo aspect ratio
$srcRatio  = $src.Width / $src.Height
$destRatio = 1200.0 / 630.0
if ($srcRatio -gt $destRatio) {
    $dh = 630; $dw = [int]($dh * $srcRatio)
    $dx = [int]((1200 - $dw) / 2); $dy = 0
} else {
    $dw = 1200; $dh = [int]($dw / $srcRatio)
    $dx = 0; $dy = [int]((630 - $dh) / 2)
}
$gOG.DrawImage($src, $dx, $dy, $dw, $dh)
$gOG.Dispose()
$bmpOG.Save((Join-Path $outputDir "og-image.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmpOG.Dispose()
Write-Host "OK  og-image.png"

$src.Dispose()

Write-Host "`nTodos os icones PWA gerados com sucesso!"
Write-Host "Pasta: $outputDir"
