Add-Type -AssemblyName System.Drawing

function Export-Cover {
  param([string]$Source, [string]$Destination, [int]$Width, [int]$Height, [long]$Quality = 86)
  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  $target = New-Object System.Drawing.Bitmap $Width, $Height
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $sourceRatio = $sourceImage.Width / $sourceImage.Height
    $targetRatio = $Width / $Height
    if ($sourceRatio -gt $targetRatio) {
      $cropHeight = $sourceImage.Height; $cropWidth = [int]($cropHeight * $targetRatio)
      $cropX = [int](($sourceImage.Width - $cropWidth) / 2); $cropY = 0
    } else {
      $cropWidth = $sourceImage.Width; $cropHeight = [int]($cropWidth / $targetRatio)
      $cropX = 0; $cropY = [int](($sourceImage.Height - $cropHeight) / 2)
    }
    $destinationRectangle = New-Object System.Drawing.Rectangle 0, 0, $Width, $Height
    $graphics.DrawImage($sourceImage, $destinationRectangle, $cropX, $cropY, $cropWidth, $cropHeight, [System.Drawing.GraphicsUnit]::Pixel)
    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
    $encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters 1
    $encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $Quality
    $target.Save($Destination, $jpegCodec, $encoderParameters)
  } finally { $graphics.Dispose(); $target.Dispose(); $sourceImage.Dispose() }
}

$sourceDirectory = Join-Path $PSScriptRoot '..\public\validation\consistency'
$outputDirectory = Join-Path $PSScriptRoot '..\public\validation\full-page'
New-Item -ItemType Directory -Force $outputDirectory | Out-Null
Export-Cover (Join-Path $sourceDirectory 'carousel.png') (Join-Path $outputDirectory 'carousel.jpg') 1080 360 88
1..3 | ForEach-Object { Export-Cover (Join-Path $sourceDirectory "poster-$_.png") (Join-Path $outputDirectory "poster-$_.jpg") 720 1200 86 }
1..5 | ForEach-Object { Export-Cover (Join-Path $sourceDirectory "nav-$_.png") (Join-Path $outputDirectory "nav-$_.jpg") 360 360 84 }
Get-ChildItem $outputDirectory | Sort-Object Name | Select-Object Name, Length
