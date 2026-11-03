<#
portwatch - auto port forwarding from a remote dev box over SSH.

Polls the remote host for listening TCP ports owned by your user, filters
them by allowed project folders (config.json), and maintains one
`ssh -N -L` child process per forwarded port. Shows a live table.

Each forward gets a human-readable NAME resolved in precedence order:
config portLabels > HTML <title> (probed through the tunnel) > package.json
name from the remote cwd > framework guess from the cmdline > process name.
Ports that answered with an HTML title sort to the top of the table, and a
successful probe doubles as an end-to-end health check of the forward.

Keys (watch screen): Up/Down select a port, Enter opens it in the browser,
A adds a port to forward for this run, R polls immediately, Q or Esc quits
(Ctrl+C also works).

Usage:
  .\portwatch.ps1              # pick a host from the menu (MRU-ordered)
  .\portwatch.ps1 -Target beast
#>
[CmdletBinding()]
param(
    [string]$Target,
    [int]$PollSeconds = 0
)

$ErrorActionPreference = 'Stop'
# BOM-less UTF-8 for the probe piped into remote bash; a BOM breaks its first line
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ConfigPath = Join-Path $PSScriptRoot 'config.json'
$StatePath  = Join-Path $PSScriptRoot 'state.json'
$MaxRespawnAttempts = 5

# Built from char codes: a BOM-less .ps1 is read as ANSI by PS 5.1, so
# literal non-ASCII characters in source would come out as mojibake.
$script:Ellipsis = [string][char]0x2026   # ...
$script:HRule    = [string][char]0x2500   # box-drawing horizontal line
$script:Dot      = [string][char]0x00B7   # middle dot separator

# status icons: filled circle / dotted circle / circled slash / cross
$script:Glyph = @{
    'up'       = [string][char]0x25CF
    'starting' = [string][char]0x25CC
    'new'      = [string][char]0x25CC
    'conflict' = [string][char]0x2298
    'failed'   = [string][char]0x2715
}

# VT truecolor palette: ConsoleColor name -> "r;g;b". Rows keep using the
# standard names, so the 16-color fallback path still works; in VT mode
# these softer shades render instead (notably the lighter green).
$script:VtFg = @{
    'White'      = '235;235;235'
    'Gray'       = '190;190;190'
    'DarkGray'   = '120;120;120'
    'Cyan'       = '86;212;221'
    'DarkCyan'   = '58;156;166'
    'Green'      = '126;231;135'
    'DarkGreen'  = '70;160;85'
    'Yellow'     = '242;204;96'
    'DarkYellow' = '155;132;70'
    'Red'        = '255;123;114'
    'DarkRed'    = '175;62;60'
}
$script:VtBg = @{
    'DarkBlue' = '34;58;98'
}

$script:CanKey = $true
try { if ([Console]::IsInputRedirected) { $script:CanKey = $false } } catch { $script:CanKey = $false }

# ---------------- job object ----------------

# Kernel-level cleanup guarantee: every ssh child is assigned to a Job
# Object with KILL_ON_JOB_CLOSE. When this PowerShell process dies for ANY
# reason (window closed with X, crash, taskkill), the OS closes the job
# handle and terminates every process in the job. The finally-block cleanup
# below is then just the polite path.
if (-not ('PortWatch.Job' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace PortWatch {
  public static class Job {
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
      public long PerProcessUserTimeLimit;
      public long PerJobUserTimeLimit;
      public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize;
      public UIntPtr MaximumWorkingSetSize;
      public uint ActiveProcessLimit;
      public UIntPtr Affinity;
      public uint PriorityClass;
      public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS {
      public ulong ReadOperationCount;
      public ulong WriteOperationCount;
      public ulong OtherOperationCount;
      public ulong ReadTransferCount;
      public ulong WriteTransferCount;
      public ulong OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
      public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
      public IO_COUNTERS IoInfo;
      public UIntPtr ProcessMemoryLimit;
      public UIntPtr JobMemoryLimit;
      public UIntPtr PeakProcessMemoryUsed;
      public UIntPtr PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int len);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    static IntPtr _job = IntPtr.Zero;

    public static bool Init() {
      if (_job != IntPtr.Zero) return true;
      IntPtr job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) return false;
      var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
      if (!SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(info))) return false;
      _job = job;
      return true;
    }
    public static bool Add(IntPtr processHandle) {
      if (_job == IntPtr.Zero) return false;
      return AssignProcessToJobObject(_job, processHandle);
    }
  }
}
'@
}
$script:JobReady = $false
try { $script:JobReady = [PortWatch.Job]::Init() } catch { }

# Enable VT (24-bit color) output. Windows Terminal has it on already;
# legacy conhost needs ENABLE_VIRTUAL_TERMINAL_PROCESSING (0x4). If this
# fails, Write-Frame falls back to the 16-color Write-Host path.
if (-not ('PortWatch.Vt' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace PortWatch {
  public static class Vt {
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetConsoleMode(IntPtr handle, out uint mode);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetConsoleMode(IntPtr handle, uint mode);

    public static bool Enable() {
      IntPtr h = GetStdHandle(-11);
      uint m;
      if (!GetConsoleMode(h, out m)) return false;
      if ((m & 0x4) != 0) return true;
      return SetConsoleMode(h, m | 0x4);
    }
  }
}
'@
}
$script:VtReady = $false
try { $script:VtReady = [PortWatch.Vt]::Enable() } catch { }

# [Console]::Write encodes through the console output encoding, which
# defaults to the OEM codepage - box-drawing survives that but the status
# glyphs become '?'. Use UTF-8 while we run (this also decodes ssh probe
# output as UTF-8, which is what the remote sends); restored on exit.
$script:SavedConsoleEncoding = $null
try {
    $script:SavedConsoleEncoding = [Console]::OutputEncoding
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { }

# ---------------- config ----------------

if (-not (Test-Path $ConfigPath)) {
    $template = [ordered]@{
        pollSeconds = 3
        hosts       = [ordered]@{
            'example-host' = [ordered]@{
                allowedFolders = @('~/work')
                portLabels     = [ordered]@{ '3000' = 'my app' }
            }
        }
    }
    $template | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $ConfigPath
    Write-Host "Created template config at $ConfigPath - edit it and run again." -ForegroundColor Yellow
    exit 1
}
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
if ($PollSeconds -le 0) {
    $PollSeconds = 3
    if ($Config.pollSeconds) { $PollSeconds = [int]$Config.pollSeconds }
}

# ---------------- frame renderer ----------------

# Redraws in place (no Clear-Host flicker). Each row: @{ Text; Fg; Bg }.
$script:PrevLines = 0
$script:LastW = 0
$script:LastH = 0

function Write-Frame($rows) {
    $w = 80
    try { $w = [Console]::WindowWidth } catch { }
    if ($w -lt 20) { $w = 20 }
    $maxRows = 25
    try { $maxRows = [Console]::WindowHeight - 1 } catch { }
    if ($maxRows -lt 5) { $maxRows = 5 }
    # a resize reflows previously drawn text and scrambles absolute
    # positions - wipe and repaint from scratch
    if ($w -ne $script:LastW -or $maxRows -ne $script:LastH) {
        if ($script:LastW -gt 0) { Clear-Host }
        $script:LastW = $w
        $script:LastH = $maxRows
        $script:PrevLines = 0
    }
    $y = 0
    foreach ($r in $rows) {
        if ($y -ge $maxRows) { break }
        [Console]::SetCursorPosition(0, $y)
        $text = "$($r.Text)"
        if ($text.Length -gt ($w - 1)) { $text = $text.Substring(0, $w - 2) + $script:Ellipsis }
        $text = $text.PadRight($w - 1)
        $fg = 'Gray'
        if ($r.Fg) { $fg = $r.Fg }
        if ($script:VtReady) {
            $esc = [char]27
            $fgRgb = $script:VtFg[$fg]
            if (-not $fgRgb) { $fgRgb = $script:VtFg['Gray'] }
            $line = "$esc[38;2;${fgRgb}m"
            if ($r.Bg -and $script:VtBg[$r.Bg]) { $line += "$esc[48;2;$($script:VtBg[$r.Bg])m" }
            [Console]::Write($line + $text + "$esc[0m")
        }
        elseif ($r.Bg) { Write-Host $text -NoNewline -ForegroundColor $fg -BackgroundColor $r.Bg }
        else           { Write-Host $text -NoNewline -ForegroundColor $fg }
        $y++
    }
    $blank = ' ' * ($w - 1)
    for ($i = $y; $i -lt $script:PrevLines; $i++) {
        if ($i -ge $maxRows) { break }
        [Console]::SetCursorPosition(0, $i)
        Write-Host $blank -NoNewline
    }
    $script:PrevLines = $y
}

# ---------------- ssh config parsing ----------------

function Get-SshConfigFiles {
    $sshDir = Join-Path $env:USERPROFILE '.ssh'
    $main   = Join-Path $sshDir 'config'
    $result = New-Object System.Collections.Generic.List[string]
    $queue  = New-Object System.Collections.Generic.Queue[string]
    if (Test-Path $main) { $queue.Enqueue($main) }
    while ($queue.Count -gt 0) {
        $f = $queue.Dequeue()
        if ($result.Contains($f)) { continue }
        $result.Add($f)
        foreach ($line in (Get-Content $f)) {
            if ($line -match '^\s*Include\s+(.+)$') {
                foreach ($pat in ($Matches[1].Trim() -split '\s+')) {
                    $pat = $pat.Trim('"')
                    if ($pat -match '^~[/\\]') {
                        $pat = Join-Path $env:USERPROFILE $pat.Substring(2)
                    }
                    elseif (-not [System.IO.Path]::IsPathRooted($pat)) {
                        $pat = Join-Path $sshDir $pat
                    }
                    foreach ($m in @(Get-Item -Path $pat -ErrorAction SilentlyContinue)) {
                        $queue.Enqueue($m.FullName)
                    }
                }
            }
        }
    }
    return ,$result
}

function Get-SshHosts {
    $hosts = New-Object System.Collections.Generic.List[string]
    foreach ($f in (Get-SshConfigFiles)) {
        foreach ($line in (Get-Content $f)) {
            if ($line -match '^\s*Host\s+(.+)$') {
                foreach ($h in ($Matches[1].Trim() -split '\s+')) {
                    if ($h -notmatch '[*?!]' -and -not $hosts.Contains($h)) { $hosts.Add($h) }
                }
            }
        }
    }
    return ,$hosts
}

# ---------------- MRU state ----------------

function Get-State {
    if (Test-Path $StatePath) {
        try { return Get-Content $StatePath -Raw | ConvertFrom-Json } catch { }
    }
    return [pscustomobject]@{ mru = @() }
}

function Save-Mru([string]$name) {
    $state = Get-State
    $mru = @($name) + @($state.mru | Where-Object { $_ -ne $name })
    [pscustomobject]@{ mru = @($mru | Select-Object -First 20) } |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $StatePath
}

# ---------------- host picker ----------------

function Select-TargetHost {
    $hosts = Get-SshHosts
    if ($hosts.Count -eq 0) { throw 'No usable Host entries found in ~/.ssh/config' }
    $mru = @((Get-State).mru)
    $ordered = @($mru | Where-Object { $hosts -contains $_ }) +
               @($hosts | Where-Object { $mru -notcontains $_ } | Sort-Object)

    if (-not $script:CanKey) {
        # non-interactive fallback: plain numbered prompt
        Write-Host ''
        Write-Host 'Select host:' -ForegroundColor Cyan
        for ($i = 0; $i -lt $ordered.Count; $i++) {
            Write-Host ("  {0,2}. {1}" -f ($i + 1), $ordered[$i])
        }
        $answer = Read-Host 'Host [1]'
        if ([string]::IsNullOrWhiteSpace($answer)) { return $ordered[0] }
        $n = 0
        if ([int]::TryParse($answer, [ref]$n) -and $n -ge 1 -and $n -le $ordered.Count) {
            return $ordered[$n - 1]
        }
        if ($ordered -contains $answer) { return $answer }
        throw "No such host: $answer"
    }

    $idx = 0
    Clear-Host
    $script:PrevLines = 0
    [Console]::CursorVisible = $false
    try {
        while ($true) {
            $rows = New-Object System.Collections.Generic.List[object]
            $rows.Add(@{ Text = ''; Fg = 'Gray' })
            $rows.Add(@{ Text = '  portwatch - select host'; Fg = 'Cyan' })
            $rows.Add(@{ Text = ''; Fg = 'Gray' })
            for ($i = 0; $i -lt $ordered.Count; $i++) {
                $tag = ''
                if ($i -eq 0 -and $mru -contains $ordered[$i]) { $tag = '   (last used)' }
                $marker = '   '
                $bg = $null
                $fg = 'Gray'
                if ($i -eq $idx) { $marker = ' > '; $bg = 'DarkBlue'; $fg = 'White' }
                $rows.Add(@{ Text = ("  {0}{1,2}. {2}{3}" -f $marker, ($i + 1), $ordered[$i], $tag); Fg = $fg; Bg = $bg })
            }
            $rows.Add(@{ Text = ''; Fg = 'Gray' })
            $rows.Add(@{ Text = '  Up/Down select   Enter connect   1-9 quick pick   Esc quit'; Fg = 'DarkGray' })
            Write-Frame $rows

            $key = [Console]::ReadKey($true)
            switch ($key.Key) {
                'UpArrow'   { if ($idx -gt 0) { $idx-- } else { $idx = $ordered.Count - 1 } }
                'DownArrow' { if ($idx -lt $ordered.Count - 1) { $idx++ } else { $idx = 0 } }
                'Home'      { $idx = 0 }
                'End'       { $idx = $ordered.Count - 1 }
                'Enter'     { return $ordered[$idx] }
                'Escape'    { exit 0 }
            }
            if ($key.KeyChar -ge '1' -and $key.KeyChar -le '9') {
                $n = [int]$key.KeyChar - [int][char]'0'
                if ($n -le $ordered.Count) { return $ordered[$n - 1] }
            }
        }
    }
    finally { [Console]::CursorVisible = $true }
}

# ---------------- remote probe ----------------

# Runs on the remote box. Emits the remote $HOME, then one line per
# listening TCP port owned by our user:
#   PORT|<port>|<pid>|<addr>|<started>|<comm>|<cwd>|<pkg>|<cmdline>
# pkg is the "name" from package.json in the process cwd, if any.
# cmdline goes last because it may itself contain '|'.
$ProbeScript = @'
echo "HOME|$HOME"
ss -tlnpH 2>/dev/null | while read -r line; do
  addr=$(echo "$line" | awk '{print $4}')
  port="${addr##*:}"
  pid=$(echo "$line" | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -z "$pid" ] && continue
  comm=$(cat "/proc/$pid/comm" 2>/dev/null)
  [ "$comm" = "sshd" ] && continue
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
  started=$(ps -o lstart= -p "$pid" 2>/dev/null | sed 's/^ *//')
  pkg=$(sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([^"|]*\)".*/\1/p' "$cwd/package.json" 2>/dev/null | head -1)
  cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
  echo "PORT|$port|$pid|$addr|$started|$comm|$cwd|$pkg|$cmdline"
done | sort -t'|' -k2,2n -u
'@

# The ssh probe takes 0.5-1s, which used to freeze the UI every poll. It
# now runs on a background runspace; the main loop polls the handle and
# parses the output when it completes. The runspace is created once and
# reused - opening a fresh one each poll costs time on the UI thread.
# Polls never overlap ($PollPS guards), so reuse is safe.
$script:PollRunspace = $null
$script:PollPS = $null
$script:PollHandle = $null

function Start-RemotePoll([string]$SshTarget) {
    if ($null -eq $script:PollRunspace) {
        $script:PollRunspace = [runspacefactory]::CreateRunspace()
        $script:PollRunspace.Open()
    }
    $ps = [powershell]::Create()
    $ps.Runspace = $script:PollRunspace
    [void]$ps.AddScript({
        param($probeScript, $target)
        # BOM-less UTF-8 for the probe piped into remote bash; sed strips
        # the BOM some hosts prepend anyway, tr strips pipeline CRs
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $out = $probeScript | & ssh -q -o BatchMode=yes -o ConnectTimeout=5 $target "sed '1s/^\xef\xbb\xbf//' | tr -d '\r' | bash -s"
        $code = $LASTEXITCODE
        # local listener snapshot, gathered here so the slow CIM query
        # never runs on the UI thread
        $snap = @{}
        $conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
        foreach ($c in @($conns)) {
            $p = [int]$c.LocalPort
            if (-not $snap.ContainsKey($p)) { $snap[$p] = @() }
            $snap[$p] += [int]$c.OwningProcess
        }
        [pscustomobject]@{ ExitCode = $code; Lines = @($out); Snap = $snap }
    }).AddArgument($ProbeScript).AddArgument($SshTarget)
    $script:PollPS = $ps
    $script:PollHandle = $ps.BeginInvoke()
}

function Parse-ProbeOutput($lines) {
    $remoteHome = ''
    $ports = @{}
    foreach ($line in @($lines)) {
        $parts = "$line" -split '\|', 9
        if ($parts[0] -eq 'HOME' -and $parts.Count -ge 2) { $remoteHome = $parts[1]; continue }
        if ($parts[0] -ne 'PORT' -or $parts.Count -lt 9) { continue }
        $port = 0
        if (-not [int]::TryParse($parts[1], [ref]$port)) { continue }
        if ($ports.ContainsKey($port)) { continue }
        $ports[$port] = [pscustomobject]@{
            Port    = $port
            Pid     = $parts[2]
            Addr    = $parts[3]
            Started = $parts[4]
            Process = $parts[5]
            Cwd     = $parts[6]
            Pkg     = $parts[7]
            Cmdline = $parts[8].Trim()
        }
    }
    return [pscustomobject]@{ Home = $remoteHome; Ports = @($ports.Values) }
}

function Get-DesiredPorts($probe, $allowedFolders) {
    $folders = @()
    foreach ($f in @($allowedFolders)) {
        if ([string]::IsNullOrWhiteSpace($f)) { continue }
        $x = $f
        if ($x -match '^~($|/)' -and $probe.Home) { $x = $probe.Home + $x.Substring(1) }
        $folders += $x.TrimEnd('/')
    }
    $result = @()
    $seen = @{}
    $allPorts = @{}
    foreach ($p in @($probe.Ports)) {
        $allPorts[[int]$p.Port] = $p
        if ($folders.Count -gt 0) {
            $ok = $false
            foreach ($f in $folders) {
                if ($p.Cwd -eq $f -or $p.Cwd.StartsWith($f + '/')) { $ok = $true; break }
            }
            if (-not $ok) { continue }
        }
        $result += $p
        $seen[[int]$p.Port] = $true
    }

    # Explicitly requested ports are kept for the lifetime of this process.
    # They intentionally bypass allowedFolders, so a port can be added even
    # when its remote process is outside the normal project paths (or has not
    # started yet).
    foreach ($extraPort in @($script:ExtraPorts.Keys)) {
        $port = [int]$extraPort
        if ($seen.ContainsKey($port)) { continue }
        if ($allPorts.ContainsKey($port)) {
            $result += $allPorts[$port]
        }
        else {
            $result += [pscustomobject]@{
                Port    = $port
                Pid     = '-'
                Addr    = '-'
                Started = '-'
                Process = '-'
                Cwd     = '(manual override; remote port not observed)'
                Pkg     = ''
                Cmdline = ''
            }
        }
    }
    return $result
}

# ---------------- forward management ----------------

$script:ExtraPorts = @{} # port(int) -> $true; retained until this run exits
$Forwards = @{}   # port(int) -> @{ Proc; Attempts; Info; Status; StartedAt; Manual }

function Start-Forward([int]$port, [string]$SshTarget) {
    $sshArgs = @(
        '-N',
        '-o', 'BatchMode=yes',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
        '-L', ('127.0.0.1:{0}:localhost:{0}' -f $port),
        $SshTarget
    )
    $proc = Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -WindowStyle Hidden -PassThru
    if ($script:JobReady -and $proc) {
        try { [void][PortWatch.Job]::Add($proc.Handle) } catch { }
    }
    return $proc
}

# Get-NetTCPConnection is a CIM query costing ~250ms+, so calling it on the
# UI thread (let alone once per port) froze the UI every poll. The
# background poll runspace now builds ONE snapshot of all listening ports
# (port -> owning pids) alongside the ssh probe; the checks below just read
# that hashtable.

# A previous portwatch run that was killed without cleanup (e.g. console
# window closed with X) leaves its hidden ssh.exe children alive and holding
# the ports. Recognize those by their exact command line and adopt them
# instead of reporting a conflict.
# NOTE: a port with no local listener has no key in $snap, and $snap[$port]
# is $null - which @() wraps into a ONE-element array. Iterating that would
# treat every unheld port as busy, so always go through Get-SnapOwners.
function Get-SnapOwners([int]$port, $snap) {
    if ($snap -and $snap.ContainsKey($port)) { return ,@($snap[$port]) }
    return ,@()
}

function Get-AdoptableForward([int]$port, [string]$SshTarget, $snap) {
    foreach ($ownerPid in (Get-SnapOwners $port $snap)) {
        $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
        if (-not $wmi -or $wmi.Name -ne 'ssh.exe') { continue }
        $needle = [regex]::Escape(('-L 127.0.0.1:{0}:localhost:{0} {1}' -f $port, $SshTarget)) + '(\s|$)'
        if ("$($wmi.CommandLine)" -match $needle) {
            try { return Get-Process -Id $ownerPid -ErrorAction Stop } catch { }
        }
    }
    return $null
}

function Test-LocalPortBusy([int]$port, $ownPids, $snap) {
    foreach ($ownerPid in (Get-SnapOwners $port $snap)) {
        if ($ownPids -notcontains $ownerPid) { return $true }
    }
    return $false
}

function Test-LocalPortListening([int]$port, [int]$sshPid, $snap) {
    return ((Get-SnapOwners $port $snap) -contains $sshPid)
}

# ---------------- port naming ----------------

function Get-FrameworkGuess([string]$cmdline) {
    $c = "$cmdline"
    if ([string]::IsNullOrWhiteSpace($c)) { return $null }
    $map = @(
        @('storybook',                       'Storybook'),
        @('vite',                            'Vite'),
        @('next-server|next dev|next start', 'Next.js'),
        @('nuxt',                            'Nuxt'),
        @('astro',                           'Astro'),
        @('remix',                           'Remix'),
        @('react-scripts',                   'React (CRA)'),
        @('ng serve|@angular',               'Angular'),
        @('vue-cli-service',                 'Vue CLI'),
        @('webpack',                         'webpack-dev-server'),
        @('uvicorn',                         'Uvicorn'),
        @('gunicorn',                        'Gunicorn'),
        @('manage\.py runserver',            'Django'),
        @('flask',                           'Flask'),
        @('streamlit',                       'Streamlit'),
        @('jupyter',                         'Jupyter'),
        @('artisan serve',                   'Laravel'),
        @('php -S',                          'PHP dev server'),
        @('rails',                           'Rails'),
        @('http\.server',                    'python http.server'),
        @('code-server',                     'code-server'),
        @('dotnet',                          '.NET')
    )
    foreach ($m in $map) {
        if ($c -match $m[0]) { return $m[1] }
    }
    return $null
}

# Resolved display name for a port, with its source for the detail pane.
# Precedence: config label > probed HTML title > package.json name >
# framework guess > process name.
function Get-PortName([int]$port, $fw) {
    if ($script:PortLabels.ContainsKey("$port")) {
        return @{ Name = $script:PortLabels["$port"]; Source = 'config label' }
    }
    $t = $script:Titles[$port]
    if ($t -and $t.Title) { return @{ Name = $t.Title; Source = 'html title' } }
    if (-not [string]::IsNullOrWhiteSpace($fw.Info.Pkg)) {
        return @{ Name = $fw.Info.Pkg; Source = 'package.json' }
    }
    $g = Get-FrameworkGuess $fw.Info.Cmdline
    if ($g) { return @{ Name = $g; Source = 'cmdline guess' } }
    return @{ Name = $fw.Info.Process; Source = 'process' }
}

# ---------------- title probe ----------------

# Once a forward is 'up', GET http://localhost:<port>/ through the tunnel
# and cache the HTML <title> keyed by (port, remote pid). Runs on HttpClient
# tasks polled from the main loop so the UI never blocks; at most 2 in
# flight. A successful probe also proves the forward works end to end.
Add-Type -AssemblyName System.Net.Http
$script:HttpClient = New-Object System.Net.Http.HttpClient
$script:HttpClient.Timeout = [TimeSpan]::FromSeconds(2)
[void]$script:HttpClient.DefaultRequestHeaders.UserAgent.TryParseAdd('portwatch')
$script:Titles = @{}   # port(int) -> @{ Pid; Title; State ('title'|'none'|'nohttp'); Server }
$script:Probes = @{}   # port(int) -> @{ Task; Pid }

function Update-TitleProbes {
    foreach ($port in @($Forwards.Keys)) {
        if ($script:Probes.Count -ge 2) { break }
        $fw = $Forwards[$port]
        if ($fw.Status -ne 'up') { continue }
        if ($script:Probes.ContainsKey($port)) { continue }
        $cached = $script:Titles[$port]
        if ($cached -and $cached.Pid -eq $fw.Info.Pid) { continue }
        $task = $script:HttpClient.GetAsync(("http://localhost:{0}/" -f $port))
        $script:Probes[$port] = @{ Task = $task; Pid = $fw.Info.Pid }
    }

    $changed = $false
    foreach ($port in @($script:Probes.Keys)) {
        $probe = $script:Probes[$port]
        if (-not $probe.Task.IsCompleted) { continue }
        $title = $null; $server = $null; $state = 'nohttp'
        # .Result on a faulted task can silently return $null in PowerShell
        # instead of throwing, so gate on Task.Status rather than try/catch
        if ($probe.Task.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {
            try {
                $resp = $probe.Task.Result
                $state = 'none'
                $server = "$($resp.Headers.Server)".Trim()
                # ResponseContentRead (the default) means the body is already
                # buffered by the time the task completes - .Result won't block
                $body = $resp.Content.ReadAsStringAsync().Result
                $m = [regex]::Match($body, '<title[^>]*>\s*(.*?)\s*</title>', 'IgnoreCase,Singleline')
                if ($m.Success) {
                    $title = ([System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value) -replace '\s+', ' ').Trim()
                    if ($title.Length -gt 60) { $title = $title.Substring(0, 57) + '...' }
                    if ($title) { $state = 'title' } else { $title = $null }
                }
                $resp.Dispose()
            }
            catch { }
        }
        $script:Titles[$port] = @{ Pid = $probe.Pid; Title = $title; State = $state; Server = $server }
        $script:Probes.Remove($port)
        $changed = $true
    }
    return $changed
}

# ---------------- watch screen ----------------

$script:SelPort = $null
$script:LastProbeFailed = $false
$script:LastPollAt = [DateTime]::MinValue
$script:RemoteHome = ''
$script:PortOrder = @()
$script:TitledSet = @{}

# Ports that answered the probe with an HTML title sort first - those are
# the ones actually worth opening in a browser. The order is recomputed
# only at poll boundaries so a title landing mid-navigation never yanks
# rows out from under the cursor; between polls new titles just update the
# NAME text in place.
function Update-PortOrder {
    $titled = @(); $rest = @(); $set = @{}
    foreach ($port in @($Forwards.Keys | Sort-Object)) {
        $t = $script:Titles[$port]
        if ($t -and $t.Title) { $titled += $port; $set[$port] = $true } else { $rest += $port }
    }
    $script:PortOrder = @($titled + $rest)
    $script:TitledSet = $set
}

function Get-SortedPorts {
    $order = @()
    foreach ($port in $script:PortOrder) {
        if ($Forwards.ContainsKey($port)) { $order += $port }
    }
    foreach ($port in @($Forwards.Keys | Sort-Object)) {
        if ($order -notcontains $port) { $order += $port }
    }
    return ,$order
}

function Move-Selection([int]$delta) {
    $ports = Get-SortedPorts
    if ($ports.Count -eq 0) { $script:SelPort = $null; return }
    $idx = [Array]::IndexOf($ports, $script:SelPort)
    if ($idx -lt 0) { $idx = 0 } else { $idx += $delta }
    if ($idx -lt 0) { $idx = 0 }
    if ($idx -ge $ports.Count) { $idx = $ports.Count - 1 }
    $script:SelPort = $ports[$idx]
}

# bright color for titled/selected rows, dim variant for the untitled group
function Get-StatusColors([string]$status) {
    switch ($status) {
        'up'       { return @('Green', 'DarkGreen') }
        'conflict' { return @('Red', 'DarkRed') }
        'failed'   { return @('Red', 'DarkRed') }
        default    { return @('Yellow', 'DarkYellow') }
    }
}

function Format-RemoteDir([string]$dir) {
    if ([string]::IsNullOrEmpty($dir)) { return '-' }
    if ($script:RemoteHome -and $dir.StartsWith($script:RemoteHome)) {
        return '~' + $dir.Substring($script:RemoteHome.Length)
    }
    return $dir
}

function Draw-Screen([string]$SshTarget) {
    $ports = Get-SortedPorts
    if ($ports.Count -gt 0) {
        if ($null -eq $script:SelPort -or $ports -notcontains $script:SelPort) { $script:SelPort = $ports[0] }
    }
    else { $script:SelPort = $null }

    $rows = New-Object System.Collections.Generic.List[object]
    $pollAt = '-'
    if ($script:LastPollAt -ne [DateTime]::MinValue) { $pollAt = $script:LastPollAt.ToString('HH:mm:ss') }
    $pollingTxt = ''
    if ($script:PollPS) { $pollingTxt = (" {0} polling" -f $script:Dot) }
    $rows.Add(@{
        Text = ("  portwatch -> {0}    {1} forwards {2} poll {3}s {2} last {4}{5}" -f $SshTarget, $Forwards.Count, $script:Dot, $PollSeconds, $pollAt, $pollingTxt)
        Fg = 'Cyan'
    })
    if ($script:LastProbeFailed) {
        $rows.Add(@{ Text = '  ! probe failed - host unreachable or ssh auth not passwordless'; Fg = 'Red' })
    }
    $rows.Add(@{ Text = ''; Fg = 'Gray' })
    $rows.Add(@{ Text = ('      ' + ("{0,-7} {1}" -f 'PORT', 'NAME')); Fg = 'DarkGray' })

    $anyTitled = $false; $anyUntitled = $false
    foreach ($port in $ports) {
        if ($script:TitledSet.ContainsKey($port)) { $anyTitled = $true } else { $anyUntitled = $true }
    }
    $sepDrawn = $false
    foreach ($port in $ports) {
        $fw = $Forwards[$port]
        $isTitled = $script:TitledSet.ContainsKey($port)
        if ($anyTitled -and $anyUntitled -and -not $isTitled -and -not $sepDrawn) {
            $rows.Add(@{ Text = ('  ' + ($script:HRule * 40)); Fg = 'DarkGray' })
            $sepDrawn = $true
        }
        $selected = ($port -eq $script:SelPort)
        # untitled rows use the dark variant of their status color so the
        # titled group reads brighter without losing the status semantics
        $colors = Get-StatusColors $fw.Status
        $fg = $colors[0]
        if (-not $isTitled -and -not $selected) { $fg = $colors[1] }
        $marker = '  '
        $bg = $null
        if ($selected) { $marker = '> '; $bg = 'DarkBlue' }
        $icon = $script:Glyph[$fw.Status]
        if (-not $icon) { $icon = '?' }
        $name = Get-PortName $port $fw
        $rows.Add(@{
            Text = ("  {0}{1} {2,-7} {3}" -f $marker, $icon, $port, $name.Name)
            Fg = $fg; Bg = $bg
        })
    }
    if ($ports.Count -eq 0) {
        $emptyTxt = '    (no matching ports on remote)'
        if ($script:LastPollAt -eq [DateTime]::MinValue) { $emptyTxt = '    (waiting for first poll...)' }
        $rows.Add(@{ Text = $emptyTxt; Fg = 'DarkGray' })
    }

    if ($script:SelPort) {
        $fw = $Forwards[$script:SelPort]
        $sshPid = '-'
        if ($fw.Proc -and -not $fw.Proc.HasExited) { $sshPid = $fw.Proc.Id }
        $uptime = '-'
        if ($fw.StartedAt) { $uptime = ([DateTime]::Now - $fw.StartedAt).ToString('hh\:mm\:ss') }
        $started = $fw.Info.Started
        if ([string]::IsNullOrWhiteSpace($started)) { $started = '-' }

        $rows.Add(@{ Text = ''; Fg = 'Gray' })
        $rows.Add(@{ Text = ('  ' + ($script:HRule * 44)); Fg = 'DarkCyan' })
        $statusDesc = switch ($fw.Status) {
            'up'       { 'up - tunnel open and listening' }
            'starting' { 'starting - waiting for the tunnel' }
            'new'      { 'starting - waiting for the tunnel' }
            'conflict' { 'conflict - local port taken by another process' }
            'failed'   { ('failed - gave up after {0} attempts' -f $MaxRespawnAttempts) }
            default    { $fw.Status }
        }
        $icon = $script:Glyph[$fw.Status]
        if (-not $icon) { $icon = '?' }
        $rows.Add(@{ Text = ("  status    {0} {1}" -f $icon, $statusDesc); Fg = (Get-StatusColors $fw.Status)[0] })
        $rows.Add(@{ Text = ("  open      http://localhost:{0}" -f $script:SelPort); Fg = 'White' })
        if ($fw.Manual) {
            $rows.Add(@{ Text = '  mode      manual override - kept until this portwatch exits'; Fg = 'Yellow' })
        }
        $name = Get-PortName $script:SelPort $fw
        $rows.Add(@{ Text = ("  name      {0}   (from {1})" -f $name.Name, $name.Source); Fg = 'Gray' })
        $probeTxt = 'not probed yet'
        if ($script:Probes.ContainsKey($script:SelPort)) { $probeTxt = 'in flight' }
        $t = $script:Titles[$script:SelPort]
        if ($t) {
            switch ($t.State) {
                'title'  { $probeTxt = ('title "{0}"' -f $t.Title) }
                'none'   { $probeTxt = 'http ok, no title' }
                'nohttp' { $probeTxt = 'no http response' }
            }
            if ($t.Server) { $probeTxt += ("   server: {0}" -f $t.Server) }
        }
        $rows.Add(@{ Text = ("  probe     {0}" -f $probeTxt); Fg = 'Gray' })
        $tunnelTxt = ("  tunnel    ssh pid {0}   up {1}" -f $sshPid, $uptime)
        if ($fw.Attempts -ge 2) { $tunnelTxt += ("   attempts {0}" -f $fw.Attempts) }
        $rows.Add(@{ Text = $tunnelTxt; Fg = 'Gray' })
        $rows.Add(@{ Text = ("  remote    listening on {0}   pid {1}   started {2}" -f $fw.Info.Addr, $fw.Info.Pid, $started); Fg = 'Gray' })
        $rows.Add(@{ Text = ("  process   {0}" -f $fw.Info.Process); Fg = 'Gray' })
        $rows.Add(@{ Text = ("  cwd       {0}" -f $fw.Info.Cwd); Fg = 'Gray' })
        $cmd = "$($fw.Info.Cmdline)"
        if ([string]::IsNullOrWhiteSpace($cmd)) {
            $rows.Add(@{ Text = '  cmd       -'; Fg = 'Gray' })
        }
        else {
            $w = 80
            try { $w = [Console]::WindowWidth } catch { }
            $avail = $w - 13
            if ($avail -lt 20) { $avail = 20 }
            $prefix = '  cmd       '
            $lineNo = 0
            while ($cmd.Length -gt 0 -and $lineNo -lt 3) {
                $take = [Math]::Min($avail, $cmd.Length)
                $chunk = $cmd.Substring(0, $take)
                $cmd = $cmd.Substring($take)
                if ($cmd.Length -gt 0 -and $lineNo -eq 2) { $chunk = $chunk.Substring(0, $chunk.Length - 3) + '...' ; $cmd = '' }
                $rows.Add(@{ Text = ($prefix + $chunk); Fg = 'Gray' })
                $prefix = '            '
                $lineNo++
            }
        }
    }

    $rows.Add(@{ Text = ''; Fg = 'Gray' })
    $rows.Add(@{ Text = '  Up/Down select   Enter open   A add port   R poll now   Q quit'; Fg = 'DarkGray' })
    Write-Frame $rows
}

function Prompt-AdditionalPort {
    $answer = $null
    try {
        [Console]::CursorVisible = $true
        $answer = Read-Host 'Additional remote port (1-65535; blank cancels)'
    }
    catch { return $false }
    finally {
        try { [Console]::CursorVisible = $false } catch { }
    }
    if ([string]::IsNullOrWhiteSpace($answer)) { return $false }

    $port = 0
    if (-not [int]::TryParse($answer.Trim(), [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Write-Host 'Port must be a number from 1 to 65535.' -ForegroundColor Yellow
        Start-Sleep -Milliseconds 800
        return $false
    }
    $script:ExtraPorts[$port] = $true
    return $true
}

# ---------------- main ----------------

if (-not $Target) { $Target = Select-TargetHost }
Save-Mru $Target

$hostCfg = $null
if ($Config.hosts) { $hostCfg = $Config.hosts.$Target }
$allowedFolders = @()
if ($hostCfg -and $hostCfg.allowedFolders) { $allowedFolders = @($hostCfg.allowedFolders) }
$script:PortLabels = @{}
if ($hostCfg -and $hostCfg.portLabels) {
    foreach ($prop in $hostCfg.portLabels.PSObject.Properties) {
        $script:PortLabels["$($prop.Name)"] = "$($prop.Value)"
    }
}
if ($allowedFolders.Count -eq 0) {
    Write-Host ''
    Write-Host "No allowedFolders for '$Target' in config.json - forwarding ALL of your listening ports." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
}

$script:Quit = $false

try {
    Clear-Host
    $script:PrevLines = 0
    if ($script:CanKey) { [Console]::CursorVisible = $false }
    $nextPoll = [DateTime]::MinValue

    while (-not $script:Quit) {
        if ($null -eq $script:PollPS -and [DateTime]::Now -ge $nextPoll) {
            Start-RemotePoll $Target
            Draw-Screen $Target
        }

        if ($script:PollPS -and $script:PollHandle.IsCompleted) {
            $result = $null
            try { $result = @($script:PollPS.EndInvoke($script:PollHandle))[0] } catch { }
            $script:PollPS.Dispose()
            $script:PollPS = $null
            $script:PollHandle = $null
            $script:LastPollAt = [DateTime]::Now

            $probe = $null
            if ($result -and $result.ExitCode -eq 0) { $probe = Parse-ProbeOutput $result.Lines }
            $script:LastProbeFailed = ($null -eq $probe)

            if (-not $script:LastProbeFailed) {
                $script:RemoteHome = $probe.Home
                $desired = @(Get-DesiredPorts $probe $allowedFolders)
                $desiredPorts = @($desired | ForEach-Object { $_.Port })

                # drop forwards whose port is gone
                foreach ($port in @($Forwards.Keys)) {
                    if ($desiredPorts -notcontains $port) {
                        $fw = $Forwards[$port]
                        if ($fw.Proc -and -not $fw.Proc.HasExited) {
                            Stop-Process -Id $fw.Proc.Id -Force -ErrorAction SilentlyContinue
                        }
                        $Forwards.Remove($port)
                        $script:Titles.Remove($port)
                    }
                }

                $ownPids = @()
                foreach ($fw in $Forwards.Values) {
                    if ($fw.Proc -and -not $fw.Proc.HasExited) { $ownPids += $fw.Proc.Id }
                }

                $snap = $result.Snap

                foreach ($p in $desired) {
                    $port = [int]$p.Port
                    if (-not $Forwards.ContainsKey($port)) {
                        $Forwards[$port] = @{ Proc = $null; Attempts = 0; Info = $p; Status = 'new'; StartedAt = $null; Manual = $false }
                    }
                    $fw = $Forwards[$port]
                    $fw.Info = $p
                    $fw.Manual = $script:ExtraPorts.ContainsKey($port)
                    $alive = ($fw.Proc -and -not $fw.Proc.HasExited)
                    if ($alive) {
                        if (Test-LocalPortListening $port $fw.Proc.Id $snap) {
                            $fw.Status = 'up'
                            $fw.Attempts = 0
                        }
                        else { $fw.Status = 'starting' }
                    }
                    else {
                        $adopt = Get-AdoptableForward $port $Target $snap
                        if ($adopt) {
                            if ($script:JobReady) {
                                try { [void][PortWatch.Job]::Add($adopt.Handle) } catch { }
                            }
                            $fw.Proc = $adopt
                            $fw.StartedAt = $adopt.StartTime
                            $fw.Status = 'starting'
                            $ownPids += $adopt.Id
                        }
                        elseif (Test-LocalPortBusy $port $ownPids $snap) { $fw.Status = 'conflict' }
                        elseif ($fw.Attempts -ge $MaxRespawnAttempts) { $fw.Status = 'failed' }
                        else {
                            $fw.Proc = Start-Forward $port $Target
                            $fw.StartedAt = [DateTime]::Now
                            $fw.Attempts++
                            $fw.Status = 'starting'
                            $ownPids += $fw.Proc.Id
                        }
                    }
                }
                Update-PortOrder
            }

            $nextPoll = [DateTime]::Now.AddSeconds($PollSeconds)
            Draw-Screen $Target
        }

        if (Update-TitleProbes) { Draw-Screen $Target }

        if ($script:CanKey) {
            while ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true)
                $redraw = $false
                switch ($key.Key) {
                    'UpArrow'   { Move-Selection -1; $redraw = $true }
                    'DownArrow' { Move-Selection 1;  $redraw = $true }
                    'Home'      { $p = Get-SortedPorts; if ($p.Count -gt 0) { $script:SelPort = $p[0] }; $redraw = $true }
                    'End'       { $p = Get-SortedPorts; if ($p.Count -gt 0) { $script:SelPort = $p[$p.Count - 1] }; $redraw = $true }
                    'Enter'     { if ($script:SelPort) { Start-Process ("http://localhost:{0}" -f $script:SelPort) } }
                    'Escape'    { $script:Quit = $true }
                    'Q'         { $script:Quit = $true }
                    'A'         { if (Prompt-AdditionalPort) { $nextPoll = [DateTime]::MinValue; $redraw = $true } }
                    'R'         { $nextPoll = [DateTime]::MinValue }
                }
                if ($redraw) { Draw-Screen $Target }
            }
        }
        Start-Sleep -Milliseconds 100
    }
}
finally {
    if ($script:CanKey) { try { [Console]::CursorVisible = $true } catch { } }
    try { $script:HttpClient.Dispose() } catch { }
    if ($script:PollPS) { try { $script:PollPS.Stop(); $script:PollPS.Dispose() } catch { } }
    if ($script:PollRunspace) { try { $script:PollRunspace.Dispose() } catch { } }
    if ($script:SavedConsoleEncoding) { try { [Console]::OutputEncoding = $script:SavedConsoleEncoding } catch { } }
    $killed = 0
    foreach ($fw in $Forwards.Values) {
        if ($fw.Proc -and -not $fw.Proc.HasExited) {
            Stop-Process -Id $fw.Proc.Id -Force -ErrorAction SilentlyContinue
            $killed++
        }
    }
    Write-Host ''
    Write-Host "portwatch stopped - closed $killed forward(s)." -ForegroundColor Cyan
}
