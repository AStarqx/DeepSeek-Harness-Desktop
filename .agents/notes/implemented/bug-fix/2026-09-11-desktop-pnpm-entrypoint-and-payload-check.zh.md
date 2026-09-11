# Agent Note: Desktop package-manager entrypoints and the removed fs-ext payload check

Status: implemented

[English](2026-09-11-desktop-pnpm-entrypoint-and-payload-check.md) | 中文

## 问题

`pnpm run package:desktop:win:x64:unsigned` 在 electron-builder 运行前失败了两次。

[Desktop 打包脚本](../../../../apps/desktop/scripts/package-target.ts)与[开发启动器](../../../../apps/desktop/scripts/dev.ts)用 `process.execPath` 启动，并把 `npm_execpath` 当作程序参数。当包管理器把生命周期入口发布为可执行文件时——pnpm 在 Windows 上将 `npm_execpath` 设为 `pnpm.exe`——该路径不是 JavaScript 文件，Node 在第一个构建步骤之前就以 `ERR_UNKNOWN_FILE_EXTENSION` 拒绝执行。[共享解析器](../../../../scripts/pnpm-invocation.ts)已经区分 JavaScript 入口与可执行入口，仓库内其他有同样需求的脚本都使用它。

随后[载荷冒烟测试](../../../../apps/desktop/tests/fixtures/runtime-payload-smoke.mjs)要求打包运行时中存在 `fs-ext`。[预构建系统原语决策](../architecture/2026-09-07-prebuilt-system-primitives.zh.md)已用 `@deepseek-ai/node-addon-system/flock` 取代 fs-ext 的 flock 绑定，且没有任何 package 声明 fs-ext，因此该断言对任何目标都不可能成立。该测试与依赖迁移来自不同分支，而 Desktop 打包不在 CI 中运行，于是这一不一致一直保留到了发布命令。

## 决策

两个 Desktop 脚本都通过 `pnpmInvocation` 解析包管理器调用：JavaScript 入口用 `process.execPath` 执行，可执行入口直接执行。Desktop 因此遵循仓库统一的调用方式，而不再自行维护第二份实现。

载荷冒烟测试只校验打包运行时仍会安装的原生与 HTML 载荷：通过 `kernel32.dll` 的 koffi、通过 libvips 的 sharp、Turndown GFM 转换器，以及通过 ConPTY 的 node-pty。删除校验跟随删除被校验对象；其余四项保持原有覆盖。

`pnpm-workspace.yaml` 批准 Electron 的安装脚本。开发启动器通过 `require('electron')` 解析其可执行文件，而只有在脚本下载了平台二进制后该解析才会返回路径。

## 考虑过的替代方案

**在 Desktop 脚本内部对可执行入口做特例处理。** 仓库已经拥有两种入口的区分方式，第二份副本会与被测试的实现逐渐偏离。

**要求打包只在 `packageManager` 记录的 pnpm 版本下运行。** 启动器必须接受被交给它的入口。环境禁用受管包管理器版本的工作站也是受支持的调用方式。

**保留 fs-ext 断言。** 没有 manifest 声明 fs-ext，该断言只能报告删除它的那次迁移，而无法报告打包运行时的缺陷。

## 后果

无论包管理器发布哪种入口，Desktop 打包与开发启动器在任意宿主上都能工作。

`apps/desktop/scripts/runtime-file-policy.ts` 与生成项目的 `allowBuilds` 仍列出 fs-ext。对打包运行时而言这些条目不可达，而生成列表预先批准了第三方插件仍可能请求的构建。

验证：unsigned win-x64 目标完成了准备阶段，载荷冒烟测试报告 `koffi`、`sharp`、`html` 与 `pty`，electron-builder 产出了可运行的免安装应用。
