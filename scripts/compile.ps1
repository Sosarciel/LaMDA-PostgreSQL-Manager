npm run expand-macro
# compile v1.0.0
if (Test-Path dist) {
    Write-Output "开始删除原dist"
    Remove-Item -Recurse -Force dist
}
Write-Output 开始编译
tsc -p tsconfig.compile.json
if ($LASTEXITCODE -ne 0) {
    Write-Error "tsc 编译失败"
    exit $LASTEXITCODE
}
tsc-alias -p tsconfig.compile.json