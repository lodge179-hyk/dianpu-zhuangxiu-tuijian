param(
 [Parameter(Mandatory=$true)][string]$Config,
 [ValidateSet('Prepare','Render')][string]$Mode='Render',
 [Parameter(Mandatory=$true)][string]$OutputDir
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$started=Get-Date
$configFile=(Resolve-Path -LiteralPath $Config).Path
$configRoot=Split-Path -Parent $configFile
$cfg=Get-Content -LiteralPath $configFile -Raw -Encoding utf8 | ConvertFrom-Json
function ResolveInput([string]$p){
 if([string]::IsNullOrWhiteSpace($p)){throw 'Missing image path'}
 if(-not [IO.Path]::IsPathRooted($p)){$p=Join-Path $configRoot $p}
 return (Resolve-Path -LiteralPath $p).Path
}
function CheckCrop($im,$crop){
 if($null -eq $crop){return}
 if($crop.Count -ne 4){throw 'crop must be [x,y,width,height]'}
 if($crop[0] -lt 0 -or $crop[1] -lt 0 -or $crop[2] -le 0 -or $crop[3] -le 0 -or $crop[0]+$crop[2] -gt $im.Width -or $crop[1]+$crop[3] -gt $im.Height){throw 'Crop outside image bounds'}
 if($crop[2] -ne $crop[3]){throw 'Product crop must be square to avoid distortion'}
}
if(@($cfg.products).Count -ne 3){throw 'This MVP requires exactly 3 products'}
if([string]::IsNullOrWhiteSpace($cfg.nickname)){throw 'nickname is required'}
$products=@();$references=@()
foreach($p in $cfg.products){
 if([string]::IsNullOrWhiteSpace($p.name)){throw 'Each product needs a name'}
 $path=ResolveInput $p.image
 $im=[Drawing.Image]::FromFile($path)
 try{CheckCrop $im $p.crop}finally{$im.Dispose()}
 $reference=$path;if($p.reference){$reference=ResolveInput $p.reference}
 $products+=@{path=$path;name=[string]$p.name;price=[string]$p.price;crop=$p.crop}
 $references+=$reference
}
$avatar='';if($cfg.avatarPath){$avatar=ResolveInput $cfg.avatarPath}
$scenePath=''
if($Mode -eq 'Render'){$scenePath=ResolveInput $cfg.scene}
$out=[IO.Path]::GetFullPath($OutputDir)
if(Test-Path -LiteralPath $out){throw 'OutputDir already exists; use a fresh directory to preserve prior results'}
New-Item -ItemType Directory -Path $out | Out-Null
$description=($products | ForEach-Object {$_.name}) -join '; '
$prompt="Create one photorealistic 4:3 shop carousel using the three original reference images in order LEFT, CENTER, RIGHT: $description. Single continuous warm ivory studio scene, soft light, crisp product detail, each product equally prominent, all fully inside frame without overlap. Preserve actual product identity, shape, color, packaging and visible branding; never invent specifications or shade numbers. Exclude promotional overlays, prices, watermarks, captions and UI from source photos. Do not add products. Frame for three square detail crops. Style: $($cfg.style)."
$prompt | Set-Content -LiteralPath (Join-Path $out 'scene-prompt.txt') -Encoding utf8
$references | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'references.json') -Encoding utf8
Copy-Item -LiteralPath $configFile -Destination (Join-Path $out 'input-config.json')
if($Mode -eq 'Prepare'){
 @{status='awaiting_scene';generationCalls=0;next='Use scene-prompt.txt and references.json with the built-in image tool; then set scene in original config and Render to a fresh output directory.'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'run.json') -Encoding utf8
 Write-Output $out;exit 0
}
# Header composition reuses the reviewed fixed triangle background.
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixed-header-clean.png') -Destination $out
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build-header.ps1') -Destination $out
$avatarText='店';if($cfg.avatarText){$avatarText=[string]$cfg.avatarText}
& (Join-Path $out 'build-header.ps1') -Nickname $cfg.nickname -AvatarText $avatarText -AvatarPath $avatar
$scene=[Drawing.Image]::FromFile($scenePath)
if([Math]::Abs($scene.Width/$scene.Height-4.0/3) -gt 0.01){$scene.Dispose();throw 'Scene must be 4:3; refusing to stretch it'}
$bmp=[Drawing.Bitmap]::new(1200,3976);$g=[Drawing.Graphics]::FromImage($bmp)
$g.Clear([Drawing.Color]::White);$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
function Region($im,$crop,[int]$x,[int]$y,[int]$w,[int]$h){
 $g.DrawImage($im,[Drawing.Rectangle]::new($x,$y,$w,$h),[Drawing.Rectangle]::new($crop[0],$crop[1],$crop[2],$crop[3]),[Drawing.GraphicsUnit]::Pixel)
}
function SquareCrop($im,$crop){
 if($null -ne $crop){return $crop}
 $s=[Math]::Min($im.Width,$im.Height);return @([int](($im.Width-$s)/2),[int](($im.Height-$s)/2),$s,$s)
}
function TextLine([string]$text,[int]$size,[int]$x,[int]$y,[int]$width,[string]$color='Black'){
 $f=[Drawing.Font]::new('Microsoft YaHei',$size,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
 $b=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($color))
 $fmt=[Drawing.StringFormat]::new();$fmt.Trimming=[Drawing.StringTrimming]::EllipsisCharacter;$fmt.FormatFlags=[Drawing.StringFormatFlags]::NoWrap
 $g.DrawString($text,$f,$b,[Drawing.RectangleF]::new($x,$y,$width,($size*1.6)),$fmt)
 $f.Dispose();$b.Dispose();$fmt.Dispose()
}
$header=[Drawing.Image]::FromFile((Join-Path $out 'personalized-header-v2.png'))
Region $header @(0,0,1240,880) 0 0 1200 852;$header.Dispose()
$cream=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#FCF6EA'))
$g.FillRectangle($cream,32,904,1136,122);$cream.Dispose()
TextLine '◇  会员权益     ›' 34 75 940 500 '#AE7F48'
TextLine '礼  积分商城     ›' 34 660 940 500 '#AE7F48'
$images=@();foreach($p in $products){$images+=[Drawing.Image]::FromFile($p.path)}
$labels=@('商品精选','礼盒精选','品牌选礼','全部商品')+@($products[0].name,$products[1].name,$products[2].name,'商品分类','包装细节','心意之选','日常精选','暖调精选','品牌浏览','联系店主')
if($cfg.navigation){if(@($cfg.navigation).Count -ne 14){throw 'navigation needs 14 labels'};$labels=@($cfg.navigation)}
for($i=0;$i -lt 14;$i++){
 if($i -lt 4){$x=61+300*$i;$y=1100}else{$j=$i-4;$x=31+240*($j%5);$y=1390+315*[int][Math]::Floor($j/5)}
 $k=$i%3;if($i -ge 4){$k=($i-4)%3};$im=$images[$k];$crop=SquareCrop $im $products[$k].crop
 $state=$g.Save();$clip=[Drawing.Drawing2D.GraphicsPath]::new();$clip.AddEllipse($x,$y,178,178);$g.SetClip($clip)
 Region $im $crop $x $y 178 178;$g.Restore($state);$clip.Dispose()
 TextLine $labels[$i] 28 ($x-20) ($y+196) 225 '#666666'
}
# Default square tiles use equal horizontal thirds, preserving aspect ratio.
$side=[int]($scene.Width/3)
for($i=0;$i -lt 3;$i++){
 $crop=@(($side*$i),[int]($scene.Height-$side),$side,$side)
 if($cfg.posterCrops){$crop=$cfg.posterCrops[$i];CheckCrop $scene $crop}
 Region $scene $crop ($i*400) 2088 400 400
}
Region $scene @(0,0,$scene.Width,$scene.Height) 0 2488 1200 900
for($i=0;$i -lt 3;$i++){
 $x=32+384*$i;$crop=SquareCrop $images[$i] $products[$i].crop
 Region $images[$i] $crop $x 3420 368 368
 TextLine $products[$i].name 37 $x 3798 368
 if($products[$i].price){TextLine ('¥'+$products[$i].price) 40 $x 3908 280 '#FF524C'}
 $pen=[Drawing.Pen]::new([Drawing.Color]::DimGray,4);$cx=$x+307;$cy=3915
 $g.DrawLines($pen,[Drawing.Point[]]@([Drawing.Point]::new($cx,$cy),[Drawing.Point]::new(($cx+7),$cy),[Drawing.Point]::new(($cx+14),($cy+30)),[Drawing.Point]::new(($cx+44),($cy+30)),[Drawing.Point]::new(($cx+50),($cy+9)),[Drawing.Point]::new(($cx+10),($cy+9))))
 $g.FillEllipse([Drawing.Brushes]::DimGray,($cx+14),($cy+38),6,6);$g.FillEllipse([Drawing.Brushes]::DimGray,($cx+39),($cy+38),6,6);$pen.Dispose()
}
$bmp.Save((Join-Path $out 'preview.png'),[Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$bmp.Dispose();$scene.Dispose();foreach($im in $images){$im.Dispose()}
@{status='rendered_pending_review';seconds=((Get-Date)-$started).TotalSeconds;generationCalls=0;scene=$scenePath;products=$products;page=@(1200,3976);navDiameter=178;review=@('Check product identity and tiny text','Check all image crops','Confirm names and prices against source','Header retains screenshot platform controls; old nickname background is locally approximated')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'run.json') -Encoding utf8
Write-Output (Join-Path $out 'preview.png')

