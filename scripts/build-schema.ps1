Write-Output 开始删除原schema
Remove-Item -Recurse -Force schema
Write-Output 开始生成schema
zcli Gen-Schema --project tsconfig.compile.json --include "src/**/*.ts" --include-types "(.+)JsonTable"