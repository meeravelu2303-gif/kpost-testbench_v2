<#
  Installs the mobile (Patrol) tool chain on this PC: Flutter, the Android SDK, a Google Play emulator
  image and the Patrol CLI, and switches on Windows Hypervisor Platform for the emulator.
  Design: docs/proposals/mobile-testing.md. Everything goes under D:\mobile-tools (several GB).

    npm run mobile:setup                                  (after office hours; run as Administrator)
    powershell -File scripts/mobile/setup-tools.ps1 -AcceptAndroidLicenses

  This PC also hosts the office Bugzilla, so the script refuses to run on a weekday between 09:00 and
  19:00 unless -OfficeHoursOk is given, and it NEVER restarts the machine: when the hypervisor was
  switched on it says so, and the restart is yours to do. Every step is skipped when already done, so
  it is safe to run again. The Android SDK licenses are shown and must be accepted by a person unless
  -AcceptAndroidLicenses is passed.
#>
param(
  [string]$Root = 'D:\mobile-tools',
  # The developers pin no Flutter version; default is the current stable. Pass e.g. 3.41.6 when the
  # app does not build on the newest one (delete D:\mobile-tools\flutter first).
  # The app's Test_ENV builds with 3.41 (Dart 3.11): 3.44 rejects its font_awesome/quill/fleather
  # versions and 3.47's Dart rejects its own code. Empty = the newest stable.
  [string]$FlutterVersion = '3.41.9',
  [switch]$AcceptAndroidLicenses,
  [switch]$OfficeHoursOk
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times slower with the bar on

# The app's pubspec.lock needs Flutter >= 3.41 (Dart 3.11); Patrol 4.10 needs >= 3.32.
$MinFlutter = [version]'3.41.0'
$ApiLevel = 36 # compileSdk of kpost/android/app/build.gradle (Android 16)
$Ndk = '28.2.13676358' # ndkVersion of the same file
$Avd = "kpost_api$ApiLevel"
$Image = "system-images;android-$ApiLevel;google_apis_playstore;x86_64"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Done($text) { Write-Host "   $text" -ForegroundColor Green }

$now = Get-Date
$weekday = $now.DayOfWeek -notin 'Saturday', 'Sunday'
if ($weekday -and $now.Hour -ge 9 -and $now.Hour -lt 19 -and -not $OfficeHoursOk) {
  throw 'Office hours: this PC serves the office Bugzilla. Run after 19:00, or pass -OfficeHoursOk.'
}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run as Administrator (switching on Hypervisor Platform needs it).' }

$downloads = Join-Path $Root 'downloads'
$flutterHome = Join-Path $Root 'flutter'
$sdk = Join-Path $Root 'android-sdk'
New-Item -ItemType Directory -Force $downloads, $sdk | Out-Null

function Get-Verified($url, $file, $algorithm, $expected) {
  if (-not (Test-Path $file)) {
    Write-Host "   downloading $url"
    Invoke-WebRequest -Uri $url -OutFile "$file.part" -UseBasicParsing
    Move-Item "$file.part" $file
  }
  $actual = (Get-FileHash $file -Algorithm $algorithm).Hash
  if ($actual -ne $expected.ToUpper()) {
    Remove-Item $file
    throw "Checksum mismatch for $file (expected $expected, got $actual); the download was removed."
  }
}

# ---- 1. Flutter (current stable, from Google's release index, checksum verified)
Step 'Flutter SDK'
$flutterExe = Join-Path $flutterHome 'bin\flutter.bat'
if (Test-Path $flutterExe) {
  Done "already installed at $flutterHome"
} else {
  $index = Invoke-RestMethod 'https://storage.googleapis.com/flutter_infra_release/releases/releases_windows.json'
  $stable = if ($FlutterVersion) {
    $index.releases | Where-Object { $_.channel -eq 'stable' -and $_.version -eq $FlutterVersion } | Select-Object -First 1
  } else {
    $index.releases | Where-Object { $_.hash -eq $index.current_release.stable } | Select-Object -First 1
  }
  if (-not $stable) { throw "No stable Flutter release $FlutterVersion in Google's index." }
  if ([version]$stable.version -lt $MinFlutter) {
    throw "Current Flutter stable $($stable.version) is older than the app needs ($MinFlutter)."
  }
  $zip = Join-Path $downloads (Split-Path $stable.archive -Leaf)
  Get-Verified "$($index.base_url)/$($stable.archive)" $zip 'SHA256' $stable.sha256
  Expand-Archive $zip -DestinationPath $Root -Force # the archive holds a top-level flutter\ folder
  Done "Flutter $($stable.version) installed at $flutterHome"
}

# ---- 2. Android command-line tools (latest, from Google's repository index, checksum verified)
Step 'Android command-line tools'
$sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (Test-Path $sdkmanager) {
  Done 'already installed'
} else {
  $repoBase = 'https://dl.google.com/android/repository'
  [xml]$repo = (Invoke-WebRequest "$repoBase/repository2-3.xml" -UseBasicParsing).Content
  $package = $repo.SelectNodes('//remotePackage') | Where-Object { $_.path -eq 'cmdline-tools;latest' }
  $archive = $package.archives.archive | Where-Object { $_.'host-os' -eq 'windows' } | Select-Object -First 1
  $zip = Join-Path $downloads $archive.complete.url
  Get-Verified "$repoBase/$($archive.complete.url)" $zip 'SHA1' $archive.complete.checksum.'#text'
  $unpack = Join-Path $downloads 'cmdline-tools-unpacked'
  Remove-Item $unpack -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip -DestinationPath $unpack
  New-Item -ItemType Directory -Force (Join-Path $sdk 'cmdline-tools') | Out-Null
  Move-Item (Join-Path $unpack 'cmdline-tools') (Join-Path $sdk 'cmdline-tools\latest')
  Done "installed (version $($package.revision.major).$($package.revision.minor))"
}

# ---- 3. Environment (user level, so new terminals and VS Code see the tools)
Step 'Environment variables'
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $sdk, 'User')
$wanted = @(
  (Join-Path $flutterHome 'bin'),
  (Join-Path $sdk 'cmdline-tools\latest\bin'),
  (Join-Path $sdk 'platform-tools'),
  (Join-Path $sdk 'emulator'),
  (Join-Path $env:LOCALAPPDATA 'Pub\Cache\bin') # where `patrol` lands
)
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ }
$missing = $wanted | Where-Object { $_ -notin $userPath }
if ($missing) { [Environment]::SetEnvironmentVariable('Path', (($userPath + $missing) -join ';'), 'User') }
$env:Path = (($env:Path -split ';') + $wanted | Select-Object -Unique) -join ';'
Done "ANDROID_HOME=$sdk; PATH has Flutter, the SDK tools and the Pub cache"

# A .bat started straight from PowerShell gets its arguments through cmd.exe, which splits them at
# ';' ("platforms;android-36" arrives as two names). A written-out .cmd keeps cmd's own quoting.
function Invoke-Cmd($line) {
  $file = Join-Path $env:TEMP "kpost-mobile-setup-$PID.cmd"
  Set-Content -Path $file -Value "@echo off`r`n$line" -Encoding ASCII
  try {
    & cmd.exe /d /c $file
    if ($LASTEXITCODE -ne 0) { throw "failed: $line" }
  } finally {
    Remove-Item $file -ErrorAction SilentlyContinue
  }
}

# ---- 4. SDK packages: what the app builds against, plus one Google Play emulator image
Step 'Android SDK packages'
$packages = @(
  'platform-tools', 'emulator', "platforms;android-$ApiLevel", "build-tools;$ApiLevel.0.0", "ndk;$Ndk", $Image,
  # What the app's plugins compile against. The build would download each itself, but AGP 8.9's
  # downloader stalls on the newer SDK index (v4): it hung on the NDK and on android-33.
  'ndk;27.0.12077973', 'platforms;android-31', 'platforms;android-33', 'platforms;android-34',
  'platforms;android-35', 'build-tools;34.0.0', 'build-tools;35.0.0', 'cmake;3.22.1'
)
$androidCli = Join-Path $sdk 'cmdline-tools\latest\bin\android.exe'
if (Test-Path $androidCli) {
  # Tools 23+ hand sdkmanager over to the Android CLI: package names use '/', no licence step.
  & $androidCli --no-metrics sdk install @($packages | ForEach-Object { $_ -replace ';', '/' })
  if ($LASTEXITCODE -ne 0) { throw 'android sdk install failed (see above).' }
} else {
  if ($AcceptAndroidLicenses) {
    Invoke-Cmd "(for /l %%i in (1,1,40) do @echo y) | `"$sdkmanager`" --licenses >nul"
    Done 'licenses accepted (-AcceptAndroidLicenses)'
  } else {
    Invoke-Cmd "`"$sdkmanager`" --licenses" # interactive: read and answer each one
  }
  Invoke-Cmd ("`"$sdkmanager`" --install " + (($packages | ForEach-Object { "`"$_`"" }) -join ' '))
}
# A tool that skips a name it does not know can still exit 0, so check each package is on disk.
$absent = $packages | Where-Object { -not (Test-Path (Join-Path $sdk ($_ -replace ';', '\'))) }
if ($absent) { throw "not installed: $($absent -join ', ')" }
Done ($packages -join ', ')

# ---- 5. The emulator (a Pixel-sized phone; Google Play image, because push, SMS autofill, ML Kit,
#         maps, speech-to-text and location need Play Services)
Step "Emulator $Avd"
$avdmanager = Join-Path $sdk 'cmdline-tools\latest\bin\avdmanager.bat'
$existing = & $avdmanager list avd -c
if ($existing -contains $Avd) {
  Done 'already created'
} else {
  # "no": no custom hardware profile.
  Invoke-Cmd "echo no| `"$avdmanager`" create avd --name $Avd --package `"$Image`" --device pixel_7"
  $config = Join-Path $env:USERPROFILE ".android\avd\$Avd.avd\config.ini"
  if (-not (Test-Path $config)) { throw "the emulator $Avd was not created (see above)." }
  Add-Content $config "hw.ramSize=4096`ndisk.dataPartition.size=8G`nhw.keyboard=yes"
  Done "created ($config)"
}

# ---- 6. Flutter configuration and the Patrol CLI
Step 'Flutter configuration and Patrol CLI'
& $flutterExe config --no-analytics | Out-Null
& $flutterExe config --android-sdk $sdk | Out-Null
& (Join-Path $flutterHome 'bin\dart.bat') pub global activate patrol_cli '>=4.7.0 <5.0.0'
if ($LASTEXITCODE -ne 0) { throw 'patrol_cli install failed.' }
Done 'patrol_cli installed (4.7+ pairs with the patrol 4.10 package)'

# ---- 7. Windows Hypervisor Platform (the emulator's accelerator). Never restarts by itself.
Step 'Windows Hypervisor Platform'
$whp = Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform
$restart = $false
if ($whp.State -eq 'Enabled') {
  Done 'already on'
} else {
  $result = Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -NoRestart
  $restart = [bool]$result.RestartNeeded
  Done 'switched on'
}

Step 'Check'
& $flutterExe doctor
if ($restart) {
  Write-Host "`nRESTART NEEDED before the emulator can start (Hypervisor Platform)." -ForegroundColor Yellow
  Write-Host 'This PC serves the office Bugzilla: restart outside office hours, then run' -ForegroundColor Yellow
  Write-Host '  npm run mobile:prepare   and   npm run mobile:test' -ForegroundColor Yellow
} else {
  Write-Host "`nReady. Next: npm run mobile:prepare, then npm run mobile:test" -ForegroundColor Green
}
