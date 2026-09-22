param(
 [string]$Nickname='彩妆礼盒精选',
 [string]$AvatarText='礼',
 [string]$AvatarPath=''
)
Add-Type -AssemblyName System.Drawing
$base=$PSScriptRoot
$original=[System.Drawing.Bitmap]::FromFile((Join-Path $base 'fixed-header-clean.png'))
$header=$original.Clone([System.Drawing.Rectangle]::new(0,0,1240,880),[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
# Original screenshot has no separate background layer. Clear only the old
# nickname pixels using vertical interpolation between adjacent clean pixels.
# The concealed background is an approximation; all other source pixels persist.
for($x=247;$x -le 455;$x++){
 $top=$original.GetPixel($x,663);$bottom=$original.GetPixel($x,747)
 for($y=664;$y -lt 747;$y++){
  $t=($y-663)/84.0
  $r=[int][Math]::Round($top.R*(1-$t)+$bottom.R*$t)
  $green=[int][Math]::Round($top.G*(1-$t)+$bottom.G*$t)
  $b=[int][Math]::Round($top.B*(1-$t)+$bottom.B*$t)
  $header.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,$r,$green,$b))
 }
}
$g=[System.Drawing.Graphics]::FromImage($header)
$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$avatarRect=[System.Drawing.Rectangle]::new(49,651,184,184)
$avatarBrush=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F5E8D3'))
$g.FillEllipse($avatarBrush,$avatarRect)
if($AvatarPath){
 $av=[System.Drawing.Image]::FromFile($AvatarPath)
 $state=$g.Save();$path=[System.Drawing.Drawing2D.GraphicsPath]::new();$path.AddEllipse($avatarRect);$g.SetClip($path)
 $side=[Math]::Min($av.Width,$av.Height)
 $g.DrawImage($av,$avatarRect,[System.Drawing.Rectangle]::new([int](($av.Width-$side)/2),[int](($av.Height-$side)/2),$side,$side),[System.Drawing.GraphicsUnit]::Pixel)
 $g.Restore($state);$path.Dispose();$av.Dispose()
}else{
 $font=[System.Drawing.Font]::new('Microsoft YaHei',95,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
 $ink=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#803948'))
 $format=[System.Drawing.StringFormat]::new();$format.Alignment=[System.Drawing.StringAlignment]::Center;$format.LineAlignment=[System.Drawing.StringAlignment]::Center
 $g.DrawString($AvatarText,$font,$ink,[System.Drawing.RectangleF]::new(49,651,184,184),$format)
 $font.Dispose();$ink.Dispose();$format.Dispose()
}
$nickFont=[System.Drawing.Font]::new('Microsoft YaHei',48,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
$nickFormat=[System.Drawing.StringFormat]::new();$nickFormat.Trimming=[System.Drawing.StringTrimming]::EllipsisCharacter;$nickFormat.FormatFlags=[System.Drawing.StringFormatFlags]::NoWrap
$g.DrawString($Nickname,$nickFont,[System.Drawing.Brushes]::White,[System.Drawing.RectangleF]::new(254,672,660,73),$nickFormat)
$g.Dispose();$avatarBrush.Dispose();$nickFont.Dispose();$nickFormat.Dispose()
$header.Save((Join-Path $base 'personalized-header-v2.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$original.Dispose();$header.Dispose()
@{nickname=$Nickname;avatarText=$AvatarText;avatarPath=$AvatarPath;fixedSource='fixed-header-clean.png';backgroundRecovery='Only old nickname area locally interpolated; not an original clean background asset.'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $base 'header-profile.json') -Encoding utf8

