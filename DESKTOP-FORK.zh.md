# 桌面版分支工作流

[English](DESKTOP-FORK.md) | 中文

本仓库 fork 自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，用于向自己的用户分发 Electron 桌面版。仓库保留上游完整历史，因此上游每次发版都能合并进来；同时它发布自己的 Windows 版本，使已安装的桌面版可以自动更新。

## 远程仓库

| 远程名 | 仓库 | 用途 |
|---|---|---|
| `origin` | `deepseek-ai/deepseek-harness` | 只读的上游 |
| `fork` | 本仓库 | 用户拿到的代码、构建产物与发行版 |

`.\scripts\update-desktop.ps1` 按 URL 识别这两个远程，所以在 `origin` 指向本仓库、`upstream` 指向 DeepSeek 仓库的克隆里同样可用。

## 把上游同步进本仓库

```powershell
# 只报告上游改了什么、哪些文件会冲突，不改动任何内容
.\scripts\update-desktop.ps1 -CheckOnly

# 合并上游 → 安装依赖 → 打包 unsigned Windows 目标 → 推送分支
.\scripts\update-desktop.ps1 -Push

# 同上，并把新产物镜像到 desktop-release\
.\scripts\update-desktop.ps1 -Push -Publish
```

一次执行会：把当前 HEAD 备份成 `backup/desktop-<时间戳>`；抓取上游（失败重试三次）；预演合并冲突的文件；执行 merge 或 rebase；在 `patches/`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` 变动时给出提醒；运行 `pnpm install`；打包 unsigned `win-x64`；最后推送到 `fork/master`。出现冲突时会中止合并并保持工作树干净，除非传入 `-KeepConflicts`。

本分支自有的文件正是上游也可能改动的文件，所以冲突最常出现在窗口装饰（[`apps/desktop/src/titlebar.ts`](apps/desktop/src/titlebar.ts)、[`apps/desktop/src/brand.ts`](apps/desktop/src/brand.ts)）与更新通道（[`apps/desktop/scripts/desktop-auto-update-environment.mjs`](apps/desktop/scripts/desktop-auto-update-environment.mjs)、[`apps/desktop/electron-builder.config.mjs`](apps/desktop/electron-builder.config.mjs)）这两处。

## 发布一次桌面版更新

1. 同时提升根 `package.json` 与 `apps/desktop/package.json` 的版本号；两者不一致时打包会直接失败。
2. 给发布提交打标签并推送：`git tag desktop-v<版本号>`、`git push fork desktop-v<版本号>`。
3. [`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml) 会在 Windows runner 上构建 unsigned Windows 目标，并把安装包、其 blockmap 与通道元数据附到标签对应的 GitHub Release 上。
4. 已安装的桌面版会在主窗口打开十秒后检查该发行流，也可以在 **应用 → 检查更新…** 手动触发；确认后应用会下载并安装。

## 更新通道

`DSH_DESKTOP_AUTO_UPDATE_ENV=github` 选择由本仓库托管发行版，`DSH_DESKTOP_UPDATE_REPOSITORY=<owner>/<name>` 指定仓库名；这样构建产物无需 DeepSeek 的 COS 账号，也不需要代码签名身份即可带上更新配置。打包进应用的 `resources/app-update.yml` 会写明 provider，而随发行版上传的通道元数据——稳定版为 `latest.yml`，`0.1.6-rc.1` 这类预发布版为 `rc.yml`——记录该版本的产物摘要。打包脚本在被要求提供 COS 上传目标时会拒绝 GitHub 部署。

用户需要先安装一次本仓库构建的版本：DeepSeek 官方发布的版本检查的是 DeepSeek 自己的发行流，因此那些安装永远看不到这里的更新。

### 分发注意事项

- 这里构建的 Windows 安装包未签名，首次安装时 SmartScreen 会给出警告，部分用户需要手动允许运行。
- 自动安装针对的是 NSIS 安装版。免安装版仍可检查、下载，并用脚本手动更新：`desktop-release\更新到新版.cmd` 会把新构建镜像覆盖到免安装目录，无需运行安装程序。
- `DSH_DESKTOP_APP_ID` 必须保持不变：它决定已安装应用的身份、快捷方式与更新缓存目录；一旦改变，等于安装出第二个应用而不是升级现有应用。
- 预发布版本会发布为 GitHub prerelease，处于同一版本通道的已安装应用能找到它；稳定版本发布为 latest release 并使用 `latest.yml`。

## 上游自带的 GitHub Actions

本仓库同时带有上游的 GitHub Actions 工作流，它们依赖 DeepSeek 的 runner、密钥与发布环境，因此在 fork 里大多会失败。请在仓库的 **Actions** 标签页按工作流逐个禁用，只保留 `desktop-release.yml`；后者除仓库自带的 `GITHUB_TOKEN` 外不需要任何配置。
