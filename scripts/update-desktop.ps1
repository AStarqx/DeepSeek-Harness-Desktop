#Requires -Version 5.1
<#
.SYNOPSIS
Update this Desktop worktree from upstream deepseek-harness and rebuild the unsigned Windows package.

.DESCRIPTION
Runs one update pass: back up the current branch, fetch the upstream branch, report the arriving
commits and the files a merge would conflict on, merge or rebase, reinstall workspace dependencies,
and run the unsigned Windows packaging command. A conflict stops the run instead of leaving a
half-merged working tree behind, unless -KeepConflicts is set.

.EXAMPLE
.\scripts\update-desktop.ps1 -CheckOnly

Reports what upstream changed and which files would conflict, then changes nothing.

.EXAMPLE
.\scripts\update-desktop.ps1 -Publish

Updates, installs, packages, and copies the artifacts into desktop-release/.

.PARAMETER Remote
Git remote that points at the upstream deepseek-harness repository. Default: the remote whose URL
names deepseek-ai/deepseek-harness, falling back to origin.

.PARAMETER UpstreamBranch
Upstream branch to take. Default: master.

.PARAMETER ForkRemote
Git remote that points at this project's own repository. Default: the remote named fork, falling
back to the first remote that is not the upstream remote.

.PARAMETER ForkBranch
Branch to publish on the fork remote. Default: master.

.PARAMETER Push
Publish the updated branch to the fork remote as soon as the update succeeds.

.PARAMETER Rebase
Replay local commits on top of the upstream branch instead of merging it into them.

.PARAMETER CheckOnly
Fetch and report only; change nothing.

.PARAMETER Yes
Skip the confirmation prompt before the branch mutation.

.PARAMETER KeepConflicts
Leave a stopped merge or rebase in the working tree for manual resolution.

.PARAMETER SkipInstall
Skip pnpm install after the update.

.PARAMETER SkipPackage
Skip the unsigned Windows packaging command.

.PARAMETER Publish
Copy the produced installer and unpacked application into desktop-release/.

.PARAMETER NoMirror
Do not default the Electron and electron-builder download mirrors to npmmirror.

.PARAMETER Force
Continue when tracked files have uncommitted changes.
#>
[CmdletBinding()]
param(
  [string]$Remote = '',
  [string]$UpstreamBranch = 'master',
  [string]$ForkRemote = '',
  [string]$ForkBranch = 'master',
  [switch]$Push,
  [switch]$Rebase,
  [switch]$CheckOnly,
  [switch]$Yes,
  [switch]$KeepConflicts,
  [switch]$SkipInstall,
  [switch]$SkipPackage,
  [switch]$Publish,
  [switch]$NoMirror,
  [switch]$Force
)

$ErrorActionPreference = 'Continue'
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Write-Step {
  param([string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Detail {
  param([string]$Message = '')
  Write-Host "    $Message"
}

function Write-Note {
  param([string]$Message)
  Write-Host "    ! $Message" -ForegroundColor Yellow
}

function Stop-WithError {
  param([string]$Message)
  Write-Host "`nERROR: $Message" -ForegroundColor Red
  exit 1
}

# Run git and return its exit code together with the captured output lines.
function Invoke-Git {
  param([Parameter(Mandatory)][string[]]$GitArguments)
  $raw = & git @GitArguments 2>&1
  $code = $LASTEXITCODE
  $lines = @()
  if ($null -ne $raw) { $lines = @($raw | ForEach-Object { $_.ToString() }) }
  [pscustomobject]@{ ExitCode = $code; Lines = $lines }
}

function Get-GitPath {
  param([string]$Name)
  $result = Invoke-Git @('rev-parse', '--git-path', $Name)
  if ($result.Lines.Count -eq 0) { return $null }
  $path = $result.Lines[0]
  if ([System.IO.Path]::IsPathRooted($path)) { return $path }
  return (Join-Path $repoRoot $path)
}

# True while git has a merge, rebase, or cherry-pick that still needs to finish.
function Test-GitOperationInProgress {
  foreach ($marker in @('MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD')) {
    $path = Get-GitPath $marker
    if ($null -ne $path -and (Test-Path $path)) { return $true }
  }
  return $false
}

function Get-GitRemoteNames {
  return @((Invoke-Git @('remote')).Lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-GitRemoteUrl {
  param([string]$Name)
  $result = Invoke-Git @('remote', 'get-url', $Name)
  if ($result.ExitCode -ne 0 -or $result.Lines.Count -eq 0) { return $null }
  return $result.Lines[0]
}

# The upstream remote is the one that names the deepseek-ai repository, whatever it is called.
function Resolve-UpstreamRemote {
  param([string]$Requested, [string[]]$Names)
  if (-not [string]::IsNullOrWhiteSpace($Requested)) { return $Requested }
  foreach ($name in $Names) {
    $url = Get-GitRemoteUrl $name
    if ($null -ne $url -and $url -match 'deepseek-ai/deepseek-harness') { return $name }
  }
  return 'origin'
}

# The fork remote is the one that is not upstream; `fork` wins when several remain.
function Resolve-ForkRemote {
  param([string]$Requested, [string[]]$Names, [string]$Upstream)
  if (-not [string]::IsNullOrWhiteSpace($Requested)) { return $Requested }
  $others = @($Names | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne $Upstream })
  if ($others -contains 'fork') { return 'fork' }
  if ($others -contains 'origin') { return 'origin' }
  if ($others.Count -gt 0) { return $others[0] }
  return $null
}

$started = [System.Diagnostics.Stopwatch]::StartNew()
$repoRoot = Split-Path -Parent $PSScriptRoot
$action = if ($Rebase) { 'rebase' } else { 'merge' }
$isWindowsHost = $env:OS -eq 'Windows_NT'
$backupBranch = $null

if (-not (Test-Path (Join-Path $repoRoot 'apps/desktop/package.json'))) {
  Stop-WithError "expected the deepseek-harness repository above $PSScriptRoot (no apps/desktop/package.json under $repoRoot)"
}
if ($null -eq (Get-Command git -ErrorAction SilentlyContinue)) {
  Stop-WithError 'git is not available on PATH'
}
if (-not $SkipInstall -or -not $SkipPackage) {
  if ($null -eq (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Stop-WithError 'pnpm is not available on PATH; install pnpm 11 or pass -SkipInstall -SkipPackage'
  }
}

Push-Location $repoRoot
try {
  if ((Invoke-Git @('rev-parse', '--is-inside-work-tree')).ExitCode -ne 0) {
    Stop-WithError "$repoRoot is not a git working tree"
  }
  if (Test-GitOperationInProgress) {
    Stop-WithError 'a merge, rebase, or cherry-pick is already in progress; finish it or abort it first'
  }

  $branchResult = Invoke-Git @('symbolic-ref', '--quiet', '--short', 'HEAD')
  if ($branchResult.ExitCode -ne 0) {
    Stop-WithError 'HEAD is detached; check out the branch you build the desktop release from'
  }
  $branch = $branchResult.Lines[0]
  $headBefore = (Invoke-Git @('rev-parse', 'HEAD')).Lines[0]

  Write-Step 'Worktree'
  Write-Detail "path:   $repoRoot"
  Write-Detail "branch: $branch"
  Write-Detail "HEAD:   $headBefore"
  $remoteNames = Get-GitRemoteNames
  $Remote = Resolve-UpstreamRemote -Requested $Remote -Names $remoteNames
  $forkRemote = Resolve-ForkRemote -Requested $ForkRemote -Names $remoteNames -Upstream $Remote
  Write-Detail "upstream remote: $Remote"
  if ([string]::IsNullOrWhiteSpace($forkRemote)) {
    Write-Detail 'fork remote:     none configured (-Push needs one)'
  }
  else {
    Write-Detail "fork remote:     $forkRemote -> $(Get-GitRemoteUrl $forkRemote) (branch $ForkBranch)"
  }

  $dirty = Invoke-Git @('status', '--porcelain', '--untracked-files=no')
  if ($dirty.Lines.Count -gt 0) {
    Write-Note 'tracked files have uncommitted changes:'
    $dirty.Lines | ForEach-Object { Write-Detail $_ }
    if (-not $Force) {
      Stop-WithError 'commit or stash those changes, or re-run with -Force'
    }
    Write-Note 'continuing because -Force is set'
  }

  Write-Step "Fetching $Remote/$UpstreamBranch"
  $fetched = $false
  for ($attempt = 1; $attempt -le 3 -and -not $fetched; $attempt++) {
    if ($attempt -gt 1) {
      Write-Detail "retry $attempt of 3"
      Start-Sleep -Seconds 5
    }
    & git fetch $Remote $UpstreamBranch --prune
    if ($LASTEXITCODE -eq 0) { $fetched = $true }
  }

  $upstreamRef = "$Remote/$UpstreamBranch"
  $verified = (Invoke-Git @('rev-parse', '--verify', '--quiet', "${upstreamRef}^{commit}")).ExitCode -eq 0
  if (-not $fetched) {
    if (-not $verified) {
      Stop-WithError "git fetch $Remote $UpstreamBranch failed and no cached $upstreamRef exists (network, proxy, or credentials)"
    }
    Write-Note "git fetch failed; continuing from the last fetched $upstreamRef, which may be stale"
  }
  if (-not $verified) {
    Stop-WithError "$upstreamRef does not exist after the fetch"
  }
  $upstreamSha = (Invoke-Git @('rev-parse', '--verify', "${upstreamRef}^{commit}")).Lines[0]
  Write-Detail "upstream: $upstreamRef = $upstreamSha"

  $behind = [int]((Invoke-Git @('rev-list', '--count', "HEAD..$upstreamRef")).Lines[0])
  $ahead = [int]((Invoke-Git @('rev-list', '--count', "$upstreamRef..HEAD")).Lines[0])

  Write-Step 'Update summary'
  Write-Detail "new upstream commits: $behind"
  Write-Detail "local-only commits:   $ahead"
  if ($behind -eq 0) {
    Write-Detail 'already up to date with upstream'
  }
  elseif ($behind -le 40) {
    Invoke-Git @('log', '--oneline', '--no-decorate', "HEAD..$upstreamRef") |
      ForEach-Object { $_.Lines } | ForEach-Object { Write-Detail "  $_" }
  }
  else {
    Invoke-Git @('log', '--oneline', '--no-decorate', '-40', "HEAD..$upstreamRef") |
      ForEach-Object { $_.Lines } | ForEach-Object { Write-Detail "  $_" }
    Write-Detail "  ... and $($behind - 40) more"
  }
  if ($ahead -gt 0) {
    Write-Detail 'local commits the update keeps:'
    Invoke-Git @('log', '--oneline', '--no-decorate', "$upstreamRef..HEAD") |
      ForEach-Object { $_.Lines } | ForEach-Object { Write-Detail "  $_" }
  }

  $previewFiles = @()
  if ($behind -gt 0) {
    $preview = Invoke-Git @('merge-tree', '--write-tree', '--name-only', 'HEAD', $upstreamRef)
    $oidIndex = -1
    for ($index = 0; $index -lt $preview.Lines.Count; $index++) {
      if ($preview.Lines[$index] -match '^[0-9a-f]{40,64}$') { $oidIndex = $index; break }
    }
    if ($oidIndex -lt 0) {
      Write-Note 'conflict preview unavailable (git merge-tree --write-tree needs git 2.38+)'
    }
    elseif ($preview.ExitCode -eq 0) {
      Write-Detail 'conflict preview: none'
    }
    else {
      foreach ($line in ($preview.Lines | Select-Object -Skip ($oidIndex + 1))) {
        if ($line -eq '' -or $line -match '^(CONFLICT|Auto-merging|warning:|error:|info:)') { break }
        $previewFiles += $line
      }
      Write-Step "Conflict preview: $($previewFiles.Count) file(s)"
      $previewFiles | ForEach-Object { Write-Detail $_ }
      Write-Note 'the list is computed for a merge; a rebase can conflict on slightly different files'
      Write-Note 'the local desktop patch touches apps/desktop/scripts and pnpm-workspace.yaml, so expect those'
    }
  }

  if ($CheckOnly) {
    Write-Step 'CheckOnly: nothing changed'
    exit 0
  }

  if ($behind -gt 0) {
    if (-not $Yes) {
      $answer = Read-Host "Proceed with git $action of $upstreamRef? [y/N]"
      if ($answer -notmatch '^\s*(y|yes)\s*$') {
        Write-Host 'Cancelled.'
        exit 0
      }
    }

    $backupBranch = 'backup/desktop-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    & git branch $backupBranch $headBefore
    if ($LASTEXITCODE -ne 0) {
      Stop-WithError "could not create the backup branch $backupBranch"
    }
    Write-Detail "backup branch: $backupBranch"

    Write-Step "git $action $upstreamRef"
    if ($Rebase) { & git rebase $upstreamRef } else { & git merge --no-edit $upstreamRef }
    if ($LASTEXITCODE -ne 0) {
      $conflicted = @((Invoke-Git @('diff', '--name-only', '--diff-filter=U')).Lines)
      Write-Step "$action stopped"
      if ($conflicted.Count -gt 0) {
        Write-Detail 'conflicted files:'
        $conflicted | ForEach-Object { Write-Detail "  $_" }
      }
      else {
        Write-Detail 'no conflicted files; git stopped for another reason (read the messages above)'
      }
      Write-Detail ''
      Write-Detail 'resolve by hand:'
      Write-Detail '  1. edit each conflicted file, keeping the local desktop fix unless upstream fixed the same problem'
      Write-Detail '  2. git add <file> ...'
      Write-Detail "  3. git $action --continue   (a rebase may instead report an empty commit: git rebase --skip)"
      Write-Detail '  4. re-run this script; it sees nothing new, then installs and packages'
      Write-Detail "backup branch with the pre-update state: $backupBranch"
      if ($KeepConflicts) {
        Write-Note 'leaving the stopped operation in the working tree (-KeepConflicts)'
      }
      elseif (Test-GitOperationInProgress) {
        if ($Rebase) { & git rebase --abort } else { & git merge --abort }
        if ($LASTEXITCODE -eq 0) { Write-Detail "aborted the $action; the working tree is back at $headBefore" }
      }
      exit 1
    }

    $headAfter = (Invoke-Git @('rev-parse', 'HEAD')).Lines[0]
    Write-Detail "new HEAD: $headAfter"

    $changedFiles = @((Invoke-Git @('diff', '--name-only', "$headBefore..HEAD")).Lines)
    $touchedPatches = @($changedFiles | Where-Object { $_ -like 'patches/*' })
    $touchedManifests = @($changedFiles | Where-Object { $_ -in @('pnpm-workspace.yaml', 'pnpm-lock.yaml') })
    if ($touchedPatches.Count -gt 0 -or $touchedManifests.Count -gt 0) {
      Write-Note 'the update changed patches/, pnpm-workspace.yaml, or pnpm-lock.yaml'
      Write-Note 'patchedDependencies entries are pinned per version, so a "patch not found" failure from'
      Write-Note 'pnpm install means the pinned dependency version moved and patches/ needs the same bump'
    }
  }

  if ($Push) {
    if ($null -eq $forkRemote) {
      Stop-WithError "no remote points at this project's repository; add one with 'git remote add fork <url>' or pass -ForkRemote"
    }
    Write-Step "Publishing to $forkRemote/$ForkBranch"
    & git push $forkRemote "HEAD:refs/heads/$ForkBranch"
    if ($LASTEXITCODE -ne 0) {
      Stop-WithError "git push $forkRemote HEAD:refs/heads/$ForkBranch failed (check the remote URL and your credentials)"
    }
    Write-Detail "published $((Invoke-Git @('rev-parse', 'HEAD')).Lines[0]) to $forkRemote/$ForkBranch"
  }

  if ($SkipInstall) {
    Write-Detail 'skipping pnpm install (-SkipInstall)'
  }
  else {
    Write-Step 'Installing workspace dependencies (pnpm install)'
    & pnpm install
    if ($LASTEXITCODE -ne 0) {
      Write-Note 'common causes after an upstream update:'
      Write-Note '  - patches/ no longer applies because a patched dependency version changed'
      Write-Note '  - the registry is unreachable (try: pnpm config set registry https://registry.npmmirror.com)'
      Write-Note '  - native modules need Python and the Visual C++ build tools'
      Stop-WithError 'pnpm install failed'
    }
  }

  if ($SkipPackage) {
    Write-Detail 'skipping packaging (-SkipPackage)'
  }
  elseif (-not $isWindowsHost) {
    Write-Note 'the unsigned Windows target builds only on Windows; skipping packaging'
  }
  else {
    if ([string]::IsNullOrEmpty($env:DSH_DESKTOP_APP_ID)) {
      $env:DSH_DESKTOP_APP_ID = 'com.deepseek.harness.desktop'
      Write-Note "DSH_DESKTOP_APP_ID was unset; using $($env:DSH_DESKTOP_APP_ID) for this build"
    }
    if (-not $NoMirror) {
      if ([string]::IsNullOrEmpty($env:ELECTRON_MIRROR)) {
        $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
      }
      if ([string]::IsNullOrEmpty($env:ELECTRON_BUILDER_BINARIES_MIRROR)) {
        $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
      }
      Write-Detail "electron mirror: $($env:ELECTRON_MIRROR)"
    }
    Write-Step 'Packaging the unsigned Windows installer (expect 20-40 minutes)'
    & pnpm run package:desktop:win:x64:unsigned
    if ($LASTEXITCODE -ne 0) {
      Stop-WithError 'packaging failed; read the output above'
    }
    Write-Detail "artifacts: $(Join-Path $repoRoot 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts')"
  }

  if ($Publish) {
    Write-Step 'Publishing artifacts into desktop-release/'
    $targetRoot = Join-Path $repoRoot 'apps/desktop/.desktop-build/targets/win-x64'
    $unsignedDir = Join-Path $targetRoot 'unsigned-artifacts'
    $releaseDir = Join-Path $repoRoot 'desktop-release'
    $applicationDir = Join-Path $releaseDir 'DeepSeek Harness'
    if (-not (Test-Path $unsignedDir)) {
      Stop-WithError "no packaging output at $unsignedDir; run without -SkipPackage first"
    }
    if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
      Stop-WithError 'the desktop application is running; close it before publishing'
    }
    New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
    foreach ($file in @(Get-ChildItem -Path $unsignedDir -Filter '*.exe' -File -ErrorAction SilentlyContinue)) {
      Copy-Item -Path $file.FullName -Destination (Join-Path $releaseDir $file.Name) -Force
      Write-Detail "copied $($file.Name)"
    }
    $unpacked = @(
      (Join-Path $unsignedDir 'win-unpacked')
      (Join-Path $targetRoot 'win-unpacked')
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($null -eq $unpacked) {
      Write-Note 'no win-unpacked directory found; left the portable copy in desktop-release/ unchanged'
      Write-Note 'run pnpm run package:desktop:win:x64:dir to produce one'
    }
    else {
      New-Item -ItemType Directory -Force -Path $applicationDir | Out-Null
      Write-Detail "mirroring $unpacked -> $applicationDir (removes stale files)"
      & robocopy $unpacked $applicationDir /MIR /NFL /NDL /NJH /NJS /R:2 /W:2 | Out-Null
      if ($LASTEXITCODE -ge 8) {
        Stop-WithError "robocopy failed with exit code $LASTEXITCODE"
      }
    }
  }

  Write-Step 'Done'
  Write-Detail "branch: $branch"
  Write-Detail "HEAD:   $((Invoke-Git @('rev-parse', 'HEAD')).Lines[0])"
  if ($Push -and $null -ne $forkRemote) {
    Write-Detail "published to $forkRemote/$ForkBranch"
  }
  if ($null -ne $backupBranch) {
    Write-Detail "backup: $backupBranch  (delete with: git branch -D $backupBranch)"
  }
  Write-Detail ("elapsed: {0:n1} min" -f $started.Elapsed.TotalMinutes)
}
finally {
  Pop-Location
}
