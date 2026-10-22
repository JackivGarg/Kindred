[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$SubscriptionId,
  [Parameter(Mandatory)][ValidatePattern('^kindred-[a-z0-9-]{3,45}$')][string]$ResourceGroup,
  [Parameter(Mandatory)][ValidatePattern('^kindred-[a-z0-9-]{3,45}$')][string]$SiteName,
  [ValidateSet('centralus','eastus2','eastasia','westeurope','westus2')][string]$Location = 'centralus',
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectId = 'uhaklwcvscsdsrfgniee'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed. Deployment stopped." }
}
function Get-AzureJson([string[]]$Arguments) {
  $result = & az @Arguments --subscription $SubscriptionId --only-show-errors --output json
  if ($LASTEXITCODE -ne 0) { throw 'Azure command failed. No further deployment action was taken.' }
  return ($result | ConvertFrom-Json)
}
function Get-Preflight {
  $result = & node --env-file-if-exists=.env.local scripts/preflight.mjs --prepare --json
  if ($LASTEXITCODE -ne 0) { throw 'Production configuration preflight failed.' }
  return ($result | ConvertFrom-Json)
}
function Assert-Owned($Resource, [string]$Label) {
  if (!$Resource.tags -or $Resource.tags.'kindred-project' -ne $projectId) {
    throw "$Label exists but is not tagged for this Kindred project. Refusing to reuse or change it. Choose a new dedicated name."
  }
}

Push-Location -LiteralPath $workspace
try {
  foreach ($tool in @('node','npm.cmd','npx.cmd','az')) {
    if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool before running deployment." }
  }
  # Reads only; fail before creating resources if configuration or Azure login is missing.
  $configuration = Get-Preflight
  $account = Get-AzureJson @('account','show')
  if ($account.state -ne 'Enabled') { throw 'The selected Azure subscription must be enabled.' }

  Invoke-Checked 'npm.cmd' @('ci')
  Invoke-Checked 'npm.cmd' @('run','format:check')
  Invoke-Checked 'npm.cmd' @('test')

  $groupExists = Get-AzureJson @('group','exists','--name',$ResourceGroup)
  if ($groupExists) {
    $group = Get-AzureJson @('group','show','--name',$ResourceGroup)
    Assert-Owned $group 'Resource group'
  } elseif (!$PrepareOnly) {
    throw 'The dedicated resource group does not exist. Run this command with -PrepareOnly first.'
  }
  $site = $null
  if ($groupExists) {
    $sites = @(Get-AzureJson @('staticwebapp','list','--resource-group',$ResourceGroup))
    $site = $sites | Where-Object { $_.name -eq $SiteName } | Select-Object -First 1
    if ($site) {
      Assert-Owned $site 'Static Web App'
      if ($site.sku.name -ne 'Free') { throw 'Only an existing Free Static Web App can be used. This script never changes pricing tiers.' }
    }
  }

  if ($PrepareOnly) {
    # A preparation build verifies live backend configuration before any cloud mutation.
    Invoke-Checked 'npm.cmd' @('run','build')
    Invoke-Checked 'npm.cmd' @('run','check:bundle')
    Invoke-Checked 'node' @('--env-file-if-exists=.env.local','scripts/preflight.mjs','--prepare','--built')
    if (!$groupExists) {
      $group = Get-AzureJson @('group','create','--name',$ResourceGroup,'--location',$Location,'--tags',"kindred-project=$projectId")
      Assert-Owned $group 'Created resource group'
    }
    if (!$site) {
      $site = Get-AzureJson @('staticwebapp','create','--name',$SiteName,'--resource-group',$ResourceGroup,'--location',$Location,'--sku','Free','--tags',"kindred-project=$projectId")
      Assert-Owned $site 'Created Static Web App'
      if ($site.sku.name -ne 'Free') { throw 'Azure did not return a Free site. No content was uploaded.' }
    }
    $origin = "https://$($site.defaultHostname)"
    Write-Host "Prepared Free Static Web App. No application content was uploaded."
    Write-Host "Application origin: $origin"
    Write-Host "Set VITE_APP_URL=$origin in .env.local."
    Write-Host "Supabase Auth Site URL: $origin"
    Write-Host "Supabase Auth allowed redirect URL: $origin/auth/callback"
    Write-Host 'Configure Supabase custom SMTP and verify delivery, then rerun this command without -PrepareOnly.'
    return
  }

  if (!$site) { throw 'The dedicated Static Web App does not exist. Run with -PrepareOnly first.' }
  $origin = "https://$($site.defaultHostname)"
  if ($configuration.appOrigin -and $configuration.appOrigin -ne $origin) {
    throw 'VITE_APP_URL does not match this Azure site hostname. No upload was attempted.'
  }
  $previousOrigin = $env:VITE_APP_URL
  $previousToken = $env:SWA_CLI_DEPLOYMENT_TOKEN
  try {
    # Azure returned this exact hostname for the tagged site; never accept a caller redirect.
    $env:VITE_APP_URL = $origin
    Invoke-Checked 'node' @('--env-file-if-exists=.env.local','scripts/preflight.mjs')
    Invoke-Checked 'npm.cmd' @('run','build')
    Invoke-Checked 'npm.cmd' @('run','check:bundle')
    Invoke-Checked 'node' @('--env-file-if-exists=.env.local','scripts/preflight.mjs','--built')
    # Capture the deployment token only in memory. Never print or pass it as an argument.
    $token = & az staticwebapp secrets list --name $SiteName --resource-group $ResourceGroup --subscription $SubscriptionId --query properties.apiKey --output tsv --only-show-errors
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) { throw 'Could not retrieve the deployment token.' }
    $env:SWA_CLI_DEPLOYMENT_TOKEN = $token.Trim()
    $token = $null
    Invoke-Checked 'npx.cmd' @('--yes','@azure/static-web-apps-cli@2.1.0','deploy','dist','--env','production','--no-use-keychain')
    Write-Host "Deployment completed: $origin"
    Write-Host 'Verify signup, confirmation-email delivery, password recovery and two-account posting/messaging at this origin.'
  } finally {
    $env:VITE_APP_URL = $previousOrigin
    $env:SWA_CLI_DEPLOYMENT_TOKEN = $previousToken
    $token = $null
  }
} finally { Pop-Location }
