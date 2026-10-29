# 自运维诊断运行时迁移：实现交接

2026-10-29。代码交主控审查与主目录验收；未 push，未改 InfoHub，未构建镜像或访问远程环境。

## 实现

- 工作台持有固定诊断定义、提示词和标准 `ops-diagnosis` 技能；循环、会话消息、状态、取消、压缩及产物由运行时拥有。新增 `ops_sessions` 与 `ops_run_intents` 只保存私有会话索引、目标和受理定义/指纹；旧无归属诊断记录保留待发版转换，不双读。
- 诊断与主助手共用 `createAgentHostRouter`、公开投影和既有 HTTP RuntimeClient。诊断会话列表、读写、取消、删除及 MCP 都校验用户 + 域。两个入口不能互相认领同一运行时会话 ID。公开投影排除运行时 system 提示词，快照与事件使用同一规则。
- 取证前缀 `/api/observe/evidence/` 只暴露明确的读操作；沙箱使用现有 run/expiry/prefix 绑定的 callback 凭据，没有 runtime 服务凭据或原始用户 token。日志查询复用三个服务的契约；DSL 改走本体 `/ontology/query/execute-dsl`，不使用 exploration grant。
- 目标解析支持工作台 session/run、旧 Turn key 和测试 case；取证会话/产物从实际拥有者读取。配置沿用非敏感 schema，保留健康、元数据和运维知识查询。
- 运维 MCP 保留 `/mcp/ops-agent`、单个 `send` 工具、50 秒等待及原 running/completed/failed/error 返回形状，内部改读运行时事实。消息重发仍是新回合，不补造外部幂等保证。
- 运维页面挂公共 AgentShell；原实时日志、Turn、自动测试、DSL、知识功能保留。外壳增加通用 sessionId 受控选择；业务回复扳手恢复挂在 message-actions，深链使用稳定的会话/运行幂等键。
- Turn/case 仅保存证据引用，Turn ZIP 只含引用与说明；case 保留自身结果/评估文件。删除旧诊断循环、宿主文件/命令工具、子代理分派、旧对话 store/事件投影和日志后处理。自动测试仅替换取证尾部并去掉日志刷新的 10 秒等待；原评分调用保留。知识治理的 `collect_turn_artifacts` 删除，`read_evidence` 改读其拥有者提供的运行事实，不再采集工作区。

## 已取得的检查结果

- 公共 workbench-server 与 workbench-ui 类型检查在实现过程中通过；其后对投影、测试及少量页面清理有修改，按最新“通过即停”要求未再重复全量类型检查。
- 现有 MCP 兼容、assistant 契约、自动测试默认评分：3 个测试文件、13 项通过。
- 新的主路径进程检查：独立 PostgreSQL + 真实工作台进程 + 真实 agent-runtime 进程 + 标准技能脚本，3 项通过。覆盖用户/域隔离、跨入口会话 ID 占用、技能通过受限 callback 查询工作台日志、受理幂等冲突、工作台重启后的读取/重试、取消受理意图、取消活跃运行及 MCP send/poll。模型与本体接口使用测试替身，不能据此证明真实模型诊断质量或企业身份验收。

进程检查命令（使用独立测试数据库）：

```sh
RUNTIME_TEST_DATABASE_URL=<isolated-test-db> pnpm --filter @ontomato/workbench-server exec vitest run src/services/ops-diagnosis/__tests__/runtime-http.integration.test.ts --pool forks --maxWorkers 1 --minWorkers 1
```

测试替身与临时目录、数据库均用于本任务；测试进程在用例结束时关闭，独立 PostgreSQL 容器在交接前删除。未复用现有业务数据库。初次检查发现技能 YAML 格式和测试日志存储初始化问题，已修复并通过同一检查，未继续扩大测试。

## 留给主控的边界

- **本体同域 observer 读取仍需拥有者补齐。** 当前 `OntologyAgentAccess.reader` 支持资源所有者或受信调用方；未见普通同域 observer 分支。本模块对 `/ontology/ai` 和 retrieval evidence 使用普通用户凭据，已有权限的读请求可通，其他请求明确返回 `EVIDENCE_UNAVAILABLE`，没有借用 `OntologyRetrievalClient` 的服务特权。该 stub 按 D2 不阻塞本轮整体验收；补齐归 worktrees/ontology-ai。
- 本体代理的公开 run 投影目前不含 correlationId，所以这类引用给出 runId + 有界时间查询，并注明关联号缺口；不猜测关联号。工作台源运行使用其实际持久化关联号。
- 未做真实问数/失败诊断、三服务整链真实日志、浏览器页面实机、企业装配构建、镜像构建和企业整栈验收；未将本机 native 模式测试当作 Linux 沙箱隔离证明。按本轮分工由主控在主目录完成。
- 历史数据转换、全局 LangChain 清理、更强沙箱/出网限制、反馈/质检迁移不在本模块。没有追加测试矩阵或防御设施。

提交后停止编辑，等主控审查。
