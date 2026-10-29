# 自运维诊断运行时迁移：设计裁决

2026-10-29，第一段设计提交 `b9828bc6` 已获主控认可，第二段实现见[交接说明](handoff.md)。

- [设计与删除范围](../docs/ops-diagnosis-runtime-design.md)
- [接口契约](../packages/contracts/ops-diagnosis.md)

主控裁决：

1. D1：诊断会话按用户 + 域私有；目标问数/case 仍可由同域 observer 取证。
2. D2：本体 AI 模块拥有本体宿主的受权取证 facade。本模块用普通调用者凭据调用，不借服务特权；暂不可读的来源明确返回证据缺口，stub 不阻塞本轮整体验收。
3. D3：保留实时日志、Turn 下载、自动测试、DSL、运维知识入口并挂到外壳。Turn 下载改为引用清单；自动测试答题和评分不改，手动 DSL 页面不成为 agent 的写入通道。

主控通知服务日志与本体 AI 已合入后，两仓已合入 origin/develop：公共集成基线 `5865de91`，企业 `0723e50`。只在指定 worktree 实施，不 push、不改 InfoHub。主目录真实问数、页面、镜像与企业整栈验收归主控。
