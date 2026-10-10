# Resolve only the previously approved hashed mailbox; never print mailbox identity.
param([string]$ScopeKey,[Alias('Start')][datetime]$ScopeStart,[Alias('End')][datetime]$ScopeEnd,[Alias('OutputPath')][string]$CaptureDestination,[ValidateSet('both','received','sent')][string]$CaptureDirection='both',[string]$CaptureConversations='')
$ErrorActionPreference='Stop'
. "$PSScriptRoot/outlook_capture.ps1" -LibraryOnly
if (-not (Get-Process OUTLOOK -ErrorAction SilentlyContinue)) {throw 'Classic Outlook is not running.'}
$crmScopeApp=New-Object -ComObject Outlook.Application
$crmScopeNamespace=$crmScopeApp.GetNamespace('MAPI')
$crmScopeStores=@($crmScopeNamespace.Stores | Where-Object {(Get-CrmScopeKey $_.DisplayName) -eq $ScopeKey})
if ($crmScopeStores.Count -ne 1) {throw 'Approved mailbox unavailable.'}
& "$PSScriptRoot/outlook_capture.ps1" -StoreDisplayName $crmScopeStores[0].DisplayName -Start $ScopeStart -End $ScopeEnd -Mode Capture -OutputPath $CaptureDestination -Direction $CaptureDirection -ConversationKeysCsv $CaptureConversations
