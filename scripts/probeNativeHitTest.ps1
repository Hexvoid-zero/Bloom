param([string]$Evidence = 'G:\My Drive\Bloom\evidence\notch-screenshots')
# Read-only Win32 inspection: no input injection or window mutation.
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BloomNativeHitRead {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb,IntPtr lp);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint f);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
}
'@
$native = Get-Content -Raw -LiteralPath (Join-Path $Evidence 'native-notch-verification.json') | ConvertFrom-Json
$app = @(Get-CimInstance Win32_Process -Filter "Name='Bloom-MacDock.exe'" | Where-Object {$_.CommandLine -notmatch '--taskbar-watchdog'})
if ($app.Count -ne 1) {throw 'Expected one Bloom application process'}
$appId = [uint32]$app[0].ProcessId
$found = [System.Collections.Generic.List[IntPtr]]::new()
[void][BloomNativeHitRead]::EnumWindows({param($hwnd,$unused)
 $owner=0; [void][BloomNativeHitRead]::GetWindowThreadProcessId($hwnd,[ref]$owner)
 $title=[System.Text.StringBuilder]::new(128); [void][BloomNativeHitRead]::GetWindowText($hwnd,$title,128)
 if($owner -eq $appId -and $title.ToString() -eq 'Bloom Dock'){$found.Add($hwnd)}
 return $true
}.GetNewClosure(),[IntPtr]::Zero)
if($found.Count -ne 1){throw 'Expected one native dock HWND'}
$dockHandle=$found[0]
$bounds=New-Object BloomNativeHitRead+RECT
[void][BloomNativeHitRead]::GetWindowRect($dockHandle,[ref]$bounds)
$cursor=New-Object BloomNativeHitRead+POINT
[void][BloomNativeHitRead]::GetCursorPos([ref]$cursor)
$results=foreach($target in $native.targets){
 $point=New-Object BloomNativeHitRead+POINT
 $point.X=$bounds.Left+[int][math]::Round($target.x)
 $point.Y=$bounds.Top+[int][math]::Round($target.y)
 $hit=[BloomNativeHitRead]::WindowFromPoint($point)
 $root=[BloomNativeHitRead]::GetAncestor($hit,2)
 $class=[System.Text.StringBuilder]::new(128); [void][BloomNativeHitRead]::GetClassName($hit,$class,128)
 [pscustomobject]@{index=$target.index;x=$point.X;y=$point.Y;class=$class.ToString();dockOwnsPoint=($root -eq $dockHandle)}
}
$passed=@($results|Where-Object dockOwnsPoint).Count
$report=[pscustomobject]@{source='Read-only WindowFromPoint and root HWND across every real dock icon';checked=$results.Count;passed=$passed;allPassed=($passed -eq $results.Count);cursor=@($cursor.X,$cursor.Y);dockBounds=@($bounds.Left,$bounds.Top,$bounds.Right,$bounds.Bottom);outerClickThrough=(([BloomNativeHitRead]::GetWindowLong($dockHandle,-20) -band 0x20) -ne 0);results=$results}
$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $Evidence 'native-hit-test.json') -Encoding utf8
$report|Select-Object checked,passed,allPassed,cursor,dockBounds,outerClickThrough|Format-List
if(-not $report.allPassed){$results|Where-Object {-not $_.dockOwnsPoint}|Select-Object -First 5|Format-Table;exit 1}
