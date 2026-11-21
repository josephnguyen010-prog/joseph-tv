# Joseph TV: shrinks the family photos for the TV.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\family_photos.ps1 <source folder> <output folder>
#
# Reads every JPG, PNG, BMP, GIF, TIFF and (with Windows' HEIF extension) HEIC photo in the source folder, turns it
# upright (the camera's orientation tag), fits it in 1600 x 900 and saves it as a JPEG (quality 82) named 001.jpg,
# 002.jpg, ... in the output folder, in name order, at most 80. Prints one "name<TAB>width<TAB>height" line per photo.
# Windows' own imaging (WIC, through PresentationCore), so nothing to install.
param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Output)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$MaxW = 1600; $MaxH = 900; $Limit = 80
$Exts = @('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.heif')

if (Test-Path $Output) { Remove-Item -Recurse -Force $Output }
New-Item -ItemType Directory -Force $Output | Out-Null

$files = Get-ChildItem -LiteralPath $Source -File | Where-Object { $Exts -contains $_.Extension.ToLower() } | Sort-Object Name
$n = 0
foreach ($file in $files) {
    if ($n -ge $Limit) { [Console]::Error.WriteLine("Only the first $Limit photos are used."); break }
    try {
        $stream = [System.IO.File]::OpenRead($file.FullName)
        try {
            $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($stream,
                [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
                [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
            $frame = $decoder.Frames[0]

            # The camera's orientation tag: 3 = upside down, 6 = turned right, 8 = turned left (2, 4, 5, 7 mirrored).
            $orientation = 1
            try {
                $meta = $frame.Metadata
                if ($meta -ne $null) {
                    $o = $meta.GetQuery('System.Photo.Orientation')
                    if ($o -ne $null) { $orientation = [int]$o }
                }
            } catch {}
            $angle = 0; $flip = $false
            switch ($orientation) {
                2 { $flip = $true }
                3 { $angle = 180 }
                4 { $angle = 180; $flip = $true }
                5 { $angle = 90; $flip = $true }
                6 { $angle = 90 }
                7 { $angle = 270; $flip = $true }
                8 { $angle = 270 }
            }

            $w = $frame.PixelWidth; $h = $frame.PixelHeight
            if ($angle -eq 90 -or $angle -eq 270) { $tw = $h; $th = $w } else { $tw = $w; $th = $h }
            $scale = [Math]::Min(1.0, [Math]::Min($MaxW / $tw, $MaxH / $th))

            $group = New-Object System.Windows.Media.TransformGroup
            if ($flip) { $group.Children.Add((New-Object System.Windows.Media.ScaleTransform(-1, 1))) }
            if ($angle -ne 0) { $group.Children.Add((New-Object System.Windows.Media.RotateTransform($angle))) }
            $group.Children.Add((New-Object System.Windows.Media.ScaleTransform($scale, $scale)))
            $bitmap = New-Object System.Windows.Media.Imaging.TransformedBitmap($frame, $group)

            $n++
            $name = '{0:000}.jpg' -f $n
            $encoder = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder
            $encoder.QualityLevel = 82
            $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
            $out = [System.IO.File]::Create((Join-Path $Output $name))
            try { $encoder.Save($out) } finally { $out.Close() }
            Write-Output ("{0}`t{1}`t{2}" -f $name, $bitmap.PixelWidth, $bitmap.PixelHeight)
        } finally {
            $stream.Close()
        }
    } catch {
        [Console]::Error.WriteLine("Skipped $($file.Name): $($_.Exception.Message)")
    }
}
