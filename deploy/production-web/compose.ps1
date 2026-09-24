$ErrorActionPreference = 'Stop'

if (-not $env:COMMERCE_CONFIG_DIR) {
    throw 'Set COMMERCE_CONFIG_DIR to the protected production configuration directory.'
}

$releaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$deploymentEnv = Join-Path $env:COMMERCE_CONFIG_DIR 'deployment.env'
if (-not (Test-Path -LiteralPath $deploymentEnv -PathType Leaf)) {
    throw "Missing protected deployment environment: $deploymentEnv"
}

$composeFiles = @(
    'deploy/production-mcp/compose.yaml',
    'deploy/production-web/compose.yaml'
)
$composeFiles += (Join-Path $env:COMMERCE_CONFIG_DIR 'windows.yaml')
$composeFiles += (Join-Path $env:COMMERCE_CONFIG_DIR 'jobs.yaml')
$composeArgs = @('--env-file', $deploymentEnv)
foreach ($file in $composeFiles) {
    $composePath = if ([IO.Path]::IsPathRooted($file)) { $file } else { Join-Path $releaseRoot $file }
    if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) {
        throw "Missing Compose file: $composePath"
    }
    $composeArgs += @('-f', $composePath)
}
& docker compose @composeArgs @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
