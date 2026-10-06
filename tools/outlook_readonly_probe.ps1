<# Read-only statistics. No bodies, addresses, raw IDs or attachments emitted. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$StoreDisplayName,
    [Parameter(Mandatory)][datetime]$Start,
    [Parameter(Mandatory)][datetime]$End
)

$ErrorActionPreference = 'Stop'
if ($Start -ge $End) { throw 'Start must precede End.' }
if (($Start.Ticks % [TimeSpan]::TicksPerMinute) -ne 0 -or
    ($End.Ticks % [TimeSpan]::TicksPerMinute) -ne 0) {
    throw 'Use whole-minute local time boundaries; seconds are not supported.'
}
if (-not (Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)) {
    throw 'Classic Outlook must already be running with the selected profile.'
}
$crmApp = New-Object -ComObject Outlook.Application
$crmNs = $crmApp.GetNamespace('MAPI')
$crmMatches = @($crmNs.Stores | Where-Object { $_.DisplayName -eq $StoreDisplayName })
if ($crmMatches.Count -ne 1) { throw 'Exactly one matching store is required.' }
$crmStore = $crmMatches[0]
$crmCulture = [Globalization.CultureInfo]::GetCultureInfo('en-US')
$crmStartText = $Start.ToString('MM/dd/yyyy hh:mm tt', $crmCulture)
$crmEndText = $End.ToString('MM/dd/yyyy hh:mm tt', $crmCulture)
$crmStatistics = foreach ($crmSpec in @(
    @{Name='Inbox'; Id=6; Date='ReceivedTime'},
    @{Name='Sent'; Id=5; Date='SentOn'}
)) {
    $crmFolder = $crmStore.GetDefaultFolder($crmSpec.Id)
    $crmFilter = '[' + $crmSpec.Date + "] >= '" + $crmStartText + "' AND [" + $crmSpec.Date + "] < '" + $crmEndText + "'"
    $crmItems = $crmFolder.Items.Restrict($crmFilter)
    $crmCount=0; $crmOther=0; $crmMissing=0; $crmMissingConversation=0; $crmDuplicate=0
    $crmSeen=[Collections.Generic.HashSet[string]]::new()
    $crmSampleId=$null
    foreach ($crmItem in $crmItems) {
        if ($crmItem.Class -ne 43) { $crmOther++; continue }
        $crmCount++
        $crmId=$crmItem.EntryID
        if ([string]::IsNullOrWhiteSpace($crmId)) { $crmMissing++ }
        else {
            if (-not $crmSeen.Add($crmId)) { $crmDuplicate++ }
            if ($null -eq $crmSampleId) { $crmSampleId=$crmId }
        }
        if ([string]::IsNullOrWhiteSpace($crmItem.ConversationID)) { $crmMissingConversation++ }
    }
    $crmLookup=$false
    if ($null -ne $crmSampleId) {
        $crmReload=$crmNs.GetItemFromID($crmSampleId, $crmStore.StoreID)
        $crmLookup=($crmReload.Class -eq 43 -and $crmReload.EntryID -eq $crmSampleId)
    }
    [pscustomobject]@{
        Folder=$crmSpec.Name; DateField=$crmSpec.Date
        MailCount=$crmCount; OtherCount=$crmOther; MissingEntryID=$crmMissing
        MissingConversationID=$crmMissingConversation; DuplicateEntryID=$crmDuplicate
        SampleIDLookup=$crmLookup
    }
}
[pscustomobject]@{
    StartLocal=$Start.ToString('s'); EndExclusiveLocal=$End.ToString('s')
    CheckedAtUtc=[datetime]::UtcNow.ToString('o'); Folders=@($crmStatistics)
} | ConvertTo-Json -Depth 4
# Do not call Outlook Quit: this is the user's existing session.
