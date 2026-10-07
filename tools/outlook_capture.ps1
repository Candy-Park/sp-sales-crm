<# Read-only Classic Outlook capture. Preview emits counts only; Capture writes originals locally.
No Save, Send, Move, Delete, attachments download or Outlook Quit.
#>
[CmdletBinding()]
param(
    [string]$StoreDisplayName,
    [datetime]$Start,
    [datetime]$End,
    [ValidateSet('Preview','Capture')][string]$Mode='Preview',
    [string]$OutputPath,
    [ValidateSet('both','received','sent')][string]$Direction='both',
    [switch]$LibraryOnly
)
$ErrorActionPreference='Stop'
function Get-CrmHash([string]$Value) {
    $crmHasher=[Security.Cryptography.SHA256]::Create()
    try { return -join ($crmHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)) | ForEach-Object {$_.ToString('x2')}) }
    finally { $crmHasher.Dispose() }
}
function Get-CrmScopeKey([string]$Mailbox) {
    if ([string]::IsNullOrWhiteSpace($Mailbox)) { throw 'Mailbox identity required.' }
    Get-CrmHash ('sp-sales-crm:outlook:mailbox:'+$Mailbox.Trim().ToLowerInvariant())
}
function Get-CrmCaptureFolders([ValidateSet('both','received','sent')][string]$Selection='both') {
    @(@{Name='Inbox';Id=6;Date='ReceivedTime';Direction='received'},@{Name='Sent';Id=5;Date='SentOn';Direction='sent'}) |
        Where-Object {$Selection -eq 'both' -or $_.Direction -eq $Selection}
}
function Assert-CrmCaptureWindow([datetime]$WindowStart,[datetime]$WindowEnd) {
    if ($WindowStart -ge $WindowEnd) {throw 'Start must precede End.'}
    if (($WindowStart.Ticks % [TimeSpan]::TicksPerMinute) -ne 0 -or ($WindowEnd.Ticks % [TimeSpan]::TicksPerMinute) -ne 0) {
        throw 'Use whole-minute local time boundaries.'
    }
}
function Get-CrmSourceIdentity {
    param([string]$ScopeKey,[ValidateSet('received','sent')][string]$Direction,[string]$InternetMessageId,[string]$EntryId)
    if ($ScopeKey -notmatch '^[0-9a-f]{64}$') {throw 'Hashed mailbox identity required.'}
    $crmMethod='internet_message_id'; $crmRaw=$InternetMessageId.Trim()
    if ([string]::IsNullOrWhiteSpace($crmRaw)) { $crmMethod='entry_id_fallback'; $crmRaw=$EntryId.Trim() }
    if ([string]::IsNullOrWhiteSpace($crmRaw)) {throw 'Mail has no usable source identity.'}
    [pscustomobject]@{source_key=(Get-CrmHash ($ScopeKey+':'+$Direction+':'+$crmMethod+':'+$crmRaw));identity_method=$crmMethod}
}
function Get-CrmInternetMessageId($MailItem) {
    foreach ($crmTag in @('0x1035001F','0x1035001E')) {
        try {
            $crmMessageId=[string]$MailItem.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/'+$crmTag)
            if (-not [string]::IsNullOrWhiteSpace($crmMessageId)) {return $crmMessageId}
        } catch {
            $crmException=$_.Exception
            while ($null -ne $crmException.InnerException) {$crmException=$crmException.InnerException}
            if ($crmException.HResult -ne -2147221233) {throw 'Cannot read message identity. Outlook access must be checked.'}
        }
    }
    return ''
}
if ($LibraryOnly) {return}
if ([string]::IsNullOrWhiteSpace($StoreDisplayName)) {throw 'A specific Outlook mailbox is required.'}
Assert-CrmCaptureWindow $Start $End
if ([TimeZoneInfo]::Local.BaseUtcOffset.TotalMinutes -ne 540) {throw 'This collector requires the PC Asia/Seoul time zone.'}
$crmDestination=$null
if ($Mode -eq 'Capture') {
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {throw 'A new private capture output path is required.'}
    $crmDestination=[IO.Path]::GetFullPath($OutputPath)
    $crmRoot=[IO.Path]::GetFullPath('D:/AI/projects/sp-sales-crm/sources/outlook/')
    if (-not $crmDestination.StartsWith($crmRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($crmDestination) -ne '.json') {throw 'Capture output must be a JSON file under the approved Outlook sources directory.'}
    if (Test-Path -LiteralPath $crmDestination) {throw 'Do not overwrite an earlier capture.'}
    $crmDirectory=[IO.Path]::GetDirectoryName($crmDestination)
    if (-not (Test-Path -LiteralPath $crmDirectory)) {New-Item -ItemType Directory -Path $crmDirectory -Force | Out-Null}
}
if (-not (Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)) {throw 'Classic Outlook must already be running with the selected profile.'}
$crmApp=New-Object -ComObject Outlook.Application
$crmNamespace=$crmApp.GetNamespace('MAPI')
$crmMatches=@($crmNamespace.Stores | Where-Object {$_.DisplayName -eq $StoreDisplayName})
if ($crmMatches.Count -ne 1) {throw 'Exactly one matching Outlook mailbox is required.'}
$crmStore=$crmMatches[0]; $crmScope=Get-CrmScopeKey $StoreDisplayName
$crmCulture=[Globalization.CultureInfo]::GetCultureInfo('en-US')
$crmStartText=$Start.ToString('MM/dd/yyyy hh:mm tt',$crmCulture)
$crmEndText=$End.ToString('MM/dd/yyyy hh:mm tt',$crmCulture)
$crmRecords=[Collections.Generic.List[object]]::new(); $crmStatistics=[Collections.Generic.List[object]]::new()
$crmTotal=0
foreach ($crmSpec in @(Get-CrmCaptureFolders $Direction)) {
    $crmFolder=$crmStore.GetDefaultFolder($crmSpec.Id)
    $crmFilter='['+$crmSpec.Date+"] >= '"+$crmStartText+"' AND ["+$crmSpec.Date+"] < '"+$crmEndText+"'"
    $crmItems=$crmFolder.Items.Restrict($crmFilter)
    $crmMailCount=0; $crmOther=0; $crmFallback=0; $crmDuplicate=0
    $crmSeen=[Collections.Generic.HashSet[string]]::new()
    foreach ($crmItem in $crmItems) {
        if ($crmItem.Class -ne 43) {$crmOther++;continue}
        $crmMailCount++;$crmTotal++
        if ($crmTotal -gt 5000) {throw 'Capture exceeds 5000 mails. No successful checkpoint was recorded.'}
        $crmIdentity=Get-CrmSourceIdentity -ScopeKey $crmScope -Direction $crmSpec.Direction -InternetMessageId (Get-CrmInternetMessageId $crmItem) -EntryId ([string]$crmItem.EntryID)
        if ($crmIdentity.identity_method -eq 'entry_id_fallback') {$crmFallback++}
        if (-not $crmSeen.Add($crmIdentity.source_key)) {$crmDuplicate++}
        if ($Mode -eq 'Capture') {
            $crmAttachments=[Collections.Generic.List[object]]::new()
            for ($crmIndex=1;$crmIndex -le $crmItem.Attachments.Count;$crmIndex++) {
                $crmAttachment=$crmItem.Attachments.Item($crmIndex)
                $crmAttachments.Add([pscustomobject]@{name=[string]$crmAttachment.FileName;size=[long]$crmAttachment.Size})
            }
            $crmConversation=[string]$crmItem.ConversationID
            $crmConversationKey=$null
            if (-not [string]::IsNullOrWhiteSpace($crmConversation)) {$crmConversationKey=Get-CrmHash ($crmScope+':conversation:'+$crmConversation)}
            $crmOccurred=[datetime]$crmItem.($crmSpec.Date)
            $crmRecords.Add([pscustomobject]@{
                source_key=$crmIdentity.source_key;identity_method=$crmIdentity.identity_method;direction=$crmSpec.Direction;
                subject=[string]$crmItem.Subject;body=[string]$crmItem.Body;sender=[string]$crmItem.SenderEmailAddress;
                recipients=([string]$crmItem.To+'; Cc: '+[string]$crmItem.CC);
                occurred_at=$crmOccurred.ToUniversalTime().ToString('o');conversation_key=$crmConversationKey;attachments=@($crmAttachments.ToArray())
            })
        }
    }
    $crmStatistics.Add([pscustomobject]@{folder=$crmSpec.Name;date_field=$crmSpec.Date;mail_count=$crmMailCount;other_count=$crmOther;fallback_identity=$crmFallback;duplicate_source_keys=$crmDuplicate})
}
$crmBatchId=[guid]::NewGuid().ToString()
if ($Mode -eq 'Capture') {
    $crmBatch=[pscustomobject]@{version=1;batch_id=$crmBatchId;scope_key=$crmScope;start=([DateTimeOffset]$Start).ToString('o');end=([DateTimeOffset]$End).ToString('o');records=@($crmRecords.ToArray())}
    $crmJson=$crmBatch | ConvertTo-Json -Depth 8 -Compress
    $crmTemporary=$crmDestination+'.partial-'+$crmBatchId
    [IO.File]::WriteAllText($crmTemporary,$crmJson,[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $crmTemporary -Destination $crmDestination
}
[pscustomobject]@{mode=$Mode;batch_id=$crmBatchId;scope_key=$crmScope;start_local=$Start.ToString('s');end_exclusive_local=$End.ToString('s');checked_at_utc=[datetime]::UtcNow.ToString('o');folders=@($crmStatistics.ToArray());captured=$crmRecords.Count;uploaded=0} | ConvertTo-Json -Depth 5
# Preserve the user's Outlook process and original mails. Do not Quit.
