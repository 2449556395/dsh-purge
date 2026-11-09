# 1.1.92-wxcvm.2

## 中文

- **面向 wxcvm fork 的维护预览版**：和原作者版本区分，`package.json` 升至 `1.1.92-wxcvm.2`，便于识别升级前后的实际安装包。
- **作战台入口与交互**：恢复「技能库」入口及真实路由，完善内嵌指南、页签交互、列表与错误反馈。
- **环境与运行时诊断**：解决工具已检测到却弹「环境没配好」的状态竞争；可在「管理 → 指南」检查实际插件目录文件和 GitHub master 的差异，避免只看 Git 工作区或版本号误判。
- **数据保留**：靶标从当前名册移除时完整归档到本地 `redteam/archive/`，不再直接物理删除资产库、证据与报告。
- **通道状态**：把代理是否可用与目标侧边界证据分开呈现，不以特定代理或 WebShell 名称判定连接必然失败。
- **宿主兼容**：Windows / Ubuntu 兼容矩阵包含 DSH `0.2.2-rc.1`；相关 PR 均通过 11/11 CI。
- **安装源修正**：中英文 README 的安装、手动克隆、下载包与桌面深链指向本 fork；继续保留原作者署名和许可证信息。
- **验收边界**：CI 不是实际 DSH Desktop 的加载证明；请更新真正运行的插件副本、完全重启，再核对技能库、归档按钮及源码诊断。
- **发布方式**：fork 仅在 `master` 手动触发 Release workflow；普通合并不会自动创建 Release。

## English

- **Maintained fork preview** with a distinct `1.1.92-wxcvm.2` version.
- Restored Skill catalog navigation, corrected routing, and improved embedded UI diagnostics.
- Fixed false environment-setup prompts; added a read-only installed-source comparison.
- Engagement removal now archives the complete workspace instead of permanently deleting it.
- Proxy connectivity is reported separately from boundary-evidence classification.
- Compatibility matrix now covers DSH `0.2.2-rc.1` on Windows and Ubuntu.
- Installation instructions and download links point to `wxcvm/dsh-purge`, preserving original attribution.
- CI passing does not replace a real desktop installation check. Release publishing remains manual.
