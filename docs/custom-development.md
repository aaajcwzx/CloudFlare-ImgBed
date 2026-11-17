# 自定义开发与上游同步

本 Fork 的 `main` 用于 Cloudflare Pages 正式部署。新功能使用 `feat/功能名`，上游更新使用 `sync/版本`。提交功能分支和 PR 不代表正式版本已上线；正式部署以合入 `main` 后的构建与页面核验为准。

## 上游更新

`.github/workflows/sync-upstream.yml` 定时或手动运行，只在独立同步分支合并上游并创建 PR，不直接更新 `main`，不派发 Worker 部署。分支名包含上游与生产基准提交号，重复运行会复用待审查 PR，不进行强制推送。冲突会中止本次合并并列出文件，需人工在本地解决。已关闭的 PR 不会被自动合并。

PR 创建后显式派发回归工作流，因为 `GITHUB_TOKEN` 创建 PR 不会自动触发常规 PR 工作流。合并前确认检查成功，并查看 `.github/breaking-updates/`、部署配置和你的自定义功能是否兼容。上游变更仍可能与自定义代码冲突；分支隔离负责保留历史和控制上线时机。

目前需要在 GitHub 仓库设置允许 Actions 创建 PR，启用主分支 PR/检查保护。旧的直接同步工作流应保持停用，直至新的 PR 流程合入并核验。

## 本地工作目录

从正常 clone 的仓库开发，不要在裸仓库诊断目录内编辑或执行 `git switch`。

```sh
git switch main
git pull --ff-only origin main
git switch -c feat/my-feature
git config --local rerere.enabled true
```

每个功能独立提交；功能完成后推送分支并创建 PR。已发布的生产提交使用 merge 同步，不强制重写历史。避免批量格式化、无关重命名及直接修改 `frontend-dist` 的压缩资源。

## 前端源码

前端源码在自己的 `Sanyue-ImgHub` Fork 内维护。当前七牛云预设改动对应 `feat/qiniu-s3-preset`。运行 `npm ci`、`npm test`、`npm run build` 后，将生成的 `dist/` 更新到本仓库 `frontend-dist/`，在提交中记录源码版本和构建命令。不要将原始构建文件当作源码合并；上游更新了前端时，应先合并前端源码再重新构建。

后端验证：`npm test`、`npm run test:server`、`npx --no-install wrangler pages functions build functions --outdir data/ci-pages-build`。
