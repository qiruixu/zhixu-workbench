/**
 * 打包脚本配置说明（electron-builder 读取 package.json 的 "build" 字段）
 *
 * 这里以注释形式记录关键决策，实际配置写在 package.json 中：
 *  - appId / productName：安装包与开始菜单里的名字
 *  - files：只打进必要文件（electron/、server/、dist/），排除源码与 .local 密钥
 *  - extraResources：把 server/ 与 dist/ 作为资源放入 resources/，
 *    因为 Electron 主进程需要它们来启动本地代理并托管前端
 *  - win.target = nsis：生成 Windows 安装包（.exe），带卸载器
 */
export const BUILD_NOTES = '见 package.json 的 build 字段'
