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
$BgW = 384; $BgH = 216   # the blurred background's size (the TV stretches it 5x; it's soft, so that looks smooth)

# A box blur, three passes (close to a Gaussian), on BGRA pixels; the edges repeat their last pixel.
Add-Type -Language CSharp @'
public static class JosephTvBlur {
    public static void Box(byte[] px, int w, int h, int r, int passes) {
        byte[] tmp = new byte[px.Length];
        for (int p = 0; p < passes; p++) {
            Pass(px, tmp, h, w, r, 4, w * 4);    // along the rows: h lines of w pixels
            Pass(tmp, px, w, h, r, w * 4, 4);    // along the columns: w lines of h pixels
        }
    }
    // Blurs along lines: n lines of len pixels, step bytes between pixels of a line, lineStep between lines.
    static void Pass(byte[] src, byte[] dst, int n, int len, int r, int step, int lineStep) {
        int win = 2 * r + 1;
        for (int line = 0; line < n; line++) {
            int start = line * lineStep;
            for (int c = 0; c < 3; c++) {
                int sum = 0;
                for (int i = -r; i <= r; i++) sum += src[start + Clamp(i, len) * step + c];
                for (int i = 0; i < len; i++) {
                    dst[start + i * step + c] = (byte)(sum / win);
                    sum += src[start + Clamp(i + r + 1, len) * step + c] - src[start + Clamp(i - r, len) * step + c];
                }
            }
            for (int i = 0; i < len; i++) dst[start + i * step + 3] = 255;
        }
    }
    static int Clamp(int i, int len) { return i < 0 ? 0 : i >= len ? len - 1 : i; }
}
'@
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

            # The background behind it: the same photo cropped to 16:9 (never squashed), small and softly blurred
            # here, so the TV only stretches an already smooth picture.
            $bgName = '{0:000}-bg.jpg' -f $n
            $argb = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap($bitmap, [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)
            $bw = $argb.PixelWidth; $bh = $argb.PixelHeight
            if ($bw / $bh -gt 16.0 / 9.0) { $cw = [int]($bh * 16 / 9); $ch = $bh } else { $cw = $bw; $ch = [int]($bw * 9 / 16) }
            $rect = New-Object System.Windows.Int32Rect([int](($bw - $cw) / 2), [int](($bh - $ch) / 2), $cw, $ch)
            $crop = New-Object System.Windows.Media.Imaging.CroppedBitmap($argb, $rect)
            $small = New-Object System.Windows.Media.Imaging.TransformedBitmap($crop, (New-Object System.Windows.Media.ScaleTransform(($BgW / $cw), ($BgH / $ch))))
            $sw = $small.PixelWidth; $sh = $small.PixelHeight
            $pixels = New-Object byte[] ($sw * $sh * 4)
            $small.CopyPixels($pixels, $sw * 4, 0)
            [JosephTvBlur]::Box($pixels, $sw, $sh, 14, 3)
            $soft = [System.Windows.Media.Imaging.BitmapSource]::Create($sw, $sh, 96, 96, [System.Windows.Media.PixelFormats]::Bgra32, $null, $pixels, $sw * 4)
            $bgEncoder = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder
            $bgEncoder.QualityLevel = 90
            $bgEncoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($soft))
            $bgOut = [System.IO.File]::Create((Join-Path $Output $bgName))
            try { $bgEncoder.Save($bgOut) } finally { $bgOut.Close() }

            Write-Output ("{0}`t{1}`t{2}`t{3}" -f $name, $bitmap.PixelWidth, $bitmap.PixelHeight, $bgName)
        } finally {
            $stream.Close()
        }
    } catch {
        [Console]::Error.WriteLine("Skipped $($file.Name): $($_.Exception.Message)")
    }
}
