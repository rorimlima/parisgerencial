# start-dev.ps1
# Script para iniciar o servidor de desenvolvimento do Paris Dakar Gerencial
# Usa node_modules instalados em C:\parisdakar-modules (fora do Google Drive)

$projectPath = "G:\Meu Drive\PROJETOS\PROJETOS\parisdakargerencial"
$modulesPath = "C:\parisdakar-modules\node_modules"

Write-Host "🚀 Iniciando Paris Dakar Gerencial..." -ForegroundColor Cyan
Write-Host "📦 node_modules: $modulesPath" -ForegroundColor Gray

# Verifica se os módulos estão instalados
if (-not (Test-Path "$modulesPath\express")) {
    Write-Host "⚠ Instalando dependências em C:\parisdakar-modules..." -ForegroundColor Yellow
    Copy-Item "$projectPath\package.json" "C:\parisdakar-modules\package.json" -Force
    Set-Location "C:\parisdakar-modules"
    npm install --no-audit --no-fund
    Set-Location $projectPath
}

# Remove node_modules corrompido do Google Drive (se existir)
if (Test-Path "$projectPath\node_modules") {
    Write-Host "🗑 Removendo node_modules corrompido do Google Drive..." -ForegroundColor Yellow
    Remove-Item "$projectPath\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
}

# Cria junction (link simbólico) do node_modules local para o projeto
Write-Host "🔗 Criando link do node_modules local para o projeto..." -ForegroundColor Cyan
cmd /c "mklink /J ""$projectPath\node_modules"" ""$modulesPath"""

Write-Host "✅ node_modules configurado com sucesso!" -ForegroundColor Green
Write-Host "🌐 Iniciando servidor em http://localhost:3000..." -ForegroundColor Cyan

# Inicia o servidor
Set-Location $projectPath
$env:NODE_PATH = $modulesPath
npx tsx server.ts
