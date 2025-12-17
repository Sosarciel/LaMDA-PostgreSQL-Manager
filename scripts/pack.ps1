# pack v1.0.0
npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Error "编译失败, 停止打包"
    exit $LASTEXITCODE
}
Write-Output 开始打包
zcli release -l build