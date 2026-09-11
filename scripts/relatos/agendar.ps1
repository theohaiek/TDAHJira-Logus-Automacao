# Agenda a passada diária do agente de relatos no Agendador de Tarefas do
# Windows.
#
#   npm run relatos:agendar                       todo dia às 05:17
#   powershell -File scripts/relatos/agendar.ps1 -Hora 06:43
#   powershell -File scripts/relatos/agendar.ps1 -Remover
#
# A tarefa roda com o usuário atual e só enquanto ele tem sessão aberta: não
# guarda senha nenhuma, e é a mesma conta que já tem o Claude Code, o git e o
# gh autenticados. Se o computador estava desligado na hora marcada, a passada
# roda quando ele ligar (StartWhenAvailable).
#
# Este arquivo precisa rodar no Windows PowerShell 5.1: sem &&, sem ??, e salvo
# em UTF-8 com BOM, senão os acentos das mensagens saem trocados.

param(
  [string]$Hora = "05:17",
  [switch]$Remover
)

$ErrorActionPreference = "Stop"
$nome = "TDAH Logus - relatos"

if ($Remover) {
  if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    Write-Host "Tarefa removida: $nome"
  } else {
    Write-Host "Não havia tarefa agendada com o nome $nome."
  }
  exit 0
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script = Join-Path $PSScriptRoot "rodar.mjs"
$node = (Get-Command node -ErrorAction Stop).Source

# O node roda por dentro de um PowerShell escondido: chamado direto, ele abriria
# uma janela de console às 05:17. Aspas simples dobradas protegem caminho com
# apóstrofo.
$nodeSeguro = $node.Replace("'", "''")
$scriptSeguro = $script.Replace("'", "''")
$comando = "& '$nodeSeguro' '$scriptSeguro'; exit `$LASTEXITCODE"
$argumentos = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$comando`""

$acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentos -WorkingDirectory $repo
$gatilho = New-ScheduledTaskTrigger -Daily -At $Hora
$ajustes = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $nome `
  -Action $acao `
  -Trigger $gatilho `
  -Settings $ajustes `
  -Principal $principal `
  -Description "Passada diária do agente de relatos do TDAH Jira (scripts/relatos/rodar.mjs)." `
  -Force | Out-Null

Write-Host "Agendado: $nome, todo dia às $Hora."
Write-Host "Repositório: $repo"
Write-Host ""
Write-Host "Conferir:     Get-ScheduledTask -TaskName '$nome' | Get-ScheduledTaskInfo"
Write-Host "Rodar agora:  Start-ScheduledTask -TaskName '$nome'"
Write-Host "Log de cada passada: $env:USERPROFILE\.tdah-relatos\execucoes\"
